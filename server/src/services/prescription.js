import { GoogleGenAI } from '@google/genai';

import { env } from '../config/env.js';
import { chaos } from '../lib/chaos.js';
import { Medicine } from '../models.js';

/**
 * Read a prescription photo into a list of medicines the system understands.
 *
 * Three hard rules, because this is the highest-risk feature in the project:
 *
 *  1. Vision output is a SUGGESTION. Nothing is ordered from it directly.
 *  2. Every extracted line is matched against our own catalogue. A name the
 *     model invented cannot become an order, because it will not match.
 *  3. Anything prescription-only, substituted, or matched with low confidence
 *     requires a pharmacist to approve before the order can be placed.
 *
 * Handwriting is genuinely hard to read and the model will sometimes be wrong.
 * The design assumes that rather than hoping otherwise.
 */

const ai = env.gemini.apiKey ? new GoogleGenAI({ apiKey: env.gemini.apiKey }) : null;
const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 15000);

const withTimeout = (p, ms = TIMEOUT_MS) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`vision timed out after ${ms}ms`)), ms))]);

const SYSTEM_INSTRUCTION = `You transcribe medicine names from a photograph of a prescription or a medicine strip.

RULES:
- Transcribe ONLY what is legibly written. Do not infer, complete or correct a drug name.
- Never suggest a medicine that is not visible in the image.
- Never state a diagnosis, a condition, or advice about taking the medicine.
- If a line is unclear, still report it, with a low confidence value.
- If the image is not a prescription or medicine packaging, return an empty list.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isPrescription: { type: 'BOOLEAN', description: 'True if the image shows a prescription or medicine packaging.' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Medicine name exactly as written.' },
          strength: { type: 'STRING', description: 'Strength as written, e.g. 500mg. Empty if absent.' },
          qty: { type: 'NUMBER', description: 'Quantity if written, otherwise 0.' },
          confidence: { type: 'NUMBER', description: 'How legible this line was, 0 to 1.' },
        },
        required: ['name', 'confidence'],
      },
    },
  },
  required: ['isPrescription', 'items'],
};

/* -------------------------------------------------------------- matching */

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Levenshtein, iterative, two-row. Enough for drug-name typos and OCR slips. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = curr;
  }
  return prev[b.length];
}

/** 0..1 similarity, with a bonus when the catalogue name is a prefix of the read text. */
function similarity(read, candidate) {
  const a = norm(read);
  const b = norm(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const base = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  // "dolo 650 tab" should still match the catalogue entry "Dolo 650".
  const contains = a.includes(b) || b.includes(a) ? 0.25 : 0;
  return Math.min(1, base + contains);
}

const MATCH_FLOOR = 0.55;

/**
 * Resolve one transcribed line against the catalogue.
 * Returns the best match plus same-salt alternatives, or null if nothing is close.
 */
export function resolveMedicine(line, catalogue) {
  const scored = catalogue
    .map((m) => ({
      med: m,
      score:
        similarity(line.name, m.name) * 0.8 +
        // A matching strength is strong corroboration for an uncertain name.
        (line.strength && norm(line.strength) === norm(m.strength) ? 0.2 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < MATCH_FLOOR) return null;

  const alternatives = catalogue.filter(
    (m) =>
      String(m._id) !== String(best.med._id) &&
      m.salt === best.med.salt &&
      m.strength === best.med.strength
  );

  return {
    med: best.med,
    // Legibility and name-match are separate failure modes; combine them so a
    // clear photo of an unknown drug and a blurry photo of a known one are both
    // treated as uncertain.
    matchConfidence: Number((best.score * (line.confidence ?? 1)).toFixed(3)),
    alternatives,
  };
}

/* ---------------------------------------------------------------- reading */

/** Deterministic stand-in used when vision is unavailable or switched off. */
const MOCK_ITEMS = [
  { name: 'Dolo 650', strength: '650mg', qty: 10, confidence: 0.94 },
  { name: 'Amoxicillin 500', strength: '500mg', qty: 15, confidence: 0.81 },
  { name: 'Telma 40', strength: '40mg', qty: 30, confidence: 0.62 },
];

export async function readPrescription(dataUri) {
  const started = Date.now();

  if (chaos.is('killGemini') || env.gemini.mock || !ai) {
    return {
      items: MOCK_ITEMS,
      isPrescription: true,
      source: chaos.is('killGemini') ? 'rule-fallback' : 'mock-fixture',
      latencyMs: Date.now() - started,
    };
  }

  const [meta, base64] = String(dataUri).split(',');
  const mimeType = meta?.match(/data:(.*?);/)?.[1] || 'image/jpeg';

  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model: env.gemini.model,
        contents: [
          { inlineData: { mimeType, data: base64 } },
          { text: 'Transcribe every medicine name visible in this image.' },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          maxOutputTokens: 2048,
        },
      })
    );

    if (!res.text) throw new Error(`empty response (${res.candidates?.[0]?.finishReason})`);
    const parsed = JSON.parse(res.text);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      isPrescription: Boolean(parsed.isPrescription),
      source: 'model',
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    const quota = /RESOURCE_EXHAUSTED|429/.test(err.message || '');
    console.warn(
      quota
        ? '[vision] DAILY QUOTA EXHAUSTED — falling back to sample items'
        : `[vision] failed, falling back to sample items: ${err.message}`
    );
    return {
      items: MOCK_ITEMS,
      isPrescription: true,
      source: 'rule-fallback',
      latencyMs: Date.now() - started,
      error: err.message?.slice(0, 200),
    };
  }
}

/** Read the photo, then resolve every line against the catalogue. */
export async function extractAndResolve(dataUri) {
  const read = await readPrescription(dataUri);
  const catalogue = await Medicine.find({}).lean();

  const lines = read.items.map((line) => {
    const hit = resolveMedicine(line, catalogue);
    if (!hit) {
      return {
        requested: line.name,
        readConfidence: line.confidence ?? null,
        status: 'unrecognised',
        needsHuman: true,
        note: 'Not found in the catalogue — a pharmacist must check this line.',
      };
    }
    return {
      requested: line.name,
      readConfidence: line.confidence ?? null,
      medId: String(hit.med._id),
      name: hit.med.name,
      salt: hit.med.salt,
      strength: hit.med.strength,
      rxRequired: hit.med.rxRequired,
      qty: line.qty && line.qty > 0 ? line.qty : 10,
      matchConfidence: hit.matchConfidence,
      alternatives: hit.alternatives.map((a) => ({ medId: String(a._id), name: a.name, mrp: a.mrp })),
      // A prescription-only medicine, or an uncertain read, never proceeds alone.
      needsHuman: hit.med.rxRequired || hit.matchConfidence < 0.75,
      status: 'matched',
    };
  });

  return { ...read, lines };
}
