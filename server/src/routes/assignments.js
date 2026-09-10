import { Router } from 'express';
import { z } from 'zod';

import { dbReady } from '../db.js';
import { Assignment, Request, Resource } from '../models.js';
import { emitDispatch, emitRequest } from '../lib/realtime.js';
import { requirementsFor } from '../services/matcher.js';
import { findWithLadder, LADDERS, rungMeta } from '../services/fallback.js';
import { trackRun } from '../services/sim.js';
import { logHuman } from '../services/audit.js';
import { ASSIGNMENT_STATUS, REQUEST_STATES, RESOURCE_KINDS, TIERS } from '../../../shared/enums.js';

export const assignmentsRouter = Router();

// A pharmacy resource is matched under the "medicine" ladder — the ladder is
// named for the need, not for the kind of thing that satisfies it.
const LADDER_FOR = { ambulance: 'ambulance', doctor: 'doctor', pharmacy: 'medicine' };

const step = (state, by, reason) => ({ state, at: new Date(), by, reason });

/* --------------------------------------------------------------------------
 * GET /api/assignments/options?requestId=&kind=
 * Ranked candidates with the cost breakdown that produced the ranking.
 * ----------------------------------------------------------------------- */
assignmentsRouter.get('/options', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'database unavailable' });

    const { requestId, kind } = req.query;
    if (!RESOURCE_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be one of ${RESOURCE_KINDS.join(', ')}` });
    }

    const request = await Request.findById(requestId).lean();
    if (!request) return res.status(404).json({ error: 'request not found' });

    const match = await findWithLadder(request, kind);
    const requirements = match.requirements ?? requirementsFor(request);

    res.json({
      requestId,
      kind,
      tier: request.tier,
      // p90 for T1/T2 (the worst case is what matters in an emergency),
      // p50 for T3/T4 (throughput matters). Same numbers, two risk postures.
      riskPosture: requirements.riskPosture,
      requirements,
      options: match.options,
      rejected: match.rejected,
      // Which rung of the documented ladder answered, plus every rung tried.
      rung: rungMeta(LADDER_FOR[kind], match.rung),
      isFallback: match.rung !== LADDERS[LADDER_FOR[kind]][0].id,
      exhausted: Boolean(match.exhausted),
      attempts: match.attempts,
      extra: match.extra ?? null,
      ladder: LADDERS[LADDER_FOR[kind]],
      candidatesScanned: match.candidatesScanned ?? 0,
    });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------------------------------------------------
 * POST /api/assignments — commit a choice.
 *
 * The resource is locked with a CONDITIONAL update, so two dispatchers racing
 * for the last ambulance cannot both win: the second one's condition no longer
 * matches and it gets a 409 instead of a silent double-booking.
 * ----------------------------------------------------------------------- */
const CreateSchema = z.object({
  requestId: z.string().min(1),
  resourceId: z.string().min(1),
  kind: z.enum(['ambulance', 'doctor', 'pharmacy']),
  slotStart: z.string().datetime().optional(),
  by: z.string().max(60).default('patient'),
});

assignmentsRouter.post('/', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'database unavailable' });
    const body = CreateSchema.parse(req.body ?? {});

    const request = await Request.findById(body.requestId);
    if (!request) return res.status(404).json({ error: 'request not found' });

    // A request awaiting human review must not be actioned automatically. This
    // is the human-in-the-loop gate doing actual work, not just labelling.
    if (request.needsHumanReview) {
      return res.status(409).json({
        error: 'This request is awaiting human review and cannot be assigned yet.',
        needsHumanReview: true,
      });
    }

    // Re-score at commit time rather than trusting a cost the client sent.
    const match = await findWithLadder(request, body.kind);
    const fallback = match.rung !== LADDERS[LADDER_FOR[body.kind]][0].id ? rungMeta(LADDER_FOR[body.kind], match.rung) : null;
    const chosen = match.options.find((o) => o.resourceId === body.resourceId);
    if (!chosen) {
      return res.status(409).json({
        error: 'That option is no longer available. Re-check the ranked list.',
        stale: true,
      });
    }

    /* ---- lock the resource ---- */
    let locked = null;
    if (body.kind === 'ambulance') {
      locked = await Resource.findOneAndUpdate(
        { _id: body.resourceId, 'attrs.status': 'idle' },
        { $set: { 'attrs.status': 'dispatched' }, $inc: { load: 0.35 } },
        { new: true }
      );
    } else if (body.kind === 'doctor') {
      const slotStart = new Date(body.slotStart ?? chosen.slot?.start);
      // The guard lives in the QUERY, not in a check afterwards: the document
      // only matches while a slot with this start is still free, so whoever
      // updates second matches nothing and gets null.
      //
      // Verifying after the write does not work here. `taken === true` is also
      // true when somebody else just took it, so a post-check happily confirms
      // a booking that belongs to another patient — which is exactly how this
      // first double-booked a slot.
      locked = await Resource.findOneAndUpdate(
        {
          _id: body.resourceId,
          'attrs.slots': { $elemMatch: { start: slotStart, taken: false } },
        },
        { $set: { 'attrs.slots.$[s].taken': true }, $inc: { load: 0.08 } },
        { arrayFilters: [{ 's.start': slotStart, 's.taken': false }], new: true }
      );
    } else {
      locked = await Resource.findById(body.resourceId);
    }

    if (!locked) {
      return res.status(409).json({ error: 'Someone just took that one. Please pick another.', raced: true });
    }

    /* ---- record the assignment, breakdown and all ---- */
    const assignment = await Assignment.create({
      requestId: request._id,
      resourceId: locked._id,
      kind: body.kind,
      cost: chosen.cost,
      breakdown: chosen.breakdown,
      rejectedAlternatives: [
        ...match.options.filter((o) => o.resourceId !== body.resourceId).slice(0, 3)
          .map((o) => ({ name: o.name, cost: o.cost, etaP90Min: o.eta.p90Min, reason: 'higher cost' })),
        ...match.rejected.slice(0, 3),
      ],
      etaP50Min: chosen.eta.p50Min,
      etaP90Min: chosen.eta.p90Min,
      distanceM: chosen.eta.distanceM,
      status: ASSIGNMENT_STATUS.ACTIVE,
      history: [{ status: ASSIGNMENT_STATUS.ACTIVE, at: new Date(), reason: `assigned by ${body.by}` }],
    });

    const nextState = body.kind === 'ambulance' ? REQUEST_STATES.IN_TRANSIT : REQUEST_STATES.SCHEDULED;
    request.state = nextState;
    request.timeline.push(
      step(REQUEST_STATES.CONFIRMED, body.by, `${locked.name} assigned — ETA ${chosen.eta.p50Min}–${chosen.eta.p90Min} min`),
      step(nextState, 'system', body.kind === 'ambulance' ? 'unit en route' : 'appointment scheduled')
    );
    if (fallback) {
      request.fallbacksUsed.push({
        ladder: LADDER_FOR[body.kind],
        rung: fallback.id,
        at: new Date(),
        note: fallback.note,
      });
    }
    await request.save();

    await logHuman({
      requestId: request._id,
      purpose: `assign-${body.kind}`,
      humanAction: 'approved',
      input: { resourceId: body.resourceId, cost: chosen.cost },
      output: { name: locked.name, etaP50Min: chosen.eta.p50Min, etaP90Min: chosen.eta.p90Min },
    });

    const payload = {
      assignment: assignment.toObject(),
      resource: { id: String(locked._id), name: locked.name, kind: body.kind, attrs: locked.attrs, loc: locked.loc },
      request: { id: String(request._id), state: nextState, tier: request.tier },
      fallback,
    };

    // Hand the vehicle to the world clock — from here it physically moves.
    trackRun({ assignment, resource: locked, request });

    emitDispatch('assignment:new', payload);
    emitRequest(request._id, 'assignment:new', payload);
    res.status(201).json(payload);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: err.issues });
    next(err);
  }
});

/* --------------------------------------------------------------------------
 * GET /api/assignments?requestId=
 * ----------------------------------------------------------------------- */
assignmentsRouter.get('/', async (req, res, next) => {
  try {
    if (!dbReady()) return res.json({ assignments: [] });
    const q = req.query.requestId ? { requestId: req.query.requestId } : {};
    const assignments = await Assignment.find(q)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('resourceId', 'name kind attrs loc')
      .lean();
    res.json({ assignments });
  } catch (err) {
    next(err);
  }
});

/* Resource inventory summary — used by the dispatcher's capacity strip. */
assignmentsRouter.get('/capacity', async (_req, res, next) => {
  try {
    if (!dbReady()) return res.json({ capacity: [] });
    const rows = await Resource.aggregate([
      { $group: { _id: { kind: '$kind', status: '$attrs.status' }, n: { $sum: 1 } } },
    ]);
    const ambulances = await Resource.find({ kind: 'ambulance' }, 'name attrs.type attrs.status zoneId').lean();
    res.json({
      raw: rows,
      ambulances: {
        total: ambulances.length,
        idle: ambulances.filter((a) => a.attrs?.status === 'idle').length,
        als: ambulances.filter((a) => a.attrs?.type === 'ALS').length,
        alsIdle: ambulances.filter((a) => a.attrs?.type === 'ALS' && a.attrs?.status === 'idle').length,
      },
      tiers: Object.values(TIERS).map((t) => ({ code: t.code, label: t.label, slaMin: t.slaMin })),
    });
  } catch (err) {
    next(err);
  }
});
