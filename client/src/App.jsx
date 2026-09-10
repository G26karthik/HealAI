import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';

import { getHealth } from './lib/api';
import { useAuth } from './context/AuthContext';
import Landing from './pages/Landing';
import Login from './pages/Login';
import PatientHome from './pages/PatientHome';
import Dispatcher from './pages/Dispatcher';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/help', label: 'Get help' },
  { to: '/dispatch', label: 'Dispatcher' },
];

/** Dependency pill. Colour is never the only signal — each carries a glyph. */
function StatusPill({ label, state }) {
  const styles = {
    ok: 'border-green-300 bg-green-50 text-green-800',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    down: 'border-red-300 bg-red-50 text-red-800',
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

function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const away = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  if (!user) {
    return (
      <Link to="/login" className="btn-primary px-4 py-2 text-sm">
        Sign in
      </Link>
    );
  }

  const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('');

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-3 transition-colors hover:bg-slate-50"
      >
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">
          {initials}
        </span>
        <span className="hidden text-sm font-semibold sm:inline">{user.name.split(' ')[0]}</span>
        <span aria-hidden="true" className="text-xs text-muted">
          ▾
        </span>
      </button>

      {open && (
        <div role="menu" className="card absolute right-0 z-50 mt-2 w-60 p-3 shadow-lift">
          <p className="text-sm font-semibold">{user.name}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <span className="chip mt-2 border-brand-200 bg-brand-50 text-brand-700">{user.role}</span>
          {user.isDemo && (
            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
              Demo account — no real data.
            </p>
          )}
          <button className="btn-ghost mt-3 w-full text-sm" onClick={logout} role="menuitem">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const tab = ({ isActive }) =>
    `rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
      isActive ? 'bg-ink text-white' : 'text-muted hover:bg-slate-100 hover:text-ink'
    }`;

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-all ${
        scrolled ? 'border-line bg-white/90 shadow-soft backdrop-blur-md' : 'border-transparent bg-white/70 backdrop-blur'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-xl bg-brand-950 text-lg">
            🚑
          </span>
          <span>
            <span className="block text-base font-extrabold leading-none">HealAI</span>
            <span className="hidden text-[11px] leading-tight text-muted sm:block">
              Urgency-aware access &amp; dispatch
            </span>
          </span>
        </Link>

        <nav className="ml-4 hidden gap-1 md:flex" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={tab}>
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden lg:block">
            <HealthBar />
          </div>
          <AccountMenu />
          <button
            className="btn-quiet px-2 py-1 md:hidden"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-label="Menu"
          >
            <span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-line bg-white px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1" aria-label="Main, mobile">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={tab}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-3 lg:hidden">
            <HealthBar />
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <p className="flex items-center gap-2 font-extrabold">
            <span aria-hidden="true">🚑</span> HealAI
          </p>
          <p className="mt-2 text-sm text-muted">
            Urgency-aware healthcare access and emergency dispatch. Built for Engineering Day,
            problem statement P21.
          </p>
        </div>
        <div>
          <p className="text-sm font-bold">Explore</p>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            <li>
              <Link to="/help" className="hover:text-ink hover:underline">
                Get help
              </Link>
            </li>
            <li>
              <Link to="/dispatch" className="hover:text-ink hover:underline">
                Dispatcher console
              </Link>
            </li>
            <li>
              <a href="/#features" className="hover:text-ink hover:underline">
                Features
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="text-sm font-bold">Please read</p>
          <p className="mt-2 text-sm text-muted">
            A prototype running on synthetic data. HealAI assigns dispatch priority and coordinates
            access — <strong className="text-ink">it does not diagnose</strong>, and it names no
            medical condition. Every AI decision is logged and reviewable.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only-live focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        Skip to content
      </a>

      <Header />

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/help" element={<PatientHome />} />
          <Route path="/dispatch" element={<Dispatcher />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="*"
            element={
              <div className="py-20 text-center">
                <p className="text-5xl">🧭</p>
                <h1 className="mt-3 text-2xl font-extrabold">That page does not exist</h1>
                <Link to="/" className="btn-primary mt-5">
                  Back to the start
                </Link>
              </div>
            }
          />
        </Routes>
      </main>

      <Footer />
    </div>
  );
}
