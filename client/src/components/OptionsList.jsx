import { useEffect, useState } from 'react';
import { createAssignment, getOptions } from '../lib/api';

const KIND_LABEL = {
  ambulance: { title: 'Ambulances', unit: 'unit', verb: 'Dispatch' },
  doctor: { title: 'Doctors', unit: 'doctor', verb: 'Book' },
  pharmacy: { title: 'Pharmacies', unit: 'pharmacy', verb: 'Order from' },
};

const time = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

/**
 * The cost breakdown, rendered.
 *
 * Ranking a list is easy; being able to defend the ranking is the point. Each
 * term shows its weighted contribution, so "why is this one first?" is answered
 * on screen instead of in a slide.
 */
function CostBreakdown({ breakdown, cost }) {
  const rows = [
    ['Travel time', breakdown.eta, `${breakdown.eta.raw} min`],
    ['Capability fit', breakdown.capability, breakdown.capability.raw],
    ['How busy', breakdown.load, breakdown.load.raw],
    ['Cost to you', breakdown.patientCost, breakdown.patientCost.raw],
    ['Urgency credit', breakdown.urgency, breakdown.urgency.raw],
  ];
  const max = Math.max(...rows.map(([, r]) => Math.abs(r.weighted)), 0.01);

  return (
    <div className="mt-3 rounded-lg border border-line bg-slate-50 p-3">
      <p className="text-xs font-semibold">Why this score</p>
      <table className="mt-1.5 w-full text-xs">
        <tbody>
          {rows.map(([label, r, raw]) => (
            <tr key={label}>
              <td className="py-0.5 pr-2 text-muted">{label}</td>
              <td className="py-0.5 pr-2 text-right tabular-nums">{raw}</td>
              <td className="w-24 py-0.5">
                <div className="h-1.5 w-full rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${r.weighted >= 0 ? 'bg-slate-500' : 'bg-tier-t4'}`}
                    style={{ width: `${(Math.abs(r.weighted) / max) * 100}%` }}
                  />
                </div>
              </td>
              <td className="w-14 py-0.5 text-right tabular-nums text-muted">
                {r.weighted >= 0 ? '+' : ''}
                {r.weighted.toFixed(2)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-line font-semibold">
            <td className="pt-1" colSpan={3}>
              Total cost (lower is better)
            </td>
            <td className="pt-1 text-right tabular-nums">{cost.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-muted">
        Positive numbers push an option down the list; the urgency credit pulls every option up
        equally, and decides who wins when several patients want the same unit.
      </p>
    </div>
  );
}

function OptionCard({ option, kind, rank, onBook, busy }) {
  const [open, setOpen] = useState(false);
  const a = option.attrs || {};

  return (
    <li className={`card p-4 ${rank === 0 ? 'ring-2 ring-blue-600' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{option.name}</h3>
            {rank === 0 && <span className="chip border-blue-300 bg-blue-50 text-blue-900">best match</span>}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {kind === 'ambulance' && `${a.type} · ${a.crewSkill}`}
            {kind === 'doctor' && `${a.specialty?.replace('-', ' ')} · ₹${a.fee}`}
            {kind === 'pharmacy' && `delivery ₹${a.deliveryFee}`}
            {option.rating ? ` · ★ ${option.rating}` : ''}
          </p>
        </div>

        <div className="text-right">
          <p className="text-lg font-bold tabular-nums leading-none">
            {option.eta.p50Min}–{option.eta.p90Min} min
          </p>
          <p className="text-xs text-muted">
            {(option.eta.distanceM / 1000).toFixed(1)} km · traffic ×{option.eta.trafficIndex}
          </p>
          {option.slot && <p className="mt-0.5 text-xs font-medium">slot {time(option.slot.start)}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn-primary text-sm" disabled={busy} onClick={() => onBook(option)}>
          {busy ? 'Confirming…' : `${KIND_LABEL[kind].verb} ${option.name}`}
        </button>
        <button className="btn-ghost text-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Hide reasoning' : 'Why this one?'}
        </button>
      </div>

      {open && <CostBreakdown breakdown={option.breakdown} cost={option.cost} />}
    </li>
  );
}

export default function OptionsList({ requestId, kind, tier, needsHumanReview, onBooked }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setErr(null);
    getOptions(requestId, kind).then(setData).catch((e) => setErr(e.message));
  };

  useEffect(load, [requestId, kind]);

  const book = async (option) => {
    setBusyId(option.resourceId);
    setErr(null);
    try {
      const res = await createAssignment({
        requestId,
        resourceId: option.resourceId,
        kind,
        ...(option.slot ? { slotStart: new Date(option.slot.start).toISOString() } : {}),
      });
      onBooked(res);
    } catch (e) {
      setErr(e.message);
      load(); // the world moved on — re-rank rather than leave a stale list
    } finally {
      setBusyId(null);
    }
  };

  if (needsHumanReview) {
    return (
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
        <h3 className="font-semibold text-amber-900">Waiting for a coordinator</h3>
        <p className="mt-1 text-sm text-amber-900">
          Nothing can be dispatched until a person confirms the priority. This is deliberate — the
          system does not act on its own judgement when it is unsure.
        </p>
      </div>
    );
  }

  if (err && !data) return <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</p>;
  if (!data) return <p className="text-sm text-muted">Searching nearby…</p>;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{KIND_LABEL[kind].title} near you</h2>
        <p className="text-xs text-muted">
          {data.candidatesScanned} scanned · ranked on{' '}
          <strong>{data.riskPosture === 'p90' ? 'worst-case (p90)' : 'typical (p50)'}</strong> arrival
          {data.riskPosture === 'p90' ? ' — this is an emergency' : ''}
        </p>
      </div>

      {data.fallback && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">
            <span aria-hidden="true">▲</span> Fallback used — {data.fallback.rung.replace(/-/g, ' ')}
          </p>
          <p className="mt-0.5 text-xs text-amber-900">{data.fallback.note}</p>
        </div>
      )}

      {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</p>}

      {data.options.length === 0 ? (
        <p className="card p-4 text-sm text-muted">
          Nothing available in range. A dispatcher has been alerted.
        </p>
      ) : (
        <ul className="space-y-3">
          {data.options.slice(0, 4).map((o, i) => (
            <OptionCard
              key={o.resourceId}
              option={o}
              kind={kind}
              rank={i}
              busy={busyId === o.resourceId}
              onBook={book}
            />
          ))}
        </ul>
      )}

      {/* The most persuasive part of the whole screen: what was ruled out, and why.
          On a T1 the nearest vehicle is often here, rejected for lacking ALS. */}
      {data.rejected?.length > 0 && (
        <details className="card p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            {data.rejected.length} ruled out — including closer ones
          </summary>
          <ul className="mt-2 space-y-1 text-sm">
            {data.rejected.slice(0, 8).map((r) => (
              <li key={r.id} className="flex justify-between gap-3">
                <span className="text-muted">
                  {r.name} · {(r.distanceM / 1000).toFixed(1)} km
                </span>
                <span className="text-right text-tier-t1">{r.reason}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            Nearest is not the same as nearest suitable. Options that cannot meet the requirement are
            removed before ranking, not merely scored lower.
          </p>
        </details>
      )}
    </section>
  );
}
