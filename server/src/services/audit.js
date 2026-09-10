import { AuditLog } from '../models.js';
import { dbReady } from '../db.js';

/**
 * Rule 1 of the event: "AI systems must explain inputs, outputs, limitations and
 * human-review points." This collection is the evidence for that claim — every
 * AI call and every human override lands here, and the UI reads it back as the
 * "Where AI was used" drawer.
 *
 * Auditing must never break the request it is auditing, so all failures here
 * are swallowed and logged to the console instead.
 */

export async function logAi({
  requestId,
  model,
  purpose,
  input,
  output,
  confidence,
  latencyMs,
  degraded = false,
}) {
  if (!dbReady()) return null;
  try {
    return await AuditLog.create({
      requestId,
      actor: 'ai',
      model,
      purpose,
      input,
      output,
      confidence,
      latencyMs,
      degraded,
    });
  } catch (err) {
    console.warn('[audit] ai log failed:', err.message);
    return null;
  }
}

export async function logHuman({ requestId, purpose, humanAction, input, output }) {
  if (!dbReady()) return null;
  try {
    return await AuditLog.create({
      requestId,
      actor: 'human',
      model: 'n/a',
      purpose,
      humanAction,
      input,
      output,
    });
  } catch (err) {
    console.warn('[audit] human log failed:', err.message);
    return null;
  }
}

export async function auditFor(requestId) {
  if (!dbReady()) return [];
  return AuditLog.find({ requestId }).sort({ ts: 1 }).lean();
}
