import { useEffect, useState } from 'react';
import { SYMPTOM_TAGS, TRIAGE_DISCLAIMER } from '@shared/enums.js';
import { createRequest } from '../lib/api';
import TriageResult from '../components/TriageResult';
import OptionsList from '../components/OptionsList';
import BookingConfirmed from '../components/BookingConfirmed';
import PrescriptionFlow from '../components/PrescriptionFlow';

const DURATIONS = [
  { label: 'Under an hour', hours: 0.5 },
  { label: 'A few hours', hours: 3 },
  { label: 'Since yesterday', hours: 24 },
  { label: 'A few days', hours: 72 },
  { label: 'Over a week', hours: 200 },
];

const SEVERITY_WORDS = ['', 'Mild', 'Uncomfortable', 'Moderate', 'Severe', 'Unbearable'];

const EXAMPLES = [
  'Chest pain and breathlessness for the last 30 minutes, he is 62 and diabetic',
  'My mother has had a high fever since yesterday, she is 70 and cannot walk on her own',
  'Need a refill of my regular blood pressure prescription',
];

export default function PatientHome() {
  const [text, setText] = useState('');
  const [details, setDetails] = useState({
    age: '',
    durationHours: '',
    severitySelf: 3,
    chronicFlag: false,
    immobileFlag: false,
  });
  const [tags, setTags] = useState([]);
  const [showTags, setShowTags] = useState(false);
  const [coords, setCoords] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // intake → result → options → booked
  const [stage, setStage] = useState('intake');
  const [booking, setBooking] = useState(null);

  // Location is a convenience, never a blocker. If it is denied or unavailable
  // the server falls back to the city centre and everything still works.
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setCoords(null),
      { timeout: 4000 }
    );
  }, []);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        text: text.trim() || undefined,
        severitySelf: Number(details.severitySelf),
        chronicFlag: details.chronicFlag,
        immobileFlag: details.immobileFlag,
        ...(details.age ? { age: Number(details.age) } : {}),
        ...(details.durationHours ? { durationHours: Number(details.durationHours) } : {}),
        ...(tags.length ? { symptomTags: tags } : {}),
        ...(coords || {}),
      };
      setResult(await createRequest(body));
      setStage('result');
    } catch (err) {
      setError(err.message);
      // 422 means nothing recognisable was found — open the manual picker, which
      // is also the path used when language understanding is switched off.
      if (err.status === 422) setShowTags(true);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setBooking(null);
    setStage('intake');
    setText('');
    setTags([]);
    setError(null);
    setDetails({ age: '', durationHours: '', severitySelf: 3, chronicFlag: false, immobileFlag: false });
  };

  if (stage === 'booked') {
    return (
      <div className="mx-auto max-w-2xl">
        <BookingConfirmed booking={booking} result={result} onReset={reset} />
      </div>
    );
  }

  if (stage === 'options') {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <button className="text-sm font-medium text-blue-700 underline" onClick={() => setStage('result')}>
          ← Back to the priority
        </button>

        {/* A medicine need starts from the prescription, not from a provider
            list — you cannot rank pharmacies before you know what to dispense. */}
        {result.tierMeta.route === 'pharmacy' ? (
          <PrescriptionFlow requestId={result.id} />
        ) : (
          <OptionsList
            requestId={result.id}
            kind={result.tierMeta.route}
            tier={result.tier}
            needsHumanReview={result.needsHumanReview}
            onBooked={(res) => {
              setBooking(res);
              setStage('booked');
            }}
          />
        )}
      </div>
    );
  }

  if (stage === 'result') {
    return (
      <div className="mx-auto max-w-2xl">
        <TriageResult
          result={result}
          onReset={reset}
          onContinue={result.id ? () => setStage('options') : null}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <form onSubmit={submit} className="space-y-4">
        <div className="card p-4">
          <label htmlFor="desc" className="block text-lg font-semibold">
            What is happening?
          </label>
          <p className="mt-0.5 text-sm text-muted">
            Describe it in your own words, in any language. You can add details below.
          </p>
          <textarea
            id="desc"
            rows={3}
            className="input mt-3 resize-y text-base"
            placeholder="e.g. chest pain and breathlessness for 30 minutes, he is 62"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="self-center text-xs text-muted">Try:</span>
            {EXAMPLES.map((ex, i) => (
              <button
                key={ex}
                type="button"
                onClick={() => setText(ex)}
                className="chip border-line bg-slate-50 text-muted hover:bg-slate-100"
              >
                Example {i + 1}
              </button>
            ))}
          </div>
        </div>

        <fieldset className="card space-y-4 p-4">
          <legend className="px-1 text-sm font-semibold">Details (optional, improves accuracy)</legend>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="age">
                Age
              </label>
              <input
                id="age"
                type="number"
                min="0"
                max="120"
                className="input"
                placeholder="years"
                value={details.age}
                onChange={(e) => setDetails({ ...details, age: e.target.value })}
              />
            </div>
            <div>
              <label className="label" htmlFor="dur">
                How long has this been going on?
              </label>
              <select
                id="dur"
                className="input"
                value={details.durationHours}
                onChange={(e) => setDetails({ ...details, durationHours: e.target.value })}
              >
                <option value="">Not sure</option>
                {DURATIONS.map((d) => (
                  <option key={d.hours} value={d.hours}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="sev">
              How bad is it? — <span className="font-semibold text-ink">{SEVERITY_WORDS[details.severitySelf]}</span>
            </label>
            <input
              id="sev"
              type="range"
              min="1"
              max="5"
              step="1"
              className="w-full accent-blue-700"
              value={details.severitySelf}
              onChange={(e) => setDetails({ ...details, severitySelf: Number(e.target.value) })}
            />
            <div className="flex justify-between text-xs text-muted">
              <span>Mild</span>
              <span>Unbearable</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-700"
                checked={details.chronicFlag}
                onChange={(e) => setDetails({ ...details, chronicFlag: e.target.checked })}
              />
              Has a long-term condition
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-700"
                checked={details.immobileFlag}
                onChange={(e) => setDetails({ ...details, immobileFlag: e.target.checked })}
              />
              Cannot move unaided
            </label>
          </div>

          <div>
            <button
              type="button"
              className="text-sm font-medium text-blue-700 underline"
              onClick={() => setShowTags((s) => !s)}
              aria-expanded={showTags}
            >
              {showTags ? 'Hide' : 'Or pick from a list instead'}
            </button>

            {showTags && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SYMPTOM_TAGS.map((t) => {
                  const on = tags.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTags(on ? tags.filter((x) => x !== t.id) : [...tags, t.id])}
                      className={`chip ${
                        on ? 'border-blue-700 bg-blue-700 text-white' : 'border-line bg-white text-ink hover:bg-slate-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </fieldset>

        {error && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || (!text.trim() && tags.length === 0)}
          className="relative w-full rounded-2xl bg-tier-t1 px-6 py-6 text-white shadow-lg
                     transition-transform hover:bg-red-800 active:scale-[0.99]
                     disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          <span className="block text-2xl font-extrabold tracking-tight">
            {busy ? 'Checking…' : 'Get help now'}
          </span>
          <span className="mt-0.5 block text-sm text-red-100">
            {busy ? 'Reading your description and scoring urgency' : 'Finds the fastest route to care'}
          </span>
        </button>

        <p className="text-center text-xs text-muted">
          {coords ? '📍 Using your location' : '📍 Location unavailable — using city centre'}
        </p>
      </form>

      <p className="rounded-lg border border-line bg-white p-3 text-xs text-muted">
        <strong className="text-ink">Important.</strong> {TRIAGE_DISCLAIMER}
      </p>
    </div>
  );
}
