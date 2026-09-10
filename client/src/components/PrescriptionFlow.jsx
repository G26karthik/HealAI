import { useState } from 'react';
import { placeOrder, planOrder, scanPrescription } from '../lib/api';

/**
 * Photograph a prescription → order the medicines.
 *
 * The whole screen is built around one assumption: the transcription will
 * sometimes be wrong. So nothing is ordered from the photo directly. Every
 * line is shown with how confident the match was, uncertain and
 * prescription-only lines are marked, and the order button stays disabled
 * until a pharmacist signs off. That gate is enforced on the server too — this
 * UI is a convenience, not the control.
 */

const fileToDataUri = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

function ConfidenceTag({ value }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const style =
    pct >= 85 ? 'border-green-300 bg-green-50 text-green-900'
      : pct >= 70 ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-red-300 bg-red-50 text-red-900';
  return <span className={`chip ${style}`}>{pct}% match</span>;
}

function LineRow({ line, onToggle, included }) {
  const bad = line.status === 'unrecognised';
  return (
    <li className={`flex flex-wrap items-start gap-3 p-3 ${bad ? 'bg-red-50' : ''}`}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 accent-blue-700"
        checked={included}
        disabled={bad}
        onChange={onToggle}
        aria-label={`Include ${line.name || line.requested}`}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {line.name || line.requested}
          {line.strength ? <span className="text-muted"> · {line.strength}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          Read from the photo as “{line.requested}”
          {line.qty ? ` · qty ${line.qty}` : ''}
        </p>
        {bad && <p className="mt-1 text-xs text-red-900">{line.note}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <ConfidenceTag value={line.matchConfidence} />
          {line.rxRequired && (
            <span className="chip border-amber-300 bg-amber-50 text-amber-900">prescription-only</span>
          )}
          {line.needsHuman && !line.rxRequired && (
            <span className="chip border-amber-300 bg-amber-50 text-amber-900">needs checking</span>
          )}
          {line.alternatives?.length > 0 && (
            <span className="chip border-line bg-slate-50 text-muted">
              {line.alternatives.length} equivalent{line.alternatives.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export default function PrescriptionFlow({ requestId, onOrdered }) {
  const [stage, setStage] = useState('upload'); // upload → review → plan → done
  const [preview, setPreview] = useState(null);
  const [scan, setScan] = useState(null);
  const [included, setIncluded] = useState({});
  const [plan, setPlan] = useState(null);
  const [approver, setApprover] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8_000_000) return setErr('That photo is over 8MB. Please take a smaller one.');

    setBusy(true);
    setErr(null);
    try {
      const dataUri = await fileToDataUri(file);
      setPreview(dataUri);
      const res = await scanPrescription(dataUri, requestId);
      setScan(res);
      setIncluded(Object.fromEntries(res.lines.map((l, i) => [i, l.status === 'matched'])));
      setStage('review');
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const buildPlan = async () => {
    setBusy(true);
    setErr(null);
    try {
      const lines = scan.lines.filter((_, i) => included[i]);
      if (!lines.length) throw new Error('Select at least one medicine.');
      setPlan(await planOrder(requestId, lines));
      setStage('plan');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const order = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await placeOrder({
        requestId,
        prescriptionUrl: scan.prescriptionUrl,
        fulfilment: 'delivery',
        buckets: plan.plan,
        ...(plan.needsPharmacistApproval
          ? { pharmacistApproval: { approvedBy: approver, notes: 'verified on screen' } }
          : {}),
      });
      setStage('done');
      onOrdered?.(res);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------------------------------------------ */

  if (stage === 'upload') {
    return (
      <section className="space-y-3">
        <div className="card p-5 text-center">
          <span aria-hidden="true" className="text-4xl">📷</span>
          <h2 className="mt-2 text-lg font-semibold">Photograph your prescription</h2>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            We read the medicine names, match them to nearby pharmacies, and suggest equivalents for
            anything out of stock.
          </p>

          <label className="btn-primary mt-4 inline-flex cursor-pointer">
            {busy ? 'Reading…' : 'Choose a photo'}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} disabled={busy} />
          </label>
        </div>
        {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</p>}
      </section>
    );
  }

  if (stage === 'review') {
    const anyGated = scan.lines.some((l, i) => included[i] && (l.rxRequired || l.needsHuman));
    return (
      <section className="space-y-3">
        <div className="flex items-start gap-3">
          {preview && <img src={preview} alt="The prescription you uploaded" className="h-20 w-20 rounded-lg border border-line object-cover" />}
          <div>
            <h2 className="text-lg font-semibold">Check what we read</h2>
            <p className="text-sm text-muted">
              {scan.lines.length} item{scan.lines.length === 1 ? '' : 's'} found
              {scan.source !== 'model' && ' · vision unavailable, sample data shown'}
              {scan.stored === false && ' · photo not stored'}
            </p>
          </div>
        </div>

        <ul className="card divide-y divide-line">
          {scan.lines.map((l, i) => (
            <LineRow key={i} line={l} included={Boolean(included[i])} onToggle={() => setIncluded({ ...included, [i]: !included[i] })} />
          ))}
        </ul>

        <p className="rounded-lg border border-line bg-slate-50 p-3 text-xs text-muted">{scan.disclaimer}</p>

        {anyGated && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Some items need a pharmacist to confirm them before they can be dispensed. You can still
            continue — approval is the last step.
          </p>
        )}

        {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</p>}

        <button className="btn-primary w-full" onClick={buildPlan} disabled={busy}>
          {busy ? 'Finding pharmacies…' : 'Find pharmacies'}
        </button>
      </section>
    );
  }

  if (stage === 'plan') {
    const canOrder = !plan.needsPharmacistApproval || approver.trim().length > 2;
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your order</h2>

        {plan.laddersUsed?.length > 0 && plan.laddersUsed[0].id !== 'in-stock-nearest' && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-900">
              <span aria-hidden="true">▲</span> We could not fill this the ideal way
            </p>
            <ul className="mt-1 space-y-1 text-xs text-amber-900">
              {plan.laddersUsed.map((r) => (
                <li key={r.id}>
                  <strong>{r.label}</strong> — {r.note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.plan.map((b) => (
          <div key={b.pharmacyId} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{b.pharmacyName}</h3>
              <span className="text-sm text-muted">
                arrives in {b.etaP50Min}–{b.etaP90Min} min
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-sm">
              {b.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3">
                  <span>
                    {i.name} <span className="text-muted">× {i.qty}</span>
                    {i.substitutedFor && (
                      <span className="ml-1.5 chip border-amber-300 bg-amber-50 text-amber-900">
                        replaces {i.substitutedFor}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">₹{(i.price || 0) * (i.qty || 1)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm">
              <span className="text-muted">delivery ₹{b.deliveryFee}</span>
              <strong className="tabular-nums">₹{b.total}</strong>
            </div>
          </div>
        ))}

        {plan.unfilled?.length > 0 && (
          <div className="card p-3 text-sm">
            <p className="font-medium">Not available nearby — ordered in</p>
            <p className="text-muted">{plan.unfilled.map((u) => u.name).join(', ')}</p>
          </div>
        )}

        {plan.needsPharmacistApproval && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
            <h3 className="font-semibold text-amber-900">
              <span aria-hidden="true">👤</span> A pharmacist must approve this
            </h3>
            <p className="mt-1 text-sm text-amber-900">
              This basket contains prescription-only or substituted items. The order cannot be
              placed without a named pharmacist — and the server enforces this, not just this screen.
            </p>
            <label className="label mt-2 text-xs text-amber-900" htmlFor="appr">
              Pharmacist name
            </label>
            <input
              id="appr"
              className="input"
              placeholder="e.g. R. Nair"
              value={approver}
              onChange={(e) => setApprover(e.target.value)}
            />
          </div>
        )}

        {err && <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</p>}

        <div className="flex items-center justify-between gap-3">
          <span className="text-lg font-bold tabular-nums">Total ₹{plan.grandTotal}</span>
          <button className="btn-primary" onClick={order} disabled={busy || !canOrder}>
            {busy ? 'Placing…' : 'Place order'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3" aria-live="polite">
      <div className="rounded-2xl bg-tier-t4 p-5 text-white">
        <span aria-hidden="true" className="text-3xl">💊</span>
        <h2 className="mt-1 text-2xl font-bold">Order placed</h2>
        <p className="mt-1 text-sm opacity-95">
          {plan.plan.length > 1
            ? `Split across ${plan.plan.length} pharmacies — each part arrives separately.`
            : 'Arriving from ' + plan.plan[0].pharmacyName}
        </p>
      </div>
      {plan.needsPharmacistApproval && (
        <p className="card p-3 text-sm">
          Approved by <strong>{approver}</strong>. Recorded in the audit log.
        </p>
      )}
    </section>
  );
}
