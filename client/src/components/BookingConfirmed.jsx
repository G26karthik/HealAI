import { useEffect, useRef, useState } from 'react';
import { socket, subscribeRequest } from '../lib/socket';
import MapView from './MapView';

const time = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * Confirmation, then live tracking.
 *
 * The ETA is shown as a range on purpose. A single number implies a precision
 * the estimate does not have, and someone waiting on an ambulance deserves the
 * honest spread. When traffic shifts the range mid-journey, we say so and give
 * the reason rather than silently editing the number.
 */
export default function BookingConfirmed({ booking, result, onReset }) {
  const { assignment, resource, fallback } = booking;
  const isAmbulance = resource.kind === 'ambulance';
  const slot = resource.attrs?.slots?.find((s) => s.taken);

  const [live, setLive] = useState(null);
  const [arrived, setArrived] = useState(false);
  const [notice, setNotice] = useState(null);
  const startEta = useRef({ p50: assignment.etaP50Min, p90: assignment.etaP90Min });

  useEffect(() => {
    if (!isAmbulance) return;
    const id = booking.request.id;
    subscribeRequest(id);

    const onProgress = (p) => {
      if (p.requestId !== id) return;
      setLive(p);
      if (p.etaChangedReason) setNotice(p.etaChangedReason);
    };
    const onArrived = (p) => {
      if (p.requestId !== id) return;
      setArrived(true);
      setLive(null);
    };

    socket.on('run:progress', onProgress);
    socket.on('run:arrived', onArrived);
    socket.emit('subscribe:request', id);
    return () => {
      socket.off('run:progress', onProgress);
      socket.off('run:arrived', onArrived);
    };
  }, [booking.request.id, isAmbulance]);

  const eta = live?.eta;
  const p50 = eta?.p50Min ?? assignment.etaP50Min;
  const p90 = eta?.p90Min ?? assignment.etaP90Min;
  const widened = eta && p90 > startEta.current.p90 + 1.5;

  const runs = live
    ? [{ assignmentId: assignment._id, name: resource.name, pos: live.pos, to: booking.patientPos || null, etaP50Min: p50, etaP90Min: p90 }]
    : [];

  return (
    <section className="space-y-4" aria-live="polite">
      <div className={`rounded-2xl p-5 text-white ${arrived ? 'bg-tier-t4' : 'bg-tier-t3'}`}>
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-3xl">
            {isAmbulance ? '🚑' : resource.kind === 'doctor' ? '🩺' : '💊'}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-90">
              {arrived ? 'Arrived' : isAmbulance ? 'On the way' : 'Appointment scheduled'}
            </p>
            <h2 className="text-2xl font-bold leading-tight">{resource.name}</h2>
            <p className="mt-1 text-sm opacity-95">
              {isAmbulance
                ? `${resource.attrs?.type} · ${resource.attrs?.crewSkill}`
                : `${resource.attrs?.specialty?.replace('-', ' ')} · ₹${resource.attrs?.fee}`}
            </p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted">
            {arrived ? 'Journey complete' : isAmbulance ? 'Arriving in' : 'Travel time'}
          </span>
          <span className="text-2xl font-bold tabular-nums">
            {arrived ? `${live?.elapsedSimMin ?? ''}` : `${p50}–${p90} min`}
          </span>
        </div>
        {!arrived && (
          <p className="mt-1 text-xs text-muted">
            Usually about {p50} minutes; 90% of the time under {p90}.
            {eta ? ` Traffic ×${eta.trafficIndex}.` : ''}
          </p>
        )}

        {widened && notice && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            <strong>Arrival window widened</strong> — {notice}. Nothing has gone wrong; conditions
            changed and the estimate was updated.
          </p>
        )}

        {slot && (
          <p className="mt-3 rounded-lg bg-slate-50 p-2 text-sm">
            Your slot: <strong>{time(slot.start)}</strong> ({slot.mode})
          </p>
        )}
      </div>

      {isAmbulance && !arrived && live && (
        <MapView
          vehicles={[{ id: resource.id, name: resource.name, type: resource.attrs?.type, pos: live.pos, status: 'en route' }]}
          requests={[{ id: booking.request.id, tier: result?.tier, pos: live.to, state: 'in transit' }]}
          runs={[{ assignmentId: assignment._id, name: resource.name, pos: live.pos, to: live.to, etaP50Min: p50, etaP90Min: p90 }]}
          height={300}
          follow
        />
      )}

      {arrived && (
        <div className="rounded-xl border-2 border-green-400 bg-green-50 p-4">
          <h3 className="font-semibold text-green-900">{resource.name} has arrived</h3>
          <p className="mt-1 text-sm text-green-900">
            The unit is back in service and available for the next call.
          </p>
        </div>
      )}

      {fallback && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            <span aria-hidden="true">▲</span> A fallback was used
          </p>
          <p className="mt-0.5 text-xs text-amber-900">{fallback.note}</p>
        </div>
      )}

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Why this one was chosen</summary>
        <table className="mt-2 w-full text-xs">
          <tbody>
            {Object.entries(assignment.breakdown || {}).map(([k, v]) => (
              <tr key={k}>
                <td className="py-0.5 capitalize text-muted">{k.replace(/([A-Z])/g, ' $1')}</td>
                <td className="py-0.5 text-right">{String(v.raw)}</td>
                <td className="w-16 py-0.5 text-right tabular-nums">
                  {v.weighted >= 0 ? '+' : ''}
                  {v.weighted.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {assignment.rejectedAlternatives?.length > 0 && (
          <>
            <p className="mt-3 text-xs font-semibold">Not chosen</p>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {assignment.rejectedAlternatives.map((r, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span>{r.name}</span>
                  <span className="text-right">{r.reason}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </details>

      <p className="text-xs text-muted">
        Priority {result?.tier} · {result?.tierMeta?.label}. {result?.disclaimer}
      </p>

      <button className="btn-ghost w-full" onClick={onReset}>
        Start another request
      </button>
    </section>
  );
}
