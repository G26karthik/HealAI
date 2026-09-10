import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { getHealth } from './lib/api';
import PatientHome from './pages/PatientHome';
import Dispatcher from './pages/Dispatcher';

/** Small dependency pill. Green = live, amber = degraded, red = down.
 *  Never colour alone — each pill carries its own label. */
function StatusPill({ label, state }) {
  const styles = {
    ok: 'bg-green-50 text-green-800 border-green-300',
    warn: 'bg-amber-50 text-amber-900 border-amber-300',
    down: 'bg-red-50 text-red-800 border-red-300',
  }[state];
  const glyph = { ok: '●', warn: '▲', down: '■' }[state];
  return (
    <span className={`chip ${styles}`} title={`${label}: ${state}`}>
      <span aria-hidden="true">{glyph}</span>
      {label}
    </span>
  );
}

function HealthBar() {
  const [h, setH] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      getHealth()
        .then((d) => alive && (setH(d), setErr(false)))
        .catch(() => alive && setErr(true));
    tick();
    const id = setInterval(tick, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (err) return <StatusPill label="API down" state="down" />;
  if (!h) return <span className="text-xs text-muted">checking…</span>;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="System dependency status">
      <StatusPill label="Mongo" state={h.mongo ? 'ok' : 'down'} />
      <StatusPill label="ML" state={h.mlSvc ? 'ok' : 'warn'} />
      <StatusPill label={`Gemini ${h.gemini}`} state={h.gemini === 'live' ? 'ok' : 'warn'} />
      <StatusPill label="Cloudinary" state={h.cloudinary ? 'ok' : 'warn'} />
    </div>
  );
}

const tab = ({ isActive }) =>
  `px-3 py-1.5 rounded-lg text-sm font-medium ${
    isActive ? 'bg-ink text-white' : 'text-muted hover:bg-slate-200'
  }`;

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xl">🚑</span>
            <div>
              <h1 className="text-base font-bold leading-none">MediRoute</h1>
              <p className="text-[11px] leading-tight text-muted">
                Urgency-aware healthcare access &amp; dispatch
              </p>
            </div>
          </div>

          <nav className="flex gap-1" aria-label="Role">
            <NavLink to="/" className={tab} end>
              Patient
            </NavLink>
            <NavLink to="/dispatch" className={tab}>
              Dispatcher
            </NavLink>
          </nav>

          <div className="ml-auto">
            <HealthBar />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<PatientHome />} />
          <Route path="/dispatch" element={<Dispatcher />} />
        </Routes>
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-muted">
        Prototype on synthetic data. MediRoute assigns dispatch priority and coordinates access — it
        does not diagnose, and it names no medical condition.
      </footer>
    </div>
  );
}
