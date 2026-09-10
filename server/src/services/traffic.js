import { chaos } from '../lib/chaos.js';
import { ZONES } from '../../../shared/enums.js';

/**
 * Live traffic state, one index per zone.
 *
 * Seeded from the static means in shared/enums.js. The chaos panel can spike a
 * zone now; the simulation loop in F3 will drift all of them every tick. Keeping
 * it in one module means ETA, the matcher and the map all read the same numbers.
 */
const live = new Map(ZONES.map((z) => [z.id, z.trafficIndex]));

const SPIKE_ZONE = 'Z3';
const SPIKE_DELTA = 0.9;

/**
 * The simulated baseline, WITHOUT any chaos overlay.
 *
 * The drift loop must read this, never the effective value. Feeding the
 * effective value back in makes the chaos spike compound: each tick re-adds it
 * to the stored base until traffic pins at the ceiling and then never decays
 * when the toggle is switched off. Keeping the overlay strictly derived means
 * flipping the switch off restores the previous conditions immediately.
 */
export const rawTrafficFor = (zoneId) => live.get(zoneId) ?? 1.0;

/** Baseline plus any chaos overlay — what ETA and the map should use. */
export function trafficFor(zoneId) {
  const base = rawTrafficFor(zoneId);
  return chaos.is('trafficSpike') && zoneId === SPIKE_ZONE ? base + SPIKE_DELTA : base;
}

export function setTraffic(zoneId, value) {
  live.set(zoneId, Math.max(0.4, Math.min(3.0, value)));
}

export function allTraffic() {
  return Object.fromEntries(ZONES.map((z) => [z.id, Number(trafficFor(z.id).toFixed(2))]));
}
