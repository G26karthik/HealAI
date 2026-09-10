import { Router } from 'express';
import axios from 'axios';
import { z } from 'zod';

import { env } from '../config/env.js';
import { dbReady } from '../db.js';
import { Request } from '../models.js';
import { toPoint, zoneFor } from '../lib/geo.js';
import { emitDispatch, emitRequest } from '../lib/realtime.js';
import { buildFeatures } from '../services/features.js';
import { explainDecision, parseIntake } from '../services/gemini.js';
import { requiresReview, triage } from '../services/triage.js';
import { auditFor, logAi, logHuman } from '../services/audit.js';
import { requireRole } from '../services/auth.js';
import { REQUEST_STATES, SOURCES, SYMPTOM_IDS, TIERS } from '../../../shared/enums.js';

export const requestsRouter = Router();

const CreateSchema = z.object({
  text: z.string().max(2000).optional(),
  patientName: z.string().max(80).optional(),
  language: z.string().max(8).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  // Manual form fields. These OVERRIDE anything the parser inferred — the human
  // in front of the screen is a better source than the language model.
  symptomTags: z.array(z.enum(SYMPTOM_IDS)).optional(),
  durationHours: z.number().min(0).max(8760).optional(),
  age: z.number().min(0).max(120).optional(),
  severitySelf: z.number().min(1).max(5).optional(),
  chronicFlag: z.boolean().optional(),
  immobileFlag: z.boolean().optional(),
});

const step = (state, by, reason) => ({ state, at: new Date(), by, reason });

/* --------------------------------------------------------------------------
 * POST /api/requests — the F1 spine.
 *   free text ─Gemini─► structured fields ─PyTorch─► tier ─► stored + audited
 * Every stage can degrade independently, and the response says how it went.
 * ----------------------------------------------------------------------- */
requestsRouter.post('/', async (req, res, next) => {
  try {
    const body = CreateSchema.parse(req.body ?? {});
    if (!body.text && !body.symptomTags?.length) {
      return res.status(400).json({ error: 'Describe the problem, or pick at least one symptom.' });
    }

    // 1 — understand the input
    let parsed = {};
    let parseSource = 'manual-form';
    let parseLatency = 0;
    if (body.text) {
      const out = await parseIntake(body.text);
      parsed = out.parsed;
      parseSource = out.source;
      parseLatency = out.latencyMs;
    }

    // Explicit form values win over inferred ones.
    const manual = {
      symptomTags: body.symptomTags,
      durationHours: body.durationHours,
      age: body.age,
      severitySelf: body.severitySelf,
      chronicFlag: body.chronicFlag,
      immobileFlag: body.immobileFlag,
    };
    for (const [k, v] of Object.entries(manual)) {
      if (v !== undefined && !(Array.isArray(v) && v.length === 0)) parsed[k] = v;
    }
    parsed.parseSource = parseSource;

    if (!parsed.symptomTags?.length) {
      return res.status(422).json({
        error: 'Could not recognise a symptom from that description. Please pick one below.',
        parseSource,
      });
    }

    // 2 — score urgency
    const features = buildFeatures(parsed);
    const { result, source, latencyMs, degraded, error } = await triage(parsed, features);
    const needsReview = requiresReview(result, degraded);

    // 3 — persist
    const loc = toPoint(body.lat, body.lng);
    const zone = zoneFor(loc.coordinates);
    const state = needsReview ? REQUEST_STATES.AWAITING_REVIEW : REQUEST_STATES.TRIAGED;

    const doc = {
      patientName: body.patientName || 'Guest',
      language: body.language || parsed.language || 'en',
      rawInput: body.text || '',
      parsed,
      tier: result.tier,
      confidence: result.confidence,
      drivers: result.drivers || [],
      needsHumanReview: needsReview,
      triageSource: source,
      loc,
      zoneId: zone.id,
      state,
      timeline: [
        step(REQUEST_STATES.DRAFT, 'patient', 'request submitted'),
        step(REQUEST_STATES.TRIAGED, source === SOURCES.MODEL ? 'urgency model' : 'rule table',
          `${result.tier} at ${Math.round((result.confidence ?? 0) * 100)}% confidence`),
        ...(needsReview
          ? [step(REQUEST_STATES.AWAITING_REVIEW, 'system', result.reviewReasons?.[0] || 'confidence below threshold')]
          : []),
      ],
      fallbacksUsed: degraded
        ? [{ ladder: 'triage', rung: 'rule-table-v1', at: new Date(), note: error || 'model unavailable' }]
        : [],
    };

    let saved = null;
    if (dbReady()) {
      saved = await Request.create(doc);
      await logAi({
        requestId: saved._id,
        model: parseSource === 'model' ? env.gemini.model : `intake-keywords-v1 (${parseSource})`,
        purpose: 'intake-parse',
        input: { text: body.text },
        output: parsed,
        latencyMs: parseLatency,
        degraded: parseSource === SOURCES.RULE_FALLBACK,
      });
      await logAi({
        requestId: saved._id,
        model: result.model_version,
        purpose: 'triage',
        input: { features },
        output: {
          tier: result.tier,
          probabilities: result.probabilities,
          drivers: result.drivers,
          reviewReasons: result.reviewReasons,
        },
        confidence: result.confidence,
        latencyMs,
        degraded,
      });
    }

    // 4 — explain in the patient's own words
    const explanation = await explainDecision({
      tier: result.tier,
      tierLabel: TIERS[result.tier].label,
      drivers: result.drivers,
      needsHumanReview: needsReview,
      language: doc.language,
    });

    const payload = {
      id: saved?._id ?? null,
      persisted: Boolean(saved),
      tier: result.tier,
      tierMeta: TIERS[result.tier],
      confidence: result.confidence,
      probabilities: result.probabilities ?? null,
      drivers: result.drivers ?? [],
      needsHumanReview: needsReview,
      reviewReasons: result.reviewReasons ?? [],
      safetyTieBreak: Boolean(result.safetyTieBreak),
      parsed,
      zone: { id: zone.id, name: zone.name },
      state,
      explanation: explanation.text,
      disclaimer: result.disclaimer,
      // Honest provenance. The UI renders a banner from this, never a silent guess.
      provenance: {
        parseSource,
        triageSource: source,
        modelVersion: result.model_version,
        degraded,
        error: error ?? null,
        latencyMs: { parse: parseLatency, triage: latencyMs },
      },
    };

    if (saved) emitDispatch('request:new', payload);
    res.status(201).json(payload);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid input', details: err.issues });
    }
    next(err);
  }
});

/* --------------------------------------------------------------------------
 * Dispatcher views
 * ----------------------------------------------------------------------- */
requestsRouter.get('/', async (req, res, next) => {
  try {
    if (!dbReady()) return res.json({ requests: [], dbReady: false });
    const q = {};
    if (req.query.needsReview === 'true') q.needsHumanReview = true;
    if (req.query.state) q.state = req.query.state;

    const requests = await Request.find(q).sort({ createdAt: -1 }).limit(60).lean();
    // Urgency first, then oldest first inside a tier — a queue, not a feed.
    requests.sort((a, b) => (TIERS[a.tier]?.rank ?? 9) - (TIERS[b.tier]?.rank ?? 9) || new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ requests, dbReady: true });
  } catch (err) {
    next(err);
  }
});

requestsRouter.get('/:id', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'database unavailable' });
    const request = await Request.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'not found' });
    res.json({ request, audit: await auditFor(request._id) });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------------------
 * POST /api/requests/:id/review — the human-in-the-loop gate.
 * A dispatcher confirms or overrides the tier; both are recorded with a reason.
 * ----------------------------------------------------------------------- */
const ReviewSchema = z.object({
  tier: z.enum(['T1', 'T2', 'T3', 'T4']),
  reviewedBy: z.string().max(60).default('dispatcher'),
  reason: z.string().max(300).optional(),
});

requestsRouter.post('/:id/review', requireRole('dispatcher'), async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'database unavailable' });
    const { tier, reason } = ReviewSchema.parse(req.body ?? {});
    // The reviewer is whoever is signed in, not whatever the client claims.
    // An override on a medical priority has to be attributable to a person.
    const reviewedBy = req.user.name;

    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ error: 'not found' });

    const originalTier = request.tier;
    const overridden = originalTier !== tier;

    request.tier = tier;
    request.needsHumanReview = false;
    request.triageSource = SOURCES.HUMAN;
    request.humanReview = { reviewedBy, reviewedAt: new Date(), originalTier, reason };
    request.state = REQUEST_STATES.TRIAGED;
    request.timeline.push(
      step(REQUEST_STATES.TRIAGED, reviewedBy, overridden ? `overridden ${originalTier} → ${tier}` : `confirmed ${tier}`)
    );
    await request.save();

    await logHuman({
      requestId: request._id,
      purpose: 'triage-review',
      humanAction: overridden ? 'overridden' : 'confirmed',
      input: { originalTier, reason },
      output: { tier },
    });

    const payload = { id: String(request._id), tier, originalTier, overridden, reviewedBy };
    emitDispatch('request:reviewed', payload);
    emitRequest(request._id, 'request:reviewed', payload);
    res.json({ request: request.toObject(), ...payload });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: err.issues });
    next(err);
  }
});

/* The model's own report card, proxied so the UI has a single origin. */
requestsRouter.get('/model/metrics', async (_req, res) => {
  try {
    const { data } = await axios.get(`${env.mlSvc.url}/metrics`, { timeout: 2000 });
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: 'ml-svc unavailable', detail: err.message });
  }
});
