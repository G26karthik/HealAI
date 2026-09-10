import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createRequest } from '../lib/api';
import PrescriptionFlow from '../components/PrescriptionFlow';
import { TRIAGE_DISCLAIMER } from '@shared/enums.js';

/**
 * A direct door to the prescription flow.
 *
 * Ordering medicines does not need a triage interview — someone holding a
 * repeat prescription already knows what they want. Previously this screen was
 * only reachable by describing symptoms vague enough to score T4, which buried
 * the feature behind a path nobody would find.
 *
 * A request record is still created, because everything downstream (audit log,
 * pharmacy matching, order history) hangs off a request. It is just created
 * quietly, tagged as a routine follow-up, rather than being interviewed for.
 */
export default function Medicines() {
  const [requestId, setRequestId] = useState(null);
  const [coords, setCoords] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setCoords(null),
      { timeout: 4000 }
    );
  }, []);

  // Wait for the location attempt to settle before opening the request, so the
  // pharmacy search is centred on the right place.
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      createRequest({
        symptomTags: ['routine-followup'],
        severitySelf: 2,
        durationHours: 72,
        ...(coords || {}),
      })
        .then((r) => alive && setRequestId(r.id))
        .catch((e) => alive && setErr(e.message));
    }, coords ? 0 : 1200);

    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coords]);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <span className="eyebrow">Medicines</span>
        <h1 className="mt-3 text-3xl font-extrabold">Order from a prescription</h1>
        <p className="mt-2 text-muted">
          Photograph it and we will read the medicine names, find them at pharmacies near you, and
          suggest an equivalent for anything out of stock.
        </p>
      </header>

      {err && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Could not start an order</p>
          <p className="mt-0.5">{err}</p>
        </div>
      )}

      {!requestId && !err && (
        <div className="card flex items-center gap-3 p-5 text-sm text-muted">
          <span aria-hidden="true" className="animate-pulse text-xl">
            💊
          </span>
          Getting ready…
        </div>
      )}

      {requestId && <PrescriptionFlow requestId={requestId} onOrdered={() => setDone(true)} />}

      {!done && (
        <p className="rounded-xl border border-line bg-white p-3 text-xs text-muted">
          <strong className="text-ink">Feeling unwell rather than restocking?</strong>{' '}
          <Link to="/help" className="font-semibold text-brand-700 hover:underline">
            Describe what is wrong instead
          </Link>{' '}
          — that route can reach a doctor or an ambulance. {TRIAGE_DISCLAIMER}
        </p>
      )}
    </div>
  );
}
