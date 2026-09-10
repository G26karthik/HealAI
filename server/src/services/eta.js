import { trafficFor } from './traffic.js';
import { ZONES, AMBULANCE_TYPES } from '../../../shared/enums.js';

/**
 * Arrival time as a RANGE, not a single number.
 *
 * A point estimate hides exactly the information a dispatcher needs. We report
 * p50 ("usually about this") and p90 ("90% of the time under this"), and the
 * two are used for different decisions:
 *
 *   T1/T2 → decide on p90. In an emergency the worst case is what matters.
 *   T3/T4 → decide on p50. For routine work, throughput matters.
 *
 * Same numbers, two risk postures. That is a genuine competing-objectives
 * trade-off rather than a cosmetic one.
 *
 * Honest limitation: this is analytical (distance / speed, adjusted for road
 * factor and live traffic) with an empirically-shaped spread. It is not a
 * learned travel-time model and there is no real road network behind it.
 */

const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

const DEFAULT_SPEED_KMPH = {
  ambulance: AMBULANCE_TYPES.BLS.speedKmph,
  delivery: 24, // two-wheeler
  patient: 20, // patient travelling to a clinic
};

/** Spread widens with congestion: heavy traffic is unpredictable traffic. */
const spreadFactor = (traffic) => 0.18 + 0.22 * traffic;

export function estimateEta({ distanceM, zoneId, mode = 'ambulance', speedKmph }) {
  const zone = ZONE_BY_ID[zoneId] ?? ZONES[0];
  const traffic = trafficFor(zone.id);
  const speed = speedKmph || DEFAULT_SPEED_KMPH[mode] || 30;

  // Straight-line distance understates road distance; roadFactor corrects it.
  const roadKm = (distanceM / 1000) * zone.roadFactor;
  const p50 = (roadKm / speed) * 60 * traffic;
  const p90 = p50 * (1 + spreadFactor(traffic));

  return {
    p50Min: Number(p50.toFixed(1)),
    p90Min: Number(p90.toFixed(1)),
    distanceM: Math.round(distanceM),
    roadKm: Number(roadKm.toFixed(2)),
    trafficIndex: Number(traffic.toFixed(2)),
    zoneId: zone.id,
  };
}

/** Which figure this tier's decisions are made on. */
export const etaForDecision = (eta, tier) => (tier === 'T1' || tier === 'T2' ? eta.p90Min : eta.p50Min);
