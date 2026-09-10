import { Assignment, Request, Resource } from '../models.js';
import { dbReady } from '../db.js';
import { emitDispatch, emitRequest } from '../lib/realtime.js';
import { haversineM } from '../lib/geo.js';
import { estimateEta } from './eta.js';
import { allTraffic, rawTrafficFor, setTraffic, trafficFor } from './traffic.js';
import { ASSIGNMENT_STATUS, REQUEST_STATES, ZONES, AMBULANCE_TYPES } from '../../../shared/enums.js';

/**
 * The world clock.
 *
 * Once a second: every dispatched vehicle moves toward its patient, and every
 * zone's traffic drifts. That is what makes this a dispatch system rather than
 * a booking form — the estimate you were given a minute ago is not necessarily
 * the estimate now, and the UI has to cope with that.
 *
 * TIME ACCELERATION. A real 15-minute ETA would take 15 real minutes to play
 * out, which is useless in a five-minute demo. Vehicles therefore move at
 * SIM_SPEED× real time (default 30×, so 15 minutes of travel takes 30 seconds).
 * The multiplier is reported in the API and shown on screen — an accelerated
 * clock is a legitimate simulation, a hidden one is a lie.
 *
 * Positions are advanced in memory and broadcast every tick, but written to
 * MongoDB only every few seconds (and always on arrival). Sixteen vehicles ×
 * one write per second is pointless load for a value that is re-derived anyway.
 */

const TICK_MS = 1000;
const SIM_SPEED = Number(process.env.SIM_SPEED || 30);
const PERSIST_EVERY_TICKS = 5;
const ARRIVAL_RADIUS_M = 80;

/** assignmentId -> live run state */
const runs = new Map();
let timer = null;
let tick = 0;

/* ------------------------------------------------------------------ traffic */

// Each zone random-walks around its own baseline and is pulled back toward it,
// so congestion wanders without drifting off to an absurd value.
function driftTraffic() {
  for (const zone of ZONES) {
    // Raw, not effective: drifting on the chaos-inflated value would fold the
    // spike into the baseline and it would never come back down.
    const current = rawTrafficFor(zone.id);
    const noise = (Math.random() - 0.5) * 0.08;
    const pullBack = (zone.trafficIndex - current) * 0.02;
    setTraffic(zone.id, current + noise + pullBack);
  }
}

/* ---------------------------------------------------------------- movement */

/** Advance a point toward a target by `stepM`, returning the new [lng, lat]. */
function advance(from, to, stepM) {
  const remaining = haversineM(from, to);
  if (remaining <= stepM || remaining === 0) return [...to];
  const f = stepM / remaining;
  return [from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f];
}

async function arrive(run) {
  runs.delete(run.assignmentId);
  if (!dbReady()) return;

  await Resource.findByIdAndUpdate(run.resourceId, {
    $set: { 'attrs.status': 'idle', loc: { type: 'Point', coordinates: run.to } },
    $inc: { load: -0.35 },
  });

  await Assignment.findByIdAndUpdate(run.assignmentId, {
    $set: { status: ASSIGNMENT_STATUS.COMPLETED },
    $push: { history: { status: ASSIGNMENT_STATUS.COMPLETED, at: new Date(), reason: 'unit arrived on scene' } },
  });

  const request = await Request.findById(run.requestId);
  if (request) {
    request.state = REQUEST_STATES.FULFILLED;
    request.timeline.push({
      state: REQUEST_STATES.FULFILLED,
      at: new Date(),
      by: run.name,
      reason: `arrived after ${Math.round(run.elapsedSimMin)} simulated minutes`,
    });
    await request.save();
  }

  const payload = {
    assignmentId: run.assignmentId,
    requestId: run.requestId,
    resourceId: run.resourceId,
    name: run.name,
    state: REQUEST_STATES.FULFILLED,
    elapsedSimMin: Math.round(run.elapsedSimMin),
  };
  emitRequest(run.requestId, 'run:arrived', payload);
  emitDispatch('run:arrived', payload);
}

async function step() {
  tick += 1;
  driftTraffic();

  const dtSimMin = (TICK_MS / 60000) * SIM_SPEED;
  const arrived = [];

  for (const run of runs.values()) {
    const traffic = trafficFor(run.zoneId);
    // Congestion slows the vehicle, exactly as it inflates the ETA.
    const effectiveKmph = run.speedKmph / traffic;
    const stepM = (effectiveKmph / 60) * dtSimMin * 1000;

    run.pos = advance(run.pos, run.to, stepM);
    run.elapsedSimMin += dtSimMin;

    const eta = estimateEta({
      distanceM: haversineM(run.pos, run.to),
      zoneId: run.zoneId,
      mode: 'ambulance',
      speedKmph: run.speedKmph,
    });

    // Only announce a change when it is big enough to matter to a human.
    const shifted = run.lastEta && Math.abs(eta.p90Min - run.lastEta.p90Min) >= 2;
    const reason = shifted
      ? `traffic in ${run.zoneId} is now ×${eta.trafficIndex.toFixed(2)}`
      : null;
    run.lastEta = eta;

    emitRequest(run.requestId, 'run:progress', {
      assignmentId: run.assignmentId,
      requestId: run.requestId,
      name: run.name,
      pos: run.pos,
      to: run.to, // the patient, so the tracking map can draw both ends
      eta,
      etaChangedReason: reason,
      elapsedSimMin: Math.round(run.elapsedSimMin),
    });

    if (haversineM(run.pos, run.to) <= ARRIVAL_RADIUS_M) arrived.push(run);
  }

  // One broadcast for the dispatcher map instead of one per vehicle.
  if (runs.size || tick % 3 === 0) {
    emitDispatch('sim:tick', {
      tick,
      simSpeed: SIM_SPEED,
      traffic: allTraffic(),
      runs: [...runs.values()].map((r) => ({
        assignmentId: r.assignmentId,
        requestId: r.requestId,
        name: r.name,
        type: r.type,
        pos: r.pos,
        to: r.to,
        etaP50Min: r.lastEta?.p50Min,
        etaP90Min: r.lastEta?.p90Min,
      })),
    });
  }

  if (dbReady() && tick % PERSIST_EVERY_TICKS === 0) {
    await Promise.all(
      [...runs.values()].map((r) =>
        Resource.updateOne({ _id: r.resourceId }, { $set: { loc: { type: 'Point', coordinates: r.pos } } })
      )
    ).catch((e) => console.warn('[sim] position persist failed:', e.message));
  }

  for (const run of arrived) await arrive(run).catch((e) => console.warn('[sim] arrival failed:', e.message));
}

/* ------------------------------------------------------------------- public */

/** Called by the assignment route the moment a vehicle is committed. */
export function trackRun({ assignment, resource, request }) {
  if (assignment.kind !== 'ambulance') return;
  runs.set(String(assignment._id), {
    assignmentId: String(assignment._id),
    requestId: String(request._id ?? request.id),
    resourceId: String(resource._id ?? resource.id),
    name: resource.name,
    type: resource.attrs?.type,
    pos: [...resource.loc.coordinates],
    to: [...request.loc.coordinates],
    zoneId: request.zoneId,
    speedKmph: AMBULANCE_TYPES[resource.attrs?.type]?.speedKmph ?? 42,
    elapsedSimMin: 0,
    lastEta: null,
  });
}

/** Rebuild live runs after a restart, so nodemon does not strand a vehicle. */
export async function resumeRuns() {
  if (!dbReady()) return 0;
  const active = await Assignment.find({ kind: 'ambulance', status: ASSIGNMENT_STATUS.ACTIVE })
    .populate('resourceId')
    .lean();

  let n = 0;
  for (const a of active) {
    const request = await Request.findById(a.requestId).lean();
    if (!request || !a.resourceId) continue;
    trackRun({ assignment: a, resource: a.resourceId, request });
    n += 1;
  }
  return n;
}

export function startSim() {
  if (timer) return;
  timer = setInterval(() => {
    step().catch((e) => console.warn('[sim] tick failed:', e.message));
  }, TICK_MS);
  console.log(`[sim] running at ${SIM_SPEED}x real time (${TICK_MS}ms tick)`);
}

export function stopSim() {
  clearInterval(timer);
  timer = null;
}

export const simState = () => ({
  simSpeed: SIM_SPEED,
  tick,
  activeRuns: runs.size,
  traffic: allTraffic(),
});
