import { TIERS } from '@shared/enums.js';

// Tailwind needs complete class strings at build time, so these are looked up,
// never interpolated.
const TIER_STYLE = {
  T1: { box: 'bg-tier-t1 text-white', ring: 'border-red-300 bg-red-50', icon: '🚑' },
  T2: { box: 'bg-tier-t2 text-white', ring: 'border-orange-300 bg-orange-50', icon: '⏱️' },
  T3: { box: 'bg-tier-t3 text-white', ring: 'border-blue-300 bg-blue-50', icon: '🩺' },
  T4: { box: 'bg-tier-t4 text-white', ring: 'border-green-300 bg-green-50', icon: '💊' },
};

function ConfidenceBar({ value }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted">Model confidence</span>
        <span className="font-semibold tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${pct >= 65 ? 'bg-tier-t4' : 'bg-tier-t2'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-muted">
        Below 65% the request is sent to a human coordinator instead of being acted on.
      </p>
    </div>
  );
}

/** Why the system decided this. Bar length is the size of the contribution. */
function Drivers({ drivers }) {
  if (!drivers?.length) return null;
  const max = Math.max(...drivers.map((d) => Math.abs(d.delta)), 0.01);

  return (
    <div>
      <h3 className="text-sm font-semibold">What drove this</h3>
      <ul className="mt-2 space-y-2">
        {drivers.map((d) => {
          const up = d.delta >= 0;
          return (
            <li key={d.feature} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span aria-hidden="true" className={up ? 'text-tier-t1' : 'text-tier-t3'}>
                    {up ? '▲' : '▼'}
                  </span>{' '}
                  {d.label}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-muted">
                  {Math.round(Math.abs(d.delta) * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${up ? 'bg-tier-t1' : 'bg-tier-t3'}`}
                  style={{ width: `${(Math.abs(d.delta) / max) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted">
        Each fact is removed and the model re-run; the change in urgency is its contribution, shown
        as a share of the whole decision. <span aria-hidden="true">▲</span> made it more urgent,{' '}
        <span aria-hidden="true">▼</span> less urgent.
      </p>
    </div>
  );
}

/** Never degrade silently. If any part of the pipeline fell back, say so here. */
function ProvenanceBanner({ provenance }) {
  const { parseSource, triageSource, degraded, modelVersion } = provenance || {};
  const notes = [];
  if (parseSource === 'rule-fallback') notes.push('Language understanding was unavailable, so a keyword parser read your description.');
  if (parseSource === 'mock-fixture') notes.push('Language understanding is running on offline fixtures.');
  if (triageSource === 'rule-fallback') notes.push('The urgency model was unavailable, so a transparent rule table was used instead.');

  if (!notes.length) {
    return (
      <p className="text-xs text-muted">
        Scored by <span className="font-medium text-ink">{modelVersion}</span>, all services healthy.
      </p>
    );
  }

  return (
    <div className={`rounded-lg border p-3 ${degraded ? 'border-amber-300 bg-amber-50' : 'border-line bg-slate-50'}`}>
      <p className="text-sm font-semibold text-amber-900">
        <span aria-hidden="true">▲</span> Running in a reduced mode
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-900">
        {notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-amber-900">Your request was still processed, and a human will confirm it.</p>
    </div>
  );
}

const CONTINUE_LABEL = {
  ambulance: 'Find an ambulance',
  doctor: 'Find a doctor',
  pharmacy: 'Find a pharmacy',
};

export default function TriageResult({ result, onReset, onContinue }) {
  const meta = TIERS[result.tier];
  const style = TIER_STYLE[result.tier];

  return (
    <section className="space-y-4" aria-live="polite">
      <div className={`rounded-2xl p-5 ${style.box}`}>
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="text-3xl">
            {style.icon}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-90">
              Priority {result.tier} of 4
            </p>
            <h2 className="text-2xl font-bold leading-tight">{meta.label}</h2>
            <p className="mt-1 text-sm opacity-95">
              Target response within {meta.slaMin < 60 ? `${meta.slaMin} minutes` : `${Math.round(meta.slaMin / 60)} hours`}
            </p>
          </div>
        </div>
      </div>

      {result.needsHumanReview && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
          <h3 className="font-semibold text-amber-900">
            <span aria-hidden="true">👤</span> A human coordinator is reviewing this
          </h3>
          <p className="mt-1 text-sm text-amber-900">
            The system was not confident enough to act on its own, so it stopped and escalated.
          </p>
          {result.reviewReasons?.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-amber-900">
              {result.reviewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {result.safetyTieBreak && (
            <p className="mt-2 rounded-md bg-amber-100 p-2 text-sm text-amber-900">
              Two priorities were too close to separate, so the <strong>more urgent</strong> one was
              assumed while a person checks.
            </p>
          )}
        </div>
      )}

      <div className="card space-y-4 p-4">
        <p className="text-sm">{result.explanation}</p>
        <ConfidenceBar value={result.confidence} />
        <Drivers drivers={result.drivers} />
      </div>

      <ProvenanceBanner provenance={result.provenance} />

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Where AI was used</summary>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Reading your description</dt>
            <dd className="text-right font-medium">{result.provenance?.parseSource}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Scoring urgency</dt>
            <dd className="text-right font-medium">{result.provenance?.modelVersion}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Human review point</dt>
            <dd className="text-right font-medium">
              {result.needsHumanReview ? 'triggered — awaiting a person' : 'not triggered'}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Recognised details</dt>
            <dd className="text-right font-medium">{result.parsed?.symptomTags?.join(', ') || '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Time taken</dt>
            <dd className="text-right font-medium tabular-nums">
              {result.provenance?.latencyMs?.parse ?? 0}ms read · {result.provenance?.latencyMs?.triage ?? 0}ms score
            </dd>
          </div>
        </dl>
        {result.probabilities && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="text-xs font-semibold text-muted">Full distribution</p>
            <div className="mt-1 flex gap-3 text-xs tabular-nums">
              {Object.entries(result.probabilities).map(([t, p]) => (
                <span key={t} className={t === result.tier ? 'font-bold text-ink' : 'text-muted'}>
                  {t} {Math.round(p * 100)}%
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-muted">{result.disclaimer}</p>
      </details>

      <div className="flex flex-wrap gap-2">
        {onContinue && !result.needsHumanReview && (
          <button className="btn-primary flex-1" onClick={onContinue}>
            {CONTINUE_LABEL[result.tierMeta?.route] || 'Find help'}
          </button>
        )}
        <button className={`btn-ghost ${onContinue ? '' : 'w-full'}`} onClick={onReset}>
          Start another
        </button>
      </div>
    </section>
  );
}
