import { Router } from 'express';

import { dbReady } from '../db.js';
import { Resource, Request } from '../models.js';
import { simState } from '../services/sim.js';
import { allTraffic } from '../services/traffic.js';
import { REQUEST_STATES, ZONES } from '../../../shared/enums.js';

export const fleetRouter = Router();

/**
 * Everything the map needs in one call: resource positions, open requests,
 * zone traffic and the simulation clock. The socket stream then supplies
 * deltas — this endpoint exists so a page can render fully on first paint
 * and after a dropped connection, rather than sitting empty until a tick.
 */
fleetRouter.get('/', async (req, res, next) => {
  try {
    if (!dbReady()) return res.json({ resources: [], requests: [], zones: ZONES, ...simState() });

    const kinds = String(req.query.kinds || 'ambulance').split(',');

    const resources = await Resource.find({ kind: { $in: kinds }, active: true }, 'name kind loc zoneId attrs.type attrs.status attrs.specialty attrs.open load').lean();

    // Anything still in play — a fulfilled request should not clutter the map.
    const open = await Request.find(
      { state: { $nin: [REQUEST_STATES.FULFILLED, REQUEST_STATES.CANCELLED, REQUEST_STATES.FAILED] } },
      'tier state loc zoneId needsHumanReview rawInput createdAt'
    )
      .sort({ createdAt: -1 })
      .limit(40)
      .lean();

    res.json({
      resources: resources.map((r) => ({
        id: String(r._id),
        name: r.name,
        kind: r.kind,
        zoneId: r.zoneId,
        pos: r.loc?.coordinates,
        type: r.attrs?.type,
        status: r.attrs?.status,
        specialty: r.attrs?.specialty,
        load: r.load,
      })),
      requests: open.map((r) => ({
        id: String(r._id),
        tier: r.tier,
        state: r.state,
        pos: r.loc?.coordinates,
        zoneId: r.zoneId,
        needsHumanReview: r.needsHumanReview,
        label: (r.rawInput || '').slice(0, 60),
      })),
      zones: ZONES.map((z) => ({ ...z, trafficIndex: allTraffic()[z.id] })),
      ...simState(),
    });
  } catch (err) {
    next(err);
  }
});
