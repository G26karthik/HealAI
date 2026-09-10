import { Router } from 'express';
import { z } from 'zod';

import { dbReady } from '../db.js';
import { Order, Request, Resource } from '../models.js';
import { emitDispatch, emitRequest } from '../lib/realtime.js';
import { uploadPrescription, cloudinaryReady } from '../services/cloudinary.js';
import { extractAndResolve } from '../services/prescription.js';
import { matchResources } from '../services/matcher.js';
import { planMedicineOrder, LADDERS, rungMeta } from '../services/fallback.js';
import { estimateEta } from '../services/eta.js';
import { logAi, logHuman } from '../services/audit.js';
import { REQUEST_STATES } from '../../../shared/enums.js';

export const pharmacyRouter = Router();

/* --------------------------------------------------------------------------
 * POST /api/pharmacy/prescription
 * Photo in → stored in Cloudinary → read by vision → matched to the catalogue.
 * Nothing is ordered here. This only produces a proposal for a human to check.
 * ----------------------------------------------------------------------- */
const ScanSchema = z.object({
  image: z.string().startsWith('data:image/').max(12_000_000),
  requestId: z.string().optional(),
});

pharmacyRouter.post('/prescription', async (req, res, next) => {
  try {
    const { image, requestId } = ScanSchema.parse(req.body ?? {});

    // Storage failing must not stop the read — we already hold the bytes.
    const upload = await uploadPrescription(image).catch((e) => ({
      url: null,
      stored: false,
      reason: e.message?.slice(0, 120),
    }));

    const result = await extractAndResolve(image);

    if (requestId && dbReady()) {
      await logAi({
        requestId,
        model: result.source === 'model' ? env0() : `prescription-fixtures (${result.source})`,
        purpose: 'prescription-vision',
        input: { prescriptionUrl: upload.url },
        output: { lines: result.lines.map((l) => ({ requested: l.requested, name: l.name, conf: l.matchConfidence })) },
        latencyMs: result.latencyMs,
        degraded: result.source !== 'model',
      });
    }

    const needsApproval = result.lines.some((l) => l.needsHuman);

    res.json({
      prescriptionUrl: upload.url,
      stored: upload.stored,
      storageNote: upload.stored ? null : upload.reason || 'not stored',
      isPrescription: result.isPrescription,
      lines: result.lines,
      needsPharmacistApproval: needsApproval,
      source: result.source,
      latencyMs: result.latencyMs,
      disclaimer:
        'Transcribed from a photograph and matched against our catalogue. Handwriting is often ' +
        'ambiguous — every prescription-only or uncertain item must be confirmed by a pharmacist ' +
        'before it is dispensed.',
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid image payload', details: err.issues });
    next(err);
  }
});

const env0 = () => process.env.GEMINI_MODEL || 'gemini-3.6-flash';

/* --------------------------------------------------------------------------
 * POST /api/pharmacy/plan
 * Given the confirmed lines, work out who can actually fill them.
 * ----------------------------------------------------------------------- */
const PlanSchema = z.object({
  requestId: z.string().min(1),
  lines: z.array(z.any()).min(1),
});

pharmacyRouter.post('/plan', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'database unavailable' });
    const { requestId, lines } = PlanSchema.parse(req.body ?? {});

    const request = await Request.findById(requestId).lean();
    if (!request) return res.status(404).json({ error: 'request not found' });

    const match = await matchResources(request, 'pharmacy', {});
    const pharmacies = await Resource.find({
      _id: { $in: match.options.map((o) => o.resourceId) },
    }).lean();

    // Preserve the matcher's ranking — the Mongo query returns them unordered.
    const ordered = match.options
      .map((o) => pharmacies.find((p) => String(p._id) === o.resourceId))
      .filter(Boolean);

    const { plan, laddersUsed, unfilled } = planMedicineOrder({ lines, pharmacies: ordered });

    const priced = plan.map((bucket) => {
      const option = match.options.find((o) => o.resourceId === String(bucket.pharmacy._id));
      const subtotal = bucket.items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
      const deliveryFee = bucket.pharmacy.attrs?.deliveryFee ?? 0;
      const eta =
        option?.eta ??
        estimateEta({ distanceM: 3000, zoneId: request.zoneId, mode: 'delivery' });
      return {
        pharmacyId: String(bucket.pharmacy._id),
        pharmacyName: bucket.pharmacy.name,
        items: bucket.items,
        subtotal,
        deliveryFee,
        total: subtotal + deliveryFee,
        etaP50Min: eta.p50Min,
        etaP90Min: eta.p90Min,
      };
    });

    res.json({
      requestId,
      plan: priced,
      unfilled,
      laddersUsed: laddersUsed.map((id) => rungMeta('medicine', id)).filter(Boolean),
      needsPharmacistApproval: priced.some((b) => b.items.some((i) => i.needsHuman || i.status === 'substituted')),
      grandTotal: priced.reduce((s, b) => s + b.total, 0),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: err.issues });
    next(err);
  }
});

/* --------------------------------------------------------------------------
 * POST /api/pharmacy/order
 * Commit the order. A basket containing anything prescription-only, uncertain
 * or substituted is REFUSED unless a pharmacist has signed it off.
 * ----------------------------------------------------------------------- */
const OrderSchema = z.object({
  requestId: z.string().min(1),
  prescriptionUrl: z.string().optional().nullable(),
  fulfilment: z.enum(['delivery', 'pickup']).default('delivery'),
  buckets: z.array(z.any()).min(1),
  pharmacistApproval: z
    .object({ approvedBy: z.string().max(60), notes: z.string().max(300).optional() })
    .optional(),
});

pharmacyRouter.post('/order', async (req, res, next) => {
  try {
    if (!dbReady()) return res.status(503).json({ error: 'database unavailable' });
    const body = OrderSchema.parse(req.body ?? {});

    const request = await Request.findById(body.requestId);
    if (!request) return res.status(404).json({ error: 'request not found' });

    const allItems = body.buckets.flatMap((b) => b.items || []);
    const gated = allItems.filter((i) => i.rxRequired || i.needsHuman || i.status === 'substituted');

    if (gated.length && !body.pharmacistApproval) {
      return res.status(409).json({
        error: 'A pharmacist must approve this order before it can be placed.',
        needsPharmacistApproval: true,
        items: gated.map((i) => ({
          name: i.name,
          reason: i.status === 'substituted' ? 'substituted for another medicine' : i.rxRequired ? 'prescription-only' : 'uncertain match',
        })),
      });
    }

    const orders = [];
    for (const bucket of body.buckets) {
      const order = await Order.create({
        requestId: request._id,
        pharmacyId: bucket.pharmacyId,
        pharmacyName: bucket.pharmacyName,
        items: bucket.items,
        prescriptionUrl: body.prescriptionUrl || undefined,
        fulfilment: body.fulfilment,
        deliveryFee: bucket.deliveryFee,
        total: bucket.total,
        etaP50Min: bucket.etaP50Min,
        etaP90Min: bucket.etaP90Min,
        pharmacistApproval: {
          required: gated.length > 0,
          approvedBy: body.pharmacistApproval?.approvedBy,
          approvedAt: body.pharmacistApproval ? new Date() : undefined,
          notes: body.pharmacistApproval?.notes,
        },
        status: 'placed',
        fallbacksUsed: (bucket.items || [])
          .filter((i) => i.status === 'substituted')
          .map((i) => ({ rung: 'same-salt-substitute', note: `${i.substitutedFor} → ${i.name}`, at: new Date() })),
      });
      orders.push(order.toObject());

      // Decrement what we just committed, so a second order sees real stock.
      for (const item of bucket.items) {
        await Resource.updateOne(
          { _id: bucket.pharmacyId, 'attrs.inventory.medId': item.medId },
          { $inc: { 'attrs.inventory.$.qty': -(item.qty || 1) } }
        );
      }
    }

    if (gated.length) {
      await logHuman({
        requestId: request._id,
        purpose: 'prescription-approval',
        humanAction: 'approved',
        input: { items: gated.map((i) => i.name) },
        output: { approvedBy: body.pharmacistApproval.approvedBy },
      });
    }

    request.state = REQUEST_STATES.SCHEDULED;
    request.timeline.push({
      state: REQUEST_STATES.SCHEDULED,
      at: new Date(),
      by: body.pharmacistApproval?.approvedBy || 'patient',
      reason: `medicines ordered from ${body.buckets.length} pharmacy(ies)`,
    });
    await request.save();

    const payload = { orders, requestId: String(request._id) };
    emitDispatch('order:new', payload);
    emitRequest(request._id, 'order:new', payload);
    res.status(201).json(payload);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid input', details: err.issues });
    next(err);
  }
});

/** The documented ladders, for the UI and for judges who ask. */
pharmacyRouter.get('/ladders', (_req, res) => res.json({ ladders: LADDERS, cloudinary: cloudinaryReady() }));

pharmacyRouter.get('/orders', async (req, res, next) => {
  try {
    if (!dbReady()) return res.json({ orders: [] });
    const q = req.query.requestId ? { requestId: req.query.requestId } : {};
    res.json({ orders: await Order.find(q).sort({ createdAt: -1 }).limit(30).lean() });
  } catch (err) {
    next(err);
  }
});
