import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';

import { User } from '../models.js';
import { dbReady } from '../db.js';

/**
 * Authentication.
 *
 * scrypt from Node's own crypto rather than a bcrypt package: it is memory-hard,
 * it is built in, and it is one fewer dependency to install on a venue's wifi.
 * Comparison is constant-time, so a wrong password cannot be found by timing.
 *
 * Roles are enforced on the SERVER. Hiding a button is a courtesy to the user;
 * it is not access control, and a dispatcher-only action stays dispatcher-only
 * even if someone calls the endpoint directly.
 */

const TOKEN_TTL = '12h';

// A dev fallback keeps the app runnable before anyone sets a secret, but it is
// regenerated on every boot, so restarting invalidates old tokens rather than
// silently shipping a known signing key.
const SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[auth] no JWT_SECRET set — using a random per-boot secret (logins drop on restart)');
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored?.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const signToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role, name: user.name }, SECRET, { expiresIn: TOKEN_TTL });

export const publicUser = (u) => ({
  id: String(u._id),
  email: u.email,
  name: u.name,
  role: u.role,
  language: u.language,
  isDemo: u.isDemo,
});

/**
 * Reads the bearer token if one is present. Never rejects — plenty of the app
 * is deliberately usable without an account, and a patient in an emergency
 * should not be stopped at a sign-up wall.
 */
export async function attachUser(req, _res, next) {
  req.user = null;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token || !dbReady()) return next();

  try {
    const payload = jwt.verify(token, SECRET);
    const user = await User.findById(payload.sub).lean();
    if (user) req.user = publicUser(user);
  } catch {
    /* expired or tampered — treated as a guest */
  }
  next();
}

/** Gate an endpoint behind one or more roles. */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in to do that.', needsAuth: true });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `This action is for ${roles.join(' or ')} accounts. You are signed in as ${req.user.role}.`,
        needsRole: roles,
      });
    }
    next();
  };
