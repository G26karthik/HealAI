import 'dotenv/config';

const required = ['MONGODB_URI'];

// Google retires model ids. A retired id fails with a 404 that looks exactly
// like a network problem, so the app quietly runs on the keyword fallback and
// nobody notices until the demo. Name them and self-heal loudly instead.
const RETIRED_GEMINI_MODELS = new Set([
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
]);
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';

function resolveGeminiModel() {
  const configured = process.env.GEMINI_MODEL?.trim();
  if (!configured) return DEFAULT_GEMINI_MODEL;
  if (RETIRED_GEMINI_MODELS.has(configured)) {
    console.warn(
      `[env] GEMINI_MODEL="${configured}" is retired — using ${DEFAULT_GEMINI_MODEL}. ` +
        'Update server/.env to silence this.'
    );
    return DEFAULT_GEMINI_MODEL;
  }
  return configured;
}

export const env = {
  port: Number(process.env.PORT || 5000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI || '',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: resolveGeminiModel(),
    // Mock when explicitly asked OR when no key is present, so the build never
    // blocks on a missing credential.
    mock: process.env.GEMINI_MOCK === 'true' || !process.env.GEMINI_API_KEY,
  },

  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    configured: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY),
  },

  mlSvc: {
    url: process.env.ML_SVC_URL || 'http://localhost:8000',
    timeoutMs: Number(process.env.ML_SVC_TIMEOUT_MS || 2500),
  },
};

/** Warn loudly but never crash — a missing key must degrade, not stop the build. */
export function reportEnv() {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) console.warn(`[env] missing: ${missing.join(', ')}`);
  if (env.gemini.mock) console.warn('[env] Gemini running in MOCK mode (canned fixtures)');
  if (!env.cloudinary.configured) console.warn('[env] Cloudinary not configured — photo upload disabled');
  return { missing };
}
