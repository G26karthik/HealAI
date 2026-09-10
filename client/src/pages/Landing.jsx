import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Reveal from '../components/Reveal';
import { useAuth } from '../context/AuthContext';
import { getHealth } from '../lib/api';

/**
 * The front door.
 *
 * Its job is to explain, in language a non-technical judge or patient can
 * follow in thirty seconds, what this does and why it is not just a booking
 * form. Every claim here is one the running app can actually demonstrate —
 * there is nothing on this page the demo cannot back up.
 */

const FEATURES = [
  {
    icon: '🗣️',
    title: 'Describe it in your own words',
    plain: 'Type or speak what is wrong, in any language. No forms, no medical jargon.',
    how: 'Gemini turns the sentence into structured facts. If it is unavailable, a keyword reader takes over and the screen says so.',
    tag: 'AI intake',
  },
  {
    icon: '🎯',
    title: 'Know how urgent it is',
    plain: 'You are placed in one of four queues — from emergency to a pharmacy visit — and told why.',
    how: 'A PyTorch model scores urgency and shows the three facts that drove it. It assigns a dispatch priority, never a diagnosis.',
    tag: 'Triage model',
  },
  {
    icon: '👤',
    title: 'A human checks the hard cases',
    plain: 'When the system is not confident, it stops and asks a real coordinator instead of guessing.',
    how: 'Below 65% confidence the model abstains. Dispatch is blocked until a named person confirms the priority.',
    tag: 'Human-in-the-loop',
  },
  {
    icon: '🚑',
    title: 'The right help, not just the nearest',
    plain: 'A closer ambulance is skipped if it cannot do what you need. You can see exactly why.',
    how: 'Candidates that fail a hard requirement are removed before ranking. The rest are scored on arrival time, capability, load and cost.',
    tag: 'Smart matching',
  },
  {
    icon: '🗺️',
    title: 'Watch it actually arrive',
    plain: 'A live map, and an arrival window rather than a single number that turns out to be wrong.',
    how: 'Vehicles move every second and traffic shifts. When the window widens, the app tells you what changed.',
    tag: 'Live tracking',
  },
  {
    icon: '💊',
    title: 'Photograph a prescription',
    plain: 'Snap it, and we find the medicines nearby — with an equivalent if something is out of stock.',
    how: 'Vision reads the names, they are matched to a real catalogue, and a pharmacist must approve anything prescription-only.',
    tag: 'Cloudinary + vision',
  },
  {
    icon: '🛟',
    title: 'A plan for when things go wrong',
    plain: 'No advanced ambulance free? No slot today? Out of stock? There is a documented next-best for each.',
    how: 'Every need has a fallback ladder. The rung that was used is recorded and shown to you in plain language.',
    tag: 'Fallback ladders',
  },
  {
    icon: '🔌',
    title: 'It keeps working when parts break',
    plain: 'Switch off the AI mid-demo and the app carries on — and openly says it is running in a reduced mode.',
    how: 'A chaos panel kills each dependency on demand. Every degraded response is labelled. Nothing silently guesses.',
    tag: 'Resilience',
  },
];

const STEPS = [
  { n: '01', t: 'Tell us what is happening', d: 'One sentence, any language, or pick from a list.' },
  { n: '02', t: 'Get a priority and the reason', d: 'With a confidence score, and a human check when it is uncertain.' },
  { n: '03', t: 'See the real options', d: 'Ranked ambulances, doctors or pharmacies — each explaining its own score.' },
  { n: '04', t: 'Track it to your door', d: 'Live position and an honest arrival window that updates as traffic changes.' },
];

const STATS = [
  { v: '4', l: 'priority tiers', s: 'emergency → pharmacy' },
  { v: '0', l: 'emergencies mis-routed', s: 'in model testing' },
  { v: '16%', l: 'sent to a human', s: 'when the model is unsure' },
  { v: '5', l: 'failure modes handled', s: 'proven live, not claimed' },
];

function Hero({ user }) {
  return (
    <section className="mesh relative isolate overflow-hidden rounded-3xl bg-brand-950 text-white">
      <div className="grid-lines absolute inset-0" aria-hidden="true" />

      <div className="relative px-6 py-16 sm:px-12 sm:py-24">
        <Reveal>
          <span className="chip border-white/25 bg-white/10 text-brand-100 backdrop-blur">
            <span aria-hidden="true">🩺</span> Problem statement P21 · Engineering Day
          </span>
        </Reveal>

        <Reveal delay={80}>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold leading-[1.08] sm:text-6xl">
            Help that arrives, <span className="text-gradient">and explains itself</span>
          </h1>
        </Reveal>

        <Reveal delay={160}>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-brand-100/90">
            Describe what is wrong in your own words. HealAI works out how urgent it is, finds the
            right ambulance, doctor or pharmacy, and tracks it to your door — showing its reasoning
            at every step, and stopping for a human when it is unsure.
          </p>
        </Reveal>

        <Reveal delay={240}>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/help"
              className="btn bg-tier-t1 px-6 py-3.5 text-base text-white shadow-lift hover:bg-red-800"
            >
              <span aria-hidden="true">🚑</span> Get help now
            </Link>
            <Link
              to="/dispatch"
              className="btn border border-white/25 bg-white/10 px-6 py-3.5 text-base text-white backdrop-blur hover:bg-white/20"
            >
              Open the dispatcher console
            </Link>
            {!user && (
              <Link to="/login" className="btn px-5 py-3.5 text-base text-brand-100 hover:bg-white/10">
                Sign in →
              </Link>
            )}
          </div>
        </Reveal>

        <Reveal delay={320}>
          <p className="mt-6 max-w-md text-sm text-brand-200/80">
            <strong className="text-white">Not a diagnostic tool.</strong> HealAI decides how
            quickly you are seen and by whom. It never names a condition.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function LiveStrip() {
  const [h, setH] = useState(null);
  useEffect(() => {
    getHealth().then(setH).catch(() => {});
  }, []);

  const dots = [
    ['Database', h?.mongo],
    ['Urgency model', h?.mlSvc],
    ['Language AI', h?.gemini === 'live'],
    ['Photo storage', h?.cloudinary],
  ];

  return (
    <Reveal className="-mt-6 px-4 sm:px-10">
      <div className="card flex flex-wrap items-center justify-between gap-4 px-5 py-3">
        <p className="text-sm font-semibold">System status</p>
        <div className="flex flex-wrap gap-4">
          {dots.map(([label, ok]) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-xs text-muted">
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${ok ? 'bg-tier-t4' : 'bg-amber-500'}`}
              />
              {label}
              <span className="sr-only-live">{ok ? 'healthy' : 'degraded'}</span>
            </span>
          ))}
        </div>
        <p className="text-xs text-muted">Live, from the running system</p>
      </div>
    </Reveal>
  );
}

function FeatureCard({ f, i }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal delay={(i % 4) * 70}>
      <article className="card card-hover group h-full p-5">
        <div className="flex items-start justify-between gap-3">
          <span aria-hidden="true" className="text-3xl transition-transform group-hover:scale-110">
            {f.icon}
          </span>
          <span className="chip border-brand-200 bg-brand-50 text-brand-700">{f.tag}</span>
        </div>
        <h3 className="mt-3 font-bold leading-snug">{f.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.plain}</p>

        <button
          className="mt-3 text-xs font-semibold text-brand-700 hover:underline"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? 'Hide the detail' : 'How it works →'}
        </button>
        {open && (
          <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-muted">{f.how}</p>
        )}
      </article>
    </Reveal>
  );
}

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="space-y-16 pb-10">
      <div>
        <Hero user={user} />
        <LiveStrip />
      </div>

      {/* ------------------------------------------------------- features */}
      <section id="features">
        <Reveal className="text-center">
          <span className="eyebrow">What it does</span>
          <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold sm:text-4xl">
            Eight things, explained without the jargon
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Tap <em>How it works</em> on any card for the technical version.
          </p>
        </Reveal>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <FeatureCard key={f.title} f={f} i={i} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- how it works */}
      <section id="how">
        <Reveal className="text-center">
          <span className="eyebrow">The journey</span>
          <h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">From a sentence to a doorstep</h2>
        </Reveal>

        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 90}>
              <li className="card relative h-full overflow-hidden p-5">
                <span
                  aria-hidden="true"
                  className="absolute -right-2 -top-4 text-6xl font-black text-brand-50"
                >
                  {s.n}
                </span>
                <div className="relative">
                  <span className="chip border-brand-200 bg-brand-50 text-brand-700">Step {i + 1}</span>
                  <h3 className="mt-2.5 font-bold">{s.t}</h3>
                  <p className="mt-1 text-sm text-muted">{s.d}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* --------------------------------------------------------- numbers */}
      <section>
        <Reveal>
          <div className="rounded-3xl bg-brand-950 px-6 py-12 text-white sm:px-12">
            <h2 className="text-center text-2xl font-extrabold sm:text-3xl">
              The numbers we can defend
            </h2>
            <dl className="mt-8 grid grid-cols-2 gap-6 lg:grid-cols-4">
              {STATS.map((s, i) => (
                <Reveal key={s.l} delay={i * 80}>
                  <div className="text-center">
                    <dd className="text-4xl font-extrabold text-brand-300">{s.v}</dd>
                    <dt className="mt-1 font-semibold">{s.l}</dt>
                    <p className="text-xs text-brand-200/80">{s.s}</p>
                  </div>
                </Reveal>
              ))}
            </dl>
            <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-brand-200/80">
              Measured on a held-out synthetic test set. The urgency model is not clinically
              validated and prioritises dispatch only — the full limitations are in the README.
            </p>
          </div>
        </Reveal>
      </section>

      {/* ------------------------------------------------------------- CTA */}
      <section>
        <Reveal>
          <div className="card flex flex-col items-center gap-4 p-10 text-center">
            <span aria-hidden="true" className="animate-floaty text-5xl">
              🚑
            </span>
            <h2 className="text-2xl font-extrabold sm:text-3xl">Try it in under a minute</h2>
            <p className="max-w-lg text-muted">
              Describe an emergency and watch the whole chain run — triage, matching, dispatch and
              live tracking. Or open the dispatcher console and break something on purpose.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link to="/help" className="btn-primary px-6 py-3">
                Start a request
              </Link>
              <Link to="/dispatch" className="btn-ghost px-6 py-3">
                Dispatcher console
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
