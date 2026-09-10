import { Resource } from '../models.js';
import { chaos } from '../lib/chaos.js';
import { estimateEta, etaForDecision } from './eta.js';
import {
  AMBULANCE_TYPES,
  CANDIDATE_LIMIT,
  CANDIDATE_RADIUS_M,
  MATCH_WEIGHTS,
  SYMPTOM_TAGS,
  TAG_TO_SPECIALTY,
  TIERS,
} from '../../../shared/enums.js';

/**
 * ONE matcher, three resource kinds.
 *
 * To the dispatch layer a doctor, an ambulance and a pharmacy are the same
 * thing: a geo-located resource with capabilities, availability and a load
 * factor. Modelling them that way means the hardest code in the project —
 * candidate generation, hard constraints, cost scoring, ranking — is written
 * once and reused three times. Adding blood banks or diagnostic labs is a new
 * constraint function and a seed file, not new code.
 *
 * The pipeline, in order:
 *   1. candidates   indexed $geoNear, top-K only  → cost is independent of DB size
 *   2. feasibility  hard constraints filter BEFORE scoring — never rank the impossible
 *   3. score        weighted cost with a stored breakdown, so "why this one?" is
 *                   answerable from the database rather than from memory
 *   4. rank         cheapest first
 */

const ALS_TAGS = new Set(SYMPTOM_TAGS.filter((t) => t.requiresALS).map((t) => t.id));

const MAX_ETA_MIN = 45; // normalisation ceiling
const MAX_FEE = 1200; // rupees, for normalising patient cost

/* ---------------------------------------------------------------------------
 * What the request actually needs. Derived once, used by every constraint.
 * ------------------------------------------------------------------------ */
export function requirementsFor(request) {
  const tags = request.parsed?.symptomTags || [];
  const needsALS = (request.tier === 'T1' || request.tier === 'T2') && tags.some((t) => ALS_TAGS.has(t));

  // The lead tag is the highest-acuity one present; it decides the specialty.
  const specialty = TAG_TO_SPECIALTY[tags[0]] || 'general-physician';

  return {
    needsALS,
    specialty,
    tier: request.tier,
    slaMin: TIERS[request.tier]?.slaMin ?? 1440,
    riskPosture: request.tier === 'T1' || request.tier === 'T2' ? 'p90' : 'p50',
  };
}

/* ---------------------------------------------------------------------------
 * Hard constraints. A candidate that fails one is not ranked lower — it is
 * removed. Sending a basic ambulance to a cardiac call is not a worse option,
 * it is not an option.
 * ------------------------------------------------------------------------ */
const HARD_CONSTRAINTS = {
  ambulance(request, r, req, { relaxed }) {
    if (r.attrs?.status !== 'idle') return 'already on a call';
    if (chaos.is('ambulanceOffline') && r.attrs?.chaosVictim) return 'taken offline';
    if (req.needsALS && r.attrs?.type !== AMBULANCE_TYPES.ALS.code && !relaxed) {
      return 'advanced life support required';
    }
    return null;
  },

  doctor(request, r, req, { relaxed }) {
    const slot = nextFreeSlot(r, req.slaMin);
    if (!slot) return 'no slot inside the target window';
    if (!relaxed && req.specialty !== 'general-physician') {
      const has = r.attrs?.specialty === req.specialty || r.attrs?.specialty === 'general-physician';
      if (!has) return 'specialty does not match';
    }
    return null;
  },

  pharmacy(request, r, _req, { relaxed }) {
    if (!r.attrs?.open) return 'closed';
    if (chaos.is('pharmacyStockout') && r.attrs?.chaosVictim && !relaxed) return 'out of stock';
    return null;
  },
};

/** First slot starting inside the tier's target window. */
export function nextFreeSlot(doctor, slaMin) {
  const deadline = Date.now() + slaMin * 60_000;
  return (doctor.attrs?.slots || [])
    .filter((s) => !s.taken && new Date(s.start).getTime() <= deadline && new Date(s.start).getTime() > Date.now() - 60_000)
    .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
}

/* ---------------------------------------------------------------------------
 * Capability gap — 0 is a perfect fit, 1 is the worst allowed fit.
 * ------------------------------------------------------------------------ */
function capabilityGap(kind, r, req) {
  if (kind === 'ambulance') {
    const isALS = r.attrs?.type === AMBULANCE_TYPES.ALS.code;
    if (req.needsALS) return isALS ? 0 : 1;
    return isALS ? 0.25 : 0; // using an ALS unit for a routine job wastes it
  }
  if (kind === 'doctor') {
    if (r.attrs?.specialty === req.specialty) return 0;
    if (r.attrs?.specialty === 'general-physician') return 0.45;
    return 0.9;
  }
  return 0;
}

function patientCostOf(kind, r) {
  if (kind === 'doctor') return (r.attrs?.fee ?? 300) / MAX_FEE;
  if (kind === 'pharmacy') return (r.attrs?.deliveryFee ?? 30) / 100;
  return 0; // emergency transport is not priced to the patient here
}

/* ---------------------------------------------------------------------------
 * The cost function. Every term is normalised to 0..1 before weighting, so the
 * weights in shared/enums.js mean what they look like they mean.
 * ------------------------------------------------------------------------ */
export function scoreCandidate({ kind, resource, request, req, distanceM }) {
  const speedKmph = kind === 'ambulance' ? AMBULANCE_TYPES[resource.attrs?.type]?.speedKmph : undefined;
  const mode = kind === 'ambulance' ? 'ambulance' : 'patient';
  const eta = estimateEta({ distanceM, zoneId: request.zoneId, mode, speedKmph });

  const decisionEta = etaForDecision(eta, req.tier);
  const etaTerm = Math.min(decisionEta / MAX_ETA_MIN, 1);
  const capTerm = capabilityGap(kind, resource, req);
  const loadTerm = Math.min(Math.max(resource.load ?? 0, 0), 1);
  const priceTerm = Math.min(patientCostOf(kind, resource), 1);

  // Urgency is identical across candidates for one request, so it does not
  // change this ranking. It is here because F3 compares costs ACROSS requests
  // when several compete for the same vehicle, and there it decides everything.
  const urgencyTerm = (5 - (TIERS[req.tier]?.rank ?? 4)) / 4;

  const w = MATCH_WEIGHTS;
  const cost =
    w.eta * etaTerm +
    w.capability * capTerm +
    w.load * loadTerm +
    w.patientCost * priceTerm -
    w.urgency * urgencyTerm;

  return {
    cost: Number(cost.toFixed(4)),
    eta,
    decisionEta,
    riskPosture: req.riskPosture,
    // Stored on the assignment so the dispatcher can always answer "why this one?"
    breakdown: {
      eta: { raw: decisionEta, unit: 'min', term: round(etaTerm), weight: w.eta, weighted: round(w.eta * etaTerm) },
      capability: { raw: capTerm === 0 ? 'exact fit' : 'partial fit', term: round(capTerm), weight: w.capability, weighted: round(w.capability * capTerm) },
      load: { raw: `${Math.round(loadTerm * 100)}% busy`, term: round(loadTerm), weight: w.load, weighted: round(w.load * loadTerm) },
      patientCost: { raw: kind === 'doctor' ? `₹${resource.attrs?.fee ?? 0}` : '—', term: round(priceTerm), weight: w.patientCost, weighted: round(w.patientCost * priceTerm) },
      urgency: { raw: req.tier, term: round(urgencyTerm), weight: -w.urgency, weighted: round(-w.urgency * urgencyTerm) },
    },
  };
}

const round = (n) => Number(n.toFixed(3));

/* ---------------------------------------------------------------------------
 * The entry point.
 * ------------------------------------------------------------------------ */
export async function matchResources(request, kind, { relaxed = false, radiusM, limit } = {}) {
  const req = requirementsFor(request);

  // $geoNear returns results already sorted by distance, so a following $limit
  // is a true top-K: the index does the work and only K documents are scored.
  // (Modern MongoDB rejects `limit` inside $geoNear — it must be its own stage.)
  const candidates = await Resource.aggregate([
    {
      $geoNear: {
        near: request.loc,
        distanceField: 'distM',
        maxDistance: radiusM ?? CANDIDATE_RADIUS_M[kind],
        query: { kind, active: true },
        spherical: true,
      },
    },
    { $limit: limit ?? CANDIDATE_LIMIT },
  ]);

  const rejected = [];
  const feasible = [];

  for (const r of candidates) {
    const why = HARD_CONSTRAINTS[kind](request, r, req, { relaxed });
    if (why) {
      rejected.push({ id: String(r._id), name: r.name, reason: why, distanceM: Math.round(r.distM) });
      continue;
    }
    const scored = scoreCandidate({ kind, resource: r, request, req, distanceM: r.distM });
    feasible.push({
      resourceId: String(r._id),
      kind,
      name: r.name,
      attrs: r.attrs,
      imageUrl: r.imageUrl,
      rating: r.rating,
      loc: r.loc,
      slot: kind === 'doctor' ? nextFreeSlot(r, req.slaMin) : undefined,
      ...scored,
    });
  }

  feasible.sort((a, b) => a.cost - b.cost);

  return { options: feasible, rejected, requirements: req, relaxed, candidatesScanned: candidates.length };
}

/**
 * Fallback ladder, first two rungs.
 *
 * Rung 1: the strict search. Rung 2: widen the radius and relax the soft-ish
 * hard constraints (accept a lower vehicle class, a general physician instead
 * of a specialist) — but say so, loudly, on the result. F5 extends this to
 * teleconsult, partner operators and guided self-transport.
 */
export async function matchWithFallback(request, kind) {
  const strict = await matchResources(request, kind);
  if (strict.options.length) return { ...strict, fallback: null };

  const widened = await matchResources(request, kind, {
    relaxed: true,
    radiusM: CANDIDATE_RADIUS_M[kind] * 2,
    limit: CANDIDATE_LIMIT * 2,
  });

  return {
    ...widened,
    fallback: widened.options.length
      ? {
          rung: 'widened-and-relaxed',
          note:
            kind === 'ambulance'
              ? 'No suitable unit was free nearby. The search was widened and the vehicle class requirement relaxed — the crew may have fewer capabilities than ideal.'
              : 'No exact match was free in the target window. The search was widened and the specialty requirement relaxed.',
        }
      : { rung: 'exhausted', note: 'No resource of this kind is available. Escalated to a dispatcher.' },
  };
}
