import { useState } from 'react';
import { TIER_CODES, TIERS } from '@shared/enums.js';
import { reviewRequest } from '../lib/api';

const TIER_CHIP = {
  T1: 'border-red-300 bg-red-50 text-red-900',
  T2: 'border-orange-300 bg-orange-50 text-orange-900',
  T3: 'border-blue-300 bg-blue-50 text-blue-900',
  T4: 'border-green-300 bg-green-50 text-green-900',
};

const ago = (d) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(d)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};

/**
 * One row in the dispatch queue. If the system abstained, the row turns into a
 * decision surface: the dispatcher confirms the suggested tier or overrides it,
 * and either way a reason is recorded against the request.
 */
function Row({ request, onReviewed }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const needsReview = request.needsHumanReview;

  const decide = async (tier) => {
    setBusy(true);
    try {
      const res = await reviewRequest(request._id, {
        tier,
        reviewedBy: 'dispatcher',
        reason: reason || (tier === request.tier ? 'confirmed as suggested' : 'clinical judgement'),
      });
      onReviewed(res);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={`p-3 ${needsReview ? 'bg-amber-50' : ''}`}>
      <div className="flex items-start gap-3">
        <span className={`chip shrink-0 ${TIER_CHIP[request.tier]}`}>{request.tier}</span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {request.rawInput || request.parsed?.symptomTags?.join(', ') || 'Request'}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{TIERS[request.tier]?.label}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{Math.round((request.confidence ?? 0) * 100)}% confident</span>
            <span aria-hidden="true">·</span>
            <span>{request.zoneId}</span>
            <span aria-hidden="true">·</span>
            <span>{ago(request.createdAt)} ago</span>
            {request.triageSource === 'rule-fallback' && (
              <span className="chip border-amber-300 bg-amber-100 text-amber-900">rule fallback</span>
            )}
            {request.triageSource === 'human-reviewed' && (
              <span className="chip border-green-300 bg-green-100 text-green-900">human confirmed</span>
            )}
          </p>
        </div>

        <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Less' : 'Why'}
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-lg border border-line bg-white p-3 text-xs">
          <p className="font-semibold">What drove this</p>
          <ul className="mt-1 space-y-0.5">
            {(request.drivers || []).map((d) => (
              <li key={d.feature} className="flex justify-between gap-3">
                <span>{d.label}</span>
                <span className="tabular-nums text-muted">
                  <span aria-hidden="true">{d.delta >= 0 ? '▲' : '▼'}</span>{' '}
                  {Math.round(Math.abs(d.delta) * 100)}%
                </span>
              </li>
            ))}
            {!request.drivers?.length && <li className="text-muted">no attribution recorded</li>}
          </ul>
          {request.humanReview?.reviewedBy && (
            <p className="mt-2 text-muted">
              Reviewed by {request.humanReview.reviewedBy}
              {request.humanReview.originalTier !== request.tier &&
                ` — overridden from ${request.humanReview.originalTier}`}
              {request.humanReview.reason ? ` (${request.humanReview.reason})` : ''}
            </p>
          )}
        </div>
      )}

      {needsReview && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-white p-3">
          <p className="text-xs font-semibold text-amber-900">
            The system stopped here — it needs a person
          </p>
          {request.parsed?.parseSource && (
            <p className="mt-0.5 text-xs text-muted">
              Suggested <strong>{request.tier}</strong> at {Math.round((request.confidence ?? 0) * 100)}% confidence
            </p>
          )}

          <label className="label mt-2 text-xs" htmlFor={`reason-${request._id}`}>
            Reason (recorded in the audit log)
          </label>
          <input
            id={`reason-${request._id}`}
            className="input py-1 text-sm"
            placeholder="optional"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => decide(request.tier)}>
              Confirm {request.tier}
            </button>
            {TIER_CODES.filter((t) => t !== request.tier).map((t) => (
              <button key={t} className="btn-ghost px-3 py-1 text-xs" disabled={busy} onClick={() => decide(t)}>
                Change to {t}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export default function RequestQueue({ requests, onReviewed, loading }) {
  const reviewCount = requests.filter((r) => r.needsHumanReview).length;

  return (
    <section className="card" aria-labelledby="queue-h">
      <div className="flex items-center justify-between gap-3 border-b border-line p-4">
        <div>
          <h2 id="queue-h" className="font-semibold">
            Dispatch queue
          </h2>
          <p className="text-sm text-muted">Most urgent first, then longest waiting.</p>
        </div>
        {reviewCount > 0 && (
          <span className="chip border-amber-300 bg-amber-50 text-amber-900">
            {reviewCount} awaiting review
          </span>
        )}
      </div>

      {loading && <p className="p-4 text-sm text-muted">Loading…</p>}

      {!loading && requests.length === 0 && (
        <p className="p-4 text-sm text-muted">
          No requests yet. Submit one from the Patient tab and it will appear here instantly.
        </p>
      )}

      <ul className="divide-y divide-line">
        {requests.map((r) => (
          <Row key={r._id} request={r} onReviewed={onReviewed} />
        ))}
      </ul>
    </section>
  );
}
