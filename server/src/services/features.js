import {
  SYMPTOM_IDS,
  DURATION_BUCKETS,
  AGE_BUCKETS,
  FEATURE_DIM,
} from '../../../shared/enums.js';

/**
 * Turn a parsed intake into the model's 18-number input vector.
 *
 * This layout is a contract with ml-svc/train.py. If the two ever disagree the
 * model silently reads the wrong columns and produces confident nonsense, so
 * both sides derive their order from shared/enums.js FEATURE_ORDER and this
 * module is the only place the encoding lives.
 */

export function bucketDuration(hours) {
  const h = Number.isFinite(hours) ? hours : 6;
  return DURATION_BUCKETS.findIndex((b) => h <= b.maxHours);
}

export function bucketAge(age) {
  const a = Number.isFinite(age) ? age : 35;
  return AGE_BUCKETS.findIndex((b) => a <= b.maxAge);
}

export function buildFeatures(parsed, at = new Date()) {
  const x = new Array(FEATURE_DIM).fill(0);

  for (const tag of parsed.symptomTags || []) {
    const i = SYMPTOM_IDS.indexOf(tag);
    if (i >= 0) x[i] = 1;
  }

  x[12] = bucketDuration(parsed.durationHours) / 4;
  x[13] = bucketAge(parsed.age) / 5;
  x[14] = parsed.chronicFlag ? 1 : 0;
  x[15] = parsed.immobileFlag ? 1 : 0;
  x[16] = Math.min(5, Math.max(1, parsed.severitySelf || 3)) / 5;
  x[17] = at.getHours() / 23;

  return x;
}
