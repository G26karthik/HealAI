// MediRoute — the single contract shared by client, server and ml-svc.
// If you change FEATURE_ORDER here, retrain the model. Nothing else may reorder it.

// ---------------------------------------------------------------------------
// Urgency tiers. These are DISPATCH PRIORITIES, not diagnoses.
// No entry in this file may ever name a medical condition.
// ---------------------------------------------------------------------------
export const TIERS = {
  T1: { code: 'T1', rank: 1, label: 'Emergency dispatch',   route: 'ambulance', color: 'red',    slaMin: 10 },
  T2: { code: 'T2', rank: 2, label: 'Urgent — same day',    route: 'doctor',    color: 'orange', slaMin: 120 },
  T3: { code: 'T3', rank: 3, label: 'Routine appointment',  route: 'doctor',    color: 'blue',   slaMin: 1440 },
  T4: { code: 'T4', rank: 4, label: 'Pharmacy or self-care', route: 'pharmacy', color: 'green',  slaMin: 2880 },
};
export const TIER_CODES = ['T1', 'T2', 'T3', 'T4'];

export const TRIAGE_DISCLAIMER =
  'Routing priority for dispatch and booking only. This is not a diagnosis and names no medical condition.';

// ---------------------------------------------------------------------------
// Administrative symptom tags — the ONLY vocabulary the intake parser may emit.
// Order is load-bearing: indices 0..11 of the model feature vector.
// ---------------------------------------------------------------------------
export const SYMPTOM_TAGS = [
  { id: 'chest-pain',            label: 'Chest pain / pressure',      requiresALS: true  },
  { id: 'breathing-difficulty',  label: 'Difficulty breathing',       requiresALS: true  },
  { id: 'trauma-bleeding',       label: 'Injury with heavy bleeding', requiresALS: true  },
  { id: 'unconscious',           label: 'Unresponsive / fainting',    requiresALS: true  },
  { id: 'poisoning-suspected',   label: 'Suspected poisoning',        requiresALS: true  },
  { id: 'pregnancy-related',     label: 'Pregnancy-related concern',  requiresALS: true  },
  { id: 'burn',                  label: 'Burn',                       requiresALS: false },
  { id: 'fracture-suspected',    label: 'Possible fracture',          requiresALS: false },
  { id: 'high-fever',            label: 'High fever',                 requiresALS: false },
  { id: 'abdominal-pain',        label: 'Abdominal pain',             requiresALS: false },
  { id: 'minor-injury',          label: 'Minor injury',               requiresALS: false },
  { id: 'routine-followup',      label: 'Routine follow-up / refill', requiresALS: false },
];
export const SYMPTOM_IDS = SYMPTOM_TAGS.map((t) => t.id);

// ---------------------------------------------------------------------------
// Feature vector — 18 dims. train.py and server/src/services/features.js
// must both produce exactly this layout.
// ---------------------------------------------------------------------------
export const FEATURE_ORDER = [
  ...SYMPTOM_IDS,      //  0..11  multi-hot
  'durationBucket',    //  12     0..4  -> /4
  'ageBucket',         //  13     0..5  -> /5
  'chronicFlag',       //  14     0|1
  'immobileFlag',      //  15     0|1
  'severitySelf',      //  16     1..5  -> /5
  'hourOfDay',         //  17     0..23 -> /23
];
export const FEATURE_DIM = FEATURE_ORDER.length; // 18

export const DURATION_BUCKETS = [
  { id: 0, label: 'Under 1 hour',  maxHours: 1 },
  { id: 1, label: '1–6 hours',     maxHours: 6 },
  { id: 2, label: '6–24 hours',    maxHours: 24 },
  { id: 3, label: '1–3 days',      maxHours: 72 },
  { id: 4, label: 'Over 3 days',   maxHours: Infinity },
];

export const AGE_BUCKETS = [
  { id: 0, label: '0–5',   maxAge: 5 },
  { id: 1, label: '6–17',  maxAge: 17 },
  { id: 2, label: '18–40', maxAge: 40 },
  { id: 3, label: '41–60', maxAge: 60 },
  { id: 4, label: '61–75', maxAge: 75 },
  { id: 5, label: '76+',   maxAge: Infinity },
];

// ---------------------------------------------------------------------------
// Request lifecycle
// ---------------------------------------------------------------------------
export const REQUEST_STATES = {
  DRAFT: 'draft',
  TRIAGED: 'triaged',
  AWAITING_REVIEW: 'awaiting_human_review',
  MATCHING: 'matching',
  OFFERED: 'offered',
  CONFIRMED: 'confirmed',
  IN_TRANSIT: 'in_transit',
  SCHEDULED: 'scheduled',
  FULFILLED: 'fulfilled',
  FALLBACK_APPLIED: 'fallback_applied',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

export const ASSIGNMENT_STATUS = {
  PROPOSED: 'proposed',
  AWAITING_APPROVAL: 'awaiting_approval', // preemption needs a human
  ACTIVE: 'active',
  PREEMPTED: 'preempted',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
};

// ---------------------------------------------------------------------------
// Resources — one collection, three kinds, one matcher.
// ---------------------------------------------------------------------------
export const RESOURCE_KINDS = ['ambulance', 'doctor', 'pharmacy'];

export const AMBULANCE_TYPES = {
  ALS: { code: 'ALS', label: 'Advanced Life Support', rank: 2, speedKmph: 42 },
  BLS: { code: 'BLS', label: 'Basic Life Support',    rank: 1, speedKmph: 45 },
};

export const SPECIALTIES = [
  'general-physician', 'cardiology', 'pulmonology', 'orthopedics',
  'pediatrics', 'obstetrics', 'general-surgery', 'dermatology',
];

// Which specialty a tag routes to. Used by the matcher's capability term.
export const TAG_TO_SPECIALTY = {
  'chest-pain': 'cardiology',
  'breathing-difficulty': 'pulmonology',
  'trauma-bleeding': 'general-surgery',
  'unconscious': 'general-physician',
  'poisoning-suspected': 'general-physician',
  'pregnancy-related': 'obstetrics',
  'burn': 'general-surgery',
  'fracture-suspected': 'orthopedics',
  'high-fever': 'general-physician',
  'abdominal-pain': 'general-physician',
  'minor-injury': 'general-physician',
  'routine-followup': 'general-physician',
};

// ---------------------------------------------------------------------------
// Zones. trafficIndex drifts each simulation tick; the seed value is the mean.
// Centred on Hyderabad. [lng, lat] — GeoJSON order, not lat/lng.
// ---------------------------------------------------------------------------
export const CITY_CENTER = [78.4867, 17.385];

export const ZONES = [
  { id: 'Z1', name: 'Central',   center: [78.4867, 17.3850], trafficIndex: 1.6, roadFactor: 1.35 },
  { id: 'Z2', name: 'North',     center: [78.4600, 17.4450], trafficIndex: 1.2, roadFactor: 1.25 },
  { id: 'Z3', name: 'IT Corridor', center: [78.3800, 17.4450], trafficIndex: 1.9, roadFactor: 1.40 },
  { id: 'Z4', name: 'South',     center: [78.5100, 17.3200], trafficIndex: 1.0, roadFactor: 1.20 },
];

// ---------------------------------------------------------------------------
// Matcher weights. Exposed in the dispatcher console so they can be retuned live.
// ---------------------------------------------------------------------------
export const MATCH_WEIGHTS = {
  eta: 1.0,          // w1 — speed
  capability: 2.5,   // w2 — right care beats near care
  load: 0.6,         // w3 — don't hammer one provider
  patientCost: 0.4,  // w4 — affordability
  urgency: 1.2,      // w5 — subtracted; tier-weighted boost
};

export const CANDIDATE_RADIUS_M = { ambulance: 15000, doctor: 12000, pharmacy: 7000 };
export const CANDIDATE_LIMIT = 12;

// ---------------------------------------------------------------------------
// Confidence gates — where the machine stops and a human takes over.
// ---------------------------------------------------------------------------
export const REVIEW_GATES = {
  minConfidence: 0.65,   // below this -> human review queue
  minTopTwoGap: 0.15,    // ambiguous between two tiers -> human review queue
};

// ---------------------------------------------------------------------------
// Degradation sources shown to the user. Never degrade silently.
// ---------------------------------------------------------------------------
export const SOURCES = {
  MODEL: 'model',
  RULE_FALLBACK: 'rule-fallback',
  HUMAN: 'human-reviewed',
  MOCK: 'mock-fixture',
};

export const CHAOS_FLAGS = ['killGemini', 'killMlSvc', 'trafficSpike', 'ambulanceOffline', 'pharmacyStockout'];
