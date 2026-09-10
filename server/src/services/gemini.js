import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';

import { env } from '../config/env.js';
import { chaos } from '../lib/chaos.js';
import { SYMPTOM_IDS, SYMPTOM_TAGS, TRIAGE_DISCLAIMER } from '../../../shared/enums.js';

/**
 * Gemini has exactly one job in F1: turn a messy human sentence into tidy
 * structured fields. It never assigns a tier and it never names a condition —
 * the PyTorch model decides urgency, and it decides from numbers only.
 *
 * Three ways this can run, and the UI always says which:
 *   model      — Gemini answered
 *   mock-fixture — no API key, or GEMINI_MOCK=true
 *   rule-fallback — Gemini failed or was killed from the chaos panel
 */

const ai = env.gemini.apiKey ? new GoogleGenAI({ apiKey: env.gemini.apiKey }) : null;

// A patient in an emergency cannot wait on a hung API call. Whatever the SDK
// does internally, the caller is unblocked after this and takes the fallback.
// Tuned against the real model: it reasons before answering, so a few seconds
// is normal and anything past this is a fault, not slowness.
const CALL_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);

function withTimeout(promise, ms = CALL_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`gemini timed out after ${ms}ms`)), ms)),
  ]);
}

// Current Flash models reason before answering, and that reasoning is billed
// against maxOutputTokens. With a small budget the model spends it all thinking
// and returns TRUNCATED JSON — which surfaces as a JSON parse error, not a
// quota error, so it is easy to misdiagnose. Reasoning cannot be switched off
// on this model (thinkingBudget: 0 is rejected with 400 INVALID_ARGUMENT), so
// the fix is headroom: keep maxOutputTokens well above what the answer needs.
const OUTPUT_TOKENS = 2048;

const SYSTEM_INSTRUCTION = `You are an intake clerk for a medical DISPATCH service.

Your ONLY task is to convert the caller's words into structured administrative fields.

STRICT RULES:
- You must NEVER diagnose, name a disease or condition, or suggest treatment.
- You must NEVER decide urgency, priority or which tier a case belongs to.
- Only use symptom tags from the provided list. If nothing fits, use an empty list.
- If a detail is not stated, omit it rather than inventing it.
- The caller may write in any language. Detect it and report its ISO code.`;

// The parser may only emit tags the model was trained on. This is what keeps
// free text from ever reaching the classifier as an unknown category.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    symptomTags: {
      type: 'ARRAY',
      description: 'Administrative symptom tags present in the message.',
      items: { type: 'STRING', enum: SYMPTOM_IDS },
    },
    durationHours: { type: 'NUMBER', description: 'How long it has been going on, in hours.' },
    age: { type: 'NUMBER', description: 'Patient age in years if stated.' },
    chronicFlag: { type: 'BOOLEAN', description: 'An existing long-term condition is mentioned.' },
    immobileFlag: { type: 'BOOLEAN', description: 'The patient cannot move or walk unaided.' },
    severitySelf: { type: 'NUMBER', description: 'Severity the caller conveys, 1 (mild) to 5 (worst).' },
    language: { type: 'STRING', description: 'ISO 639-1 code of the message language.' },
  },
  required: ['symptomTags'],
};

const ParsedSchema = z.object({
  symptomTags: z.array(z.enum(SYMPTOM_IDS)).default([]),
  durationHours: z.number().min(0).max(8760).optional(),
  age: z.number().min(0).max(120).optional(),
  chronicFlag: z.boolean().optional(),
  immobileFlag: z.boolean().optional(),
  severitySelf: z.number().min(1).max(5).optional(),
  language: z.string().min(2).max(8).optional(),
});

/* -------------------------------------------------------------------------
 * Keyword fallback. Doubles as the offline mock and as the answer when Gemini
 * is unreachable, so the degraded path is exercised on every mock run rather
 * than being discovered broken during the demo.
 * ---------------------------------------------------------------------- */
/**
 * Word-boundary regexes, NOT substring matching.
 *
 * This started as a plain `text.includes(word)` list and it routed
 * "refill my blood pressure prescription" to T1 EMERGENCY DISPATCH, because
 * "blood" appears inside "blood pressure". A prescription refill would have
 * summoned an ambulance. Substring matching on clinical vocabulary is unsafe:
 * "blood pressure", "blood sugar", "blood test" and "heartburn" all contain
 * higher-acuity words. Every pattern below is anchored, and the phrases that
 * caused false positives are excluded explicitly.
 */
const NEGATIVE_CONTEXT = /\bblood (?:pressure|sugar|test|report|group|count)\b|\bbp\b/i;

const KEYWORDS = {
  'chest-pain': [/\bchest (?:pain|pressure|tightness|discomfort)\b/, /\bseene\b/, /\bchaati\b/],
  'breathing-difficulty': [
    /\b(?:breathless|breathlessness)\b/,
    /\b(?:difficulty|trouble|short(?:ness)?) (?:of |in )?breath\w*/,
    /\bcan'?not breathe\b/,
    /\bsaans\b/,
    /\bsuffocat\w*/,
    /\bwheez\w*/,
  ],
  'trauma-bleeding': [
    /\bbleed\w*/, // "bleed", "bleeding" — deliberately NOT bare "blood"
    /\bblood loss\b/,
    /\bhaemorrhag\w*|\bhemorrhag\w*/,
    /\bkhoon\b/,
    /\bdeep cut\b/,
    /\bwound\b/,
    /\baccident\b/,
  ],
  unconscious: [/\bunconscious\b/, /\bfainted\b/, /\bpassed out\b/, /\bnot responding\b/, /\bbehosh\b/],
  'poisoning-suspected': [/\bpoison\w*/, /\bswallowed\b/, /\boverdose\b/, /\bzeher\b/],
  'pregnancy-related': [/\bpregnan\w*/, /\blabou?r pains?\b/, /\bcontractions?\b/, /\bgarbh\w*/],
  burn: [/\bburn(?:t|ed|s|ing)?\b/, /\bscald\w*/, /\bjal gaya\b/],
  'fracture-suspected': [/\bfractur\w*/, /\bbroken (?:bone|arm|leg|wrist|hip)\b/, /\bsprain\w*/, /\bhaddi\b/],
  'high-fever': [/\bfever\b/, /\bhigh temperature\b/, /\bbukhar\b/, /\bchills\b/],
  'abdominal-pain': [/\bstomach\b/, /\babdom\w*/, /\bbelly\b/, /\bpet dard\b/, /\bnausea\b/, /\bvomit\w*/],
  'minor-injury': [/\bscrape\b/, /\bbruise\b/, /\bsmall cut\b/, /\bminor injury\b/],
  'routine-followup': [
    /\brefill\b/,
    /\bfollow[- ]?up\b/,
    /\bcheck[- ]?up\b/,
    /\bprescription\b/,
    /\broutine\b/,
    /\brepeat medicine\b/,
  ],
};

const DURATION_PATTERNS = [
  [/(\d+)\s*(min|minute)/i, (n) => n / 60],
  [/(\d+)\s*(hr|hour|ghant)/i, (n) => n],
  [/(\d+)\s*(day|din)/i, (n) => n * 24],
  [/(\d+)\s*(week|hafta)/i, (n) => n * 168],
];

export function heuristicParse(text = '') {
  const t = String(text).toLowerCase();

  // Strip phrases that legitimately contain higher-acuity words before matching,
  // so "blood pressure" can never register as bleeding.
  const scannable = t.replace(NEGATIVE_CONTEXT, ' ');

  const symptomTags = Object.entries(KEYWORDS)
    .filter(([, patterns]) => patterns.some((re) => re.test(scannable)))
    .map(([tag]) => tag);

  let durationHours;
  for (const [re, toHours] of DURATION_PATTERNS) {
    const m = t.match(re);
    if (m) {
      durationHours = toHours(Number(m[1]));
      break;
    }
  }

  const ageMatch = t.match(/(?:age|aged|years old|yr old|saal)\D{0,6}(\d{1,3})/i) || t.match(/\b(\d{1,3})\s*(?:years old|yrs|y\/o)\b/i);
  const age = ageMatch ? Number(ageMatch[1]) : undefined;

  const severe = /severe|unbearable|worst|very bad|bohot|emergency|serious|can't|cannot/i.test(t);
  const mild = /mild|slight|little|thoda|bearable/i.test(t);

  return {
    symptomTags,
    durationHours,
    age,
    // "blood pressure" IS a long-term-condition signal — it just is not bleeding.
    chronicFlag:
      /\bdiabet\w*|\basthma\b|\bhypertens\w*|\bheart condition\b|\bbp\b|\bblood pressure\b|\bkidney\b|\bcancer\b|\bcopd\b/i.test(
        t
      ) || undefined,
    immobileFlag: /can'?t (walk|move|stand)|cannot (walk|move|stand)|unable to move|collapsed/i.test(t) || undefined,
    severitySelf: severe ? 5 : mild ? 2 : 3,
    language: /[ऀ-ॿ]/.test(text) ? 'hi' : 'en',
  };
}

/* -------------------------------------------------------------------------
 * Guardrail. Even with a system instruction, a model can drift into clinical
 * language. Anything that reads like a diagnosis is replaced, not shipped.
 * ---------------------------------------------------------------------- */
const FORBIDDEN = [
  /\byou (?:have|may have|might have|likely have)\b/i,
  /\b(?:diagnos|likely condition|probable cause|suffering from)\w*/i,
  /\btake \d+\s*(?:mg|ml|tablet)/i,
  /\b(?:prescrib|you should take)\w*/i,
];

export function guardText(text) {
  const hit = FORBIDDEN.find((re) => re.test(text));
  if (!hit) return { text, blocked: false };
  return {
    text: `We have recorded your request and routed it for review. ${TRIAGE_DISCLAIMER}`,
    blocked: true,
    pattern: String(hit),
  };
}

/* ---------------------------------------------------------------------- */

/**
 * @returns {{parsed: object, source: 'model'|'mock-fixture'|'rule-fallback', latencyMs: number, error?: string}}
 */
/**
 * Identical text, identical answer — so ask once.
 *
 * The free tier allows 20 generate_content calls PER DAY. A demo rehearsal
 * that runs the same three sentences repeatedly will exhaust that before the
 * event starts. Parsing is deterministic (temperature 0), so caching costs
 * nothing in quality and buys back the entire quota.
 */
const parseCache = new Map();
const CACHE_MAX = 200;

function cacheGet(key) {
  return parseCache.get(key);
}
function cacheSet(key, value) {
  if (parseCache.size >= CACHE_MAX) parseCache.delete(parseCache.keys().next().value);
  parseCache.set(key, value);
}

export async function parseIntake(text) {
  const started = Date.now();
  const key = String(text).trim().toLowerCase();

  const hit = cacheGet(key);
  if (hit) return { parsed: hit, source: 'model', latencyMs: 0, cached: true };

  if (chaos.is('killGemini')) {
    return { parsed: heuristicParse(text), source: 'rule-fallback', latencyMs: Date.now() - started, error: 'disabled from chaos panel' };
  }
  if (env.gemini.mock || !ai) {
    return { parsed: heuristicParse(text), source: 'mock-fixture', latencyMs: Date.now() - started };
  }

  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model: env.gemini.model,
        contents: `Caller's message:\n"""${String(text).slice(0, 2000)}"""`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          maxOutputTokens: OUTPUT_TOKENS,
        },
      })
    );

    if (!res.text) throw new Error(`empty response (finish reason: ${res.candidates?.[0]?.finishReason})`);
    const raw = JSON.parse(res.text);
    const parsed = ParsedSchema.parse(raw); // reject anything off-schema
    cacheSet(key, parsed);
    return { parsed, source: 'model', latencyMs: Date.now() - started };
  } catch (err) {
    // Any failure — network, quota, malformed JSON, schema violation — degrades
    // to the keyword parser rather than failing the patient's request.
    // Loud in the terminal, because a silent fallback during a build is a bug
    // you only discover on stage.
    const quota = /RESOURCE_EXHAUSTED|429/.test(err.message || '');
    console.warn(
      quota
        ? '[gemini] DAILY QUOTA EXHAUSTED (free tier = 20/day) — using keyword fallback. Set GEMINI_MOCK=true to stop trying.'
        : `[gemini] parse failed, using keyword fallback: ${err.message}`
    );
    return {
      parsed: heuristicParse(text),
      source: 'rule-fallback',
      latencyMs: Date.now() - started,
      error: err.message?.slice(0, 200),
    };
  }
}

/**
 * Plain-language explanation of a decision the SYSTEM already made.
 * Gemini is given the conclusion — it is never asked to reach one.
 */
export async function explainDecision({ tier, tierLabel, drivers, needsHumanReview, language = 'en' }) {
  const driverText = drivers?.map((d) => d.label).join(', ') || 'the details you provided';
  const template =
    `Your request was placed in "${tierLabel}" based on ${driverText}.` +
    (needsHumanReview ? ' A human coordinator is reviewing it before anything is confirmed.' : '');

  if (chaos.is('killGemini') || env.gemini.mock || !ai || language === 'en') {
    return { text: template, source: env.gemini.mock ? 'mock-fixture' : 'template' };
  }

  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model: env.gemini.model,
        contents:
          `Rewrite this dispatch update for the patient in language code "${language}". ` +
          `Keep it under 40 words, calm and factual. Do NOT add any medical advice, ` +
          `condition name or diagnosis. Do not change the meaning.\n\n"${template}"`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.2,
          maxOutputTokens: OUTPUT_TOKENS,
        },
      })
    );
    if (!res.text) throw new Error('empty response');
    const guarded = guardText(res.text.trim());
    return { text: guarded.text, source: guarded.blocked ? 'template' : 'model', blocked: guarded.blocked };
  } catch {
    return { text: template, source: 'template' };
  }
}

export const SYMPTOM_LABELS = Object.fromEntries(SYMPTOM_TAGS.map((t) => [t.id, t.label]));
