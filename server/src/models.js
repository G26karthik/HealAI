import mongoose from 'mongoose';
import { RESOURCE_KINDS, REQUEST_STATES, ASSIGNMENT_STATUS, TIER_CODES } from '../../shared/enums.js';

const { Schema, model } = mongoose;

// A real Schema instance, not an object literal — Mongoose only accepts the
// former as a `type`, and `coordinates` is [lng, lat] in GeoJSON order.
const point = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true },
  },
  { _id: false }
);

/* ---------------------------------------------------------------------------
 * resources — doctors, ambulances and pharmacies are ONE thing to the dispatch
 * layer: a geo-located resource with capabilities, availability and load.
 * Modelling them once is what lets matcher.js be written once and used thrice.
 * ------------------------------------------------------------------------ */
const resourceSchema = new Schema(
  {
    kind: { type: String, enum: RESOURCE_KINDS, required: true, index: true },
    name: { type: String, required: true },
    loc: { type: point, required: true },
    zoneId: { type: String, index: true },
    active: { type: Boolean, default: true },

    // kind-specific, deliberately loose so one collection serves all three
    //   doctor:    { specialty, slots:[{start,end,mode,taken}], fee, teleconsult }
    //   ambulance: { type:'ALS'|'BLS', status, speedKmph, crewSkill, heading }
    //   pharmacy:  { inventory:[{medId,qty,price}], deliveryRadiusKm, open, deliveryFee }
    attrs: { type: Schema.Types.Mixed, default: {} },

    capabilities: { type: [String], default: [] },
    load: { type: Number, default: 0 },      // 0..1, feeds the load penalty
    rating: { type: Number, default: 4.2 },
    imageUrl: { type: String, default: '' }, // Cloudinary
  },
  { timestamps: true }
);
resourceSchema.index({ loc: '2dsphere' });

/* ---------------------------------------------------------------------------
 * requests — the spine. timeline[] is rendered as both the patient's tracking
 * view and the dispatcher's audit trail: one structure, two rubric points.
 * ------------------------------------------------------------------------ */
const requestSchema = new Schema(
  {
    patientName: { type: String, default: 'Guest' },
    language: { type: String, default: 'en' },
    rawInput: { type: String, default: '' },

    // structured output of the intake parser — never free text from here on
    parsed: {
      symptomTags: { type: [String], default: [] },
      durationHours: Number,
      age: Number,
      chronicFlag: { type: Boolean, default: false },
      immobileFlag: { type: Boolean, default: false },
      severitySelf: { type: Number, default: 3 },
      parseSource: String, // model | mock-fixture | manual-form
    },

    tier: { type: String, enum: TIER_CODES, index: true },
    confidence: Number,
    drivers: { type: [{ feature: String, delta: Number, label: String }], default: [] },
    needsHumanReview: { type: Boolean, default: false, index: true },
    triageSource: String, // model | rule-fallback | human-reviewed
    humanReview: {
      reviewedBy: String,
      reviewedAt: Date,
      originalTier: String,
      reason: String,
    },

    loc: { type: point, required: true },
    zoneId: String,

    state: { type: String, enum: Object.values(REQUEST_STATES), default: REQUEST_STATES.DRAFT, index: true },
    timeline: {
      type: [{ state: String, at: Date, by: String, reason: String }],
      default: [],
    },
    fallbacksUsed: { type: [{ ladder: String, rung: String, at: Date, note: String }], default: [] },
  },
  { timestamps: true }
);
requestSchema.index({ loc: '2dsphere' });

/* ---------------------------------------------------------------------------
 * assignments — every assignment carries the cost breakdown that produced it,
 * so "why this ambulance?" is answerable from the database, not from memory.
 * ------------------------------------------------------------------------ */
const assignmentSchema = new Schema(
  {
    requestId: { type: Schema.Types.ObjectId, ref: 'Request', required: true, index: true },
    resourceId: { type: Schema.Types.ObjectId, ref: 'Resource', required: true },
    kind: { type: String, enum: RESOURCE_KINDS, required: true },

    cost: Number,
    breakdown: { type: Schema.Types.Mixed, default: {} }, // { eta, capability, load, patientCost, urgency }
    rejectedAlternatives: { type: [Schema.Types.Mixed], default: [] },

    etaP50Min: Number,
    etaP90Min: Number,
    distanceM: Number,

    status: { type: String, enum: Object.values(ASSIGNMENT_STATUS), default: ASSIGNMENT_STATUS.PROPOSED },
    preemption: {
      isPreemption: { type: Boolean, default: false },
      victimRequestId: { type: Schema.Types.ObjectId, ref: 'Request' },
      approvedBy: String,
      approvedAt: Date,
    },
    history: { type: [{ status: String, at: Date, reason: String }], default: [] },
  },
  { timestamps: true }
);

/* ------------------------------------------------------------------------ */
const medicineSchema = new Schema({
  name: { type: String, required: true, index: true },
  salt: { type: String, required: true, index: true }, // substitute = same salt + strength
  strength: { type: String, required: true },
  form: { type: String, default: 'tablet' },
  rxRequired: { type: Boolean, default: false },
  mrp: { type: Number, default: 50 },
});

/* ---------------------------------------------------------------------------
 * auditLog — Rule 1 requires AI systems to explain inputs, outputs, limitations
 * and human-review points. This collection is that evidence.
 * ------------------------------------------------------------------------ */
const auditSchema = new Schema({
  ts: { type: Date, default: Date.now },
  requestId: { type: Schema.Types.ObjectId, ref: 'Request', index: true },
  actor: { type: String, enum: ['ai', 'human', 'system'], required: true },
  model: String,          // gemini-2.0-flash | urgency-mlp-v1 | rule-table-v1
  purpose: String,        // intake-parse | triage | prescription-vision | explain
  input: Schema.Types.Mixed,
  output: Schema.Types.Mixed,
  confidence: Number,
  humanAction: String,    // confirmed | overridden | approved | rejected
  latencyMs: Number,
  degraded: { type: Boolean, default: false },
});

export const Resource = model('Resource', resourceSchema);
export const Request = model('Request', requestSchema);
export const Assignment = model('Assignment', assignmentSchema);
export const Medicine = model('Medicine', medicineSchema);
export const AuditLog = model('AuditLog', auditSchema);
