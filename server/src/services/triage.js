import axios from 'axios';

import { env } from '../config/env.js';
import { chaos } from '../lib/chaos.js';
import { bucketAge, bucketDuration } from './features.js';
import { REVIEW_GATES, SOURCES, SYMPTOM_TAGS, TIERS, TRIAGE_DISCLAIMER } from '../../../shared/enums.js';

/**
 * Triage = "which queue does this belong in", never "what is wrong with them".
 *
 * Two ways to answer, and the caller is always told which was used:
 *   model         — the PyTorch classifier, calibrated, with an abstain gate
 *   rule-fallback — the transparent table below, when the model is unreachable
 *
 * The fallback is not a stub. It is the same acuity logic that generated the
 * model's training labels, which is why the two mostly agree, and why the
 * system stays usable when a judge switches the model off mid-demo.
 */

const TAG_ACUITY = {
  unconscious: 10.0,
  'trauma-bleeding': 9.0,
  'poisoning-suspected': 9.0,
  'chest-pain': 8.2,
  'breathing-difficulty': 8.0,
  'pregnancy-related': 7.0,
  burn: 6.0,
  'fracture-suspected': 5.0,
  'high-fever': 4.0,
  'abdominal-pain': 4.0,
  'minor-injury': 2.0,
  'routine-followup': 1.0,
};

const AGE_BUMP = [1.0, 0.2, 0.0, 0.25, 0.7, 1.2];
const LABELS = Object.fromEntries(SYMPTOM_TAGS.map((t) => [t.id, t.label.toLowerCase()]));

/** Transparent scoring table — every term here is explainable in one sentence. */
export function ruleTriage(parsed) {
  const tags = (parsed.symptomTags || []).filter((t) => t in TAG_ACUITY);
  const contributions = [];

  let score = 0;
  if (tags.length) {
    const acuities = tags.map((t) => TAG_ACUITY[t]);
    const peak = Math.max(...acuities);
    const lead = tags[acuities.indexOf(peak)];
    score = peak + 0.45 * (tags.length - 1);
    contributions.push({ feature: lead, label: LABELS[lead] || lead, delta: Number((peak / 10).toFixed(3)) });
  } else {
    score = 3.0; // nothing recognised — park it in routine and let a human look
  }

  const severity = Math.min(5, Math.max(1, parsed.severitySelf || 3));
  const sevDelta = (severity - 3) * 0.85;
  score += sevDelta;
  if (Math.abs(sevDelta) > 0.4) {
    contributions.push({ feature: 'severitySelf', label: 'severity reported by the caller', delta: Number((sevDelta / 10).toFixed(3)) });
  }

  const ageIdx = bucketAge(parsed.age);
  score += AGE_BUMP[ageIdx];
  if (AGE_BUMP[ageIdx] > 0.4) {
    contributions.push({ feature: 'ageBucket', label: 'patient age', delta: Number((AGE_BUMP[ageIdx] / 10).toFixed(3)) });
  }

  if (parsed.immobileFlag) {
    score += 1.5;
    contributions.push({ feature: 'immobileFlag', label: 'patient cannot move unaided', delta: 0.15 });
  }
  if (parsed.chronicFlag) {
    score += 0.6;
    contributions.push({ feature: 'chronicFlag', label: 'existing long-term condition', delta: 0.06 });
  }
  if (score < 7.0) score -= 0.42 * bucketDuration(parsed.durationHours);

  const tier = score >= 8.0 ? 'T1' : score >= 5.5 ? 'T2' : score >= 3.0 ? 'T3' : 'T4';

  // Near a threshold the table is genuinely unsure — say so instead of pretending.
  const distance = Math.min(...[8.0, 5.5, 3.0].map((th) => Math.abs(score - th)));
  const borderline = distance < 0.6;

  // Report contributions as shares of the total, matching the model's format so
  // the UI renders both paths identically and they stay comparable.
  const totalWeight = contributions.reduce((s, c) => s + Math.abs(c.delta), 0) || 1;
  const drivers = contributions
    .map((c) => ({ ...c, delta: Number((c.delta / totalWeight).toFixed(4)) }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  return {
    tier,
    confidence: borderline ? 0.5 : 0.62,
    probabilities: null,
    needsHumanReview: true, // the fallback ALWAYS asks for a human — it is not calibrated
    reviewReasons: [
      'the urgency model was unavailable, so a transparent rule table was used',
      ...(borderline ? [`the score ${score.toFixed(1)} sits close to a tier boundary`] : []),
    ],
    safetyTieBreak: false,
    drivers,
    ruleScore: Number(score.toFixed(2)),
    model_version: 'rule-table-v1',
    disclaimer: TRIAGE_DISCLAIMER,
  };
}

/**
 * @returns {{result: object, source: string, latencyMs: number, degraded: boolean, error?: string}}
 */
export async function triage(parsed, features) {
  const started = Date.now();

  if (chaos.is('killMlSvc')) {
    return {
      result: ruleTriage(parsed),
      source: SOURCES.RULE_FALLBACK,
      latencyMs: Date.now() - started,
      degraded: true,
      error: 'disabled from chaos panel',
    };
  }

  try {
    const { data } = await axios.post(
      `${env.mlSvc.url}/triage`,
      { features },
      { timeout: env.mlSvc.timeoutMs }
    );
    if (data?.error) throw new Error(data.error);
    if (!TIERS[data.tier]) throw new Error(`model returned unknown tier ${data.tier}`);

    return { result: data, source: SOURCES.MODEL, latencyMs: Date.now() - started, degraded: false };
  } catch (err) {
    return {
      result: ruleTriage(parsed),
      source: SOURCES.RULE_FALLBACK,
      latencyMs: Date.now() - started,
      degraded: true,
      error: err.message?.slice(0, 200),
    };
  }
}

/** Should this stop for a person? Model abstention, or any degraded path. */
export function requiresReview(result, degraded) {
  if (degraded) return true;
  if (result.needsHumanReview) return true;
  return (result.confidence ?? 0) < REVIEW_GATES.minConfidence;
}
