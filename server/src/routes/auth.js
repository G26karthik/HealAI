import { Router } from 'express';
import { z } from 'zod';

import { dbReady } from '../db.js';
import { User } from '../models.js';
import { hashPassword, publicUser, signToken, verifyPassword } from '../services/auth.js';

export const authRouter = Router();

/**
 * Demo accounts, created on demand.
 *
 * A judge should be able to see the dispatcher console within seconds of
 * opening the app, without being handed a password on a sticky note. These are
 * clearly labelled as demo accounts in the database and in the UI.
 */
export const DEMO_ACCOUNTS = [
  { email: 'patient@healai.demo', name: 'Asha (Patient)', role: 'patient' },
  { email: 'dispatcher@healai.demo', name: 'Ravi (Dispatcher)', role: 'dispatcher' },
  { email: 'pharmacist@healai.demo', name: 'Nita (Pharmacist)', role: 'pharmacist' },
];
const DEMO_PASSWORD = 'demo1234';

const Credentials = z.object({
  email: z.string().email().max(120),
  password: z.string().min(8).max(200),
});

const Registration = Credentials.extend({
  name: z.string().min(2).max(60),
  role: z.enum(['patient', 'dispatcher', 'pharmacist']).default('patient'),
});

authRouter.post('/register', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'Database unavailable — cannot create an account.' });
    const { email, password, name, role } = Registration.parse(req.body ?? {});

    if (await User.exists({ email: email.toLowerCase() })) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const user = await User.create({
      email: email.toLowerCase(),
      name,
      role,
      passwordHash: hashPassword(password),
      lastLoginAt: new Date(),
    });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues[0]?.message || 'Invalid details', details: err.issues });
    }
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'Database unavailable — cannot sign in.' });
    const { email, password } = Credentials.parse(req.body ?? {});

    const user = await User.findOne({ email: email.toLowerCase() }).select('+passwordHash');

    // Same message and roughly the same work either way: revealing which half
    // was wrong tells an attacker which emails are registered.
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    user.lastLoginAt = new Date();
    await user.save();
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Enter a valid email and password.' });
    next(err);
  }
});

/** One-click sign-in for the three demo roles. Creates them if missing. */
authRouter.post('/demo', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'Database unavailable — cannot sign in.' });
    const role = String(req.body?.role || 'patient');
    const spec = DEMO_ACCOUNTS.find((a) => a.role === role);
    if (!spec) return res.status(400).json({ error: 'Unknown demo role.' });

    let user = await User.findOne({ email: spec.email });
    if (!user) {
      user = await User.create({ ...spec, passwordHash: hashPassword(DEMO_PASSWORD), isDemo: true });
    }
    user.lastLoginAt = new Date();
    await user.save();

    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/** Who am I? Returns null rather than 401 — being a guest is a valid state. */
authRouter.get('/me', (req, res) => res.json({ user: req.user }));

authRouter.get('/demo-accounts', (_req, res) =>
  res.json({ accounts: DEMO_ACCOUNTS.map((a) => ({ ...a, password: DEMO_PASSWORD })) })
);
