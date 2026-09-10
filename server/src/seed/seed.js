import mongoose from 'mongoose';

import { connectDb } from '../db.js';
import { Resource, Medicine, Request, Assignment, AuditLog } from '../models.js';
import { ZONES, SPECIALTIES, AMBULANCE_TYPES, REQUEST_STATES } from '../../../shared/enums.js';

/**
 * Deterministic synthetic seed.
 *
 * Everything here is invented. No real provider, address, person or inventory
 * is represented, which is what the event rules require and also what lets the
 * whole dataset live in git. The PRNG is seeded so `npm run seed` produces the
 * identical world every time — which matters when you are rehearsing a demo
 * and need the same ambulance to be nearest on the fifth run as on the first.
 */

function mulberry32(seed) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20260910);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => a + rand() * (b - a);

/** Scatter a point around a zone centre. ~0.03° ≈ 3km. */
function near(zone, spread = 0.03) {
  return {
    type: 'Point',
    coordinates: [
      Number((zone.center[0] + (rand() - 0.5) * spread * 2).toFixed(6)),
      Number((zone.center[1] + (rand() - 0.5) * spread * 2).toFixed(6)),
    ],
  };
}

/* ------------------------------------------------------------------ names */
const SURNAMES = ['Rao', 'Iyer', 'Menon', 'Reddy', 'Kulkarni', 'Banerjee', 'Sharma', 'Nair', 'Das', 'Pillai', 'Verma', 'Joshi'];
const INITIALS = ['A', 'B', 'D', 'K', 'M', 'N', 'P', 'R', 'S', 'V'];
const PHARMACY_PREFIX = ['Sanjeevani', 'CityCare', 'MedPlus', 'Arogya', 'WellPoint', 'LifeLine', 'GreenCross', 'NovaMeds'];

/* -------------------------------------------------------------- medicines */
const MEDICINES = [
  ['Paracetamol 500', 'paracetamol', '500mg', 'tablet', false, 25],
  ['Dolo 650', 'paracetamol', '650mg', 'tablet', false, 32],
  ['Calpol 650', 'paracetamol', '650mg', 'tablet', false, 30],
  ['Amoxicillin 500', 'amoxicillin', '500mg', 'capsule', true, 95],
  ['Mox 500', 'amoxicillin', '500mg', 'capsule', true, 88],
  ['Azithromycin 500', 'azithromycin', '500mg', 'tablet', true, 120],
  ['Azee 500', 'azithromycin', '500mg', 'tablet', true, 118],
  ['Amlodipine 5', 'amlodipine', '5mg', 'tablet', true, 45],
  ['Amlong 5', 'amlodipine', '5mg', 'tablet', true, 42],
  ['Telmisartan 40', 'telmisartan', '40mg', 'tablet', true, 78],
  ['Telma 40', 'telmisartan', '40mg', 'tablet', true, 82],
  ['Metformin 500', 'metformin', '500mg', 'tablet', true, 38],
  ['Glycomet 500', 'metformin', '500mg', 'tablet', true, 40],
  ['Atorvastatin 10', 'atorvastatin', '10mg', 'tablet', true, 65],
  ['Pantoprazole 40', 'pantoprazole', '40mg', 'tablet', false, 55],
  ['Cetirizine 10', 'cetirizine', '10mg', 'tablet', false, 18],
  ['Salbutamol Inhaler', 'salbutamol', '100mcg', 'inhaler', true, 210],
  ['Asthalin Inhaler', 'salbutamol', '100mcg', 'inhaler', true, 198],
  ['ORS Sachet', 'oral-rehydration', '21g', 'sachet', false, 22],
  ['Ibuprofen 400', 'ibuprofen', '400mg', 'tablet', false, 30],
];

/* ------------------------------------------------------------ doctor slots */
function buildSlots() {
  const slots = [];
  const now = new Date();
  const start = new Date(now);
  start.setMinutes(now.getMinutes() < 30 ? 30 : 0, 0, 0);
  if (now.getMinutes() >= 30) start.setHours(start.getHours() + 1);

  for (let i = 0; i < 16; i++) {
    const s = new Date(start.getTime() + i * 30 * 60_000);
    slots.push({
      start: s,
      end: new Date(s.getTime() + 30 * 60_000),
      mode: rand() < 0.25 ? 'teleconsult' : 'in-person',
      // Busy early, freer later — so "next available" is a real search, not the first row.
      taken: rand() < 0.55 - i * 0.03,
    });
  }
  return slots;
}

/* ---------------------------------------------------------------- builders */
function buildAmbulances(medicineIds) {
  const out = [];
  let n = 0;
  for (const zone of ZONES) {
    // 4 per zone, roughly a third advanced — scarcity is what makes the
    // assignment problem interesting.
    for (let i = 0; i < 4; i++) {
      const type = i === 0 ? 'ALS' : rand() < 0.25 ? 'ALS' : 'BLS';
      n += 1;
      out.push({
        kind: 'ambulance',
        name: `${type}-${String(n).padStart(2, '0')}`,
        loc: near(zone, 0.035),
        zoneId: zone.id,
        active: true,
        attrs: {
          type,
          status: 'idle',
          speedKmph: AMBULANCE_TYPES[type].speedKmph,
          crewSkill: type === 'ALS' ? 'paramedic' : 'emt',
          heading: Math.round(between(0, 360)),
          // One vehicle per zone is the one the chaos panel takes offline.
          chaosVictim: i === 1,
        },
        capabilities: type === 'ALS' ? ['als', 'bls', 'oxygen', 'defibrillator'] : ['bls', 'oxygen'],
        load: Number(between(0, 0.35).toFixed(2)),
        rating: Number(between(3.9, 4.9).toFixed(1)),
      });
    }
  }
  void medicineIds;
  return out;
}

function buildDoctors() {
  const out = [];
  for (const zone of ZONES) {
    for (let i = 0; i < 6; i++) {
      // Weighted so general physicians are common and specialists are scarce.
      const specialty = i < 2 ? 'general-physician' : pick(SPECIALTIES);
      out.push({
        kind: 'doctor',
        name: `Dr. ${pick(INITIALS)}. ${pick(SURNAMES)}`,
        loc: near(zone, 0.028),
        zoneId: zone.id,
        active: true,
        attrs: {
          specialty,
          fee: Math.round(between(250, 900) / 50) * 50,
          teleconsult: rand() < 0.5,
          slots: buildSlots(),
        },
        capabilities: [specialty],
        load: Number(between(0.1, 0.8).toFixed(2)),
        rating: Number(between(3.6, 5.0).toFixed(1)),
      });
    }
  }
  return out;
}

function buildPharmacies(medicines) {
  const out = [];
  for (const zone of ZONES) {
    for (let i = 0; i < 3; i++) {
      // Each pharmacy stocks a random ~70% of the catalogue, so a stockout and a
      // same-salt substitute are both reachable states in a live demo.
      const inventory = medicines
        .filter(() => rand() < 0.7)
        .map((m) => ({
          medId: m._id,
          qty: rand() < 0.12 ? 0 : Math.round(between(3, 60)),
          price: Math.round(m.mrp * between(0.85, 1.05)),
        }));

      out.push({
        kind: 'pharmacy',
        name: `${pick(PHARMACY_PREFIX)} Pharmacy, ${zone.name}`,
        loc: near(zone, 0.025),
        zoneId: zone.id,
        active: true,
        attrs: {
          open: true,
          inventory,
          deliveryRadiusKm: Number(between(3, 7).toFixed(1)),
          deliveryFee: Math.round(between(0, 60) / 10) * 10,
          chaosVictim: i === 0,
        },
        capabilities: ['dispense', 'delivery'],
        load: Number(between(0, 0.5).toFixed(2)),
        rating: Number(between(3.8, 4.8).toFixed(1)),
      });
    }
  }
  return out;
}

/* -------------------------------------------------------------------- main */
async function main() {
  const demo = process.argv.includes('--demo');

  const ok = await connectDb();
  if (!ok) {
    console.error('[seed] no database connection — check MONGODB_URI in server/.env');
    process.exit(1);
  }

  console.log('[seed] clearing resources, medicines and assignments');
  await Promise.all([Resource.deleteMany({}), Medicine.deleteMany({}), Assignment.deleteMany({})]);

  if (demo) {
    console.log('[seed] --demo: also clearing requests and audit log');
    await Promise.all([Request.deleteMany({}), AuditLog.deleteMany({})]);
  } else {
    // Resources were just deleted and recreated with new ids, so any request
    // that was mid-journey now points at a vehicle that no longer exists. Left
    // alone it sits "in transit" forever and clutters the map. Send them back
    // to triaged so they can be dispatched again against the new fleet.
    const stranded = await Request.updateMany(
      { state: { $in: [REQUEST_STATES.IN_TRANSIT, REQUEST_STATES.CONFIRMED, REQUEST_STATES.SCHEDULED] } },
      {
        $set: { state: REQUEST_STATES.TRIAGED },
        $push: { timeline: { state: REQUEST_STATES.TRIAGED, at: new Date(), by: 'seed', reason: 'fleet reseeded — assignment released' } },
      }
    );
    if (stranded.modifiedCount) console.log(`[seed] released ${stranded.modifiedCount} stranded request(s)`);
  }

  const medicines = await Medicine.insertMany(
    MEDICINES.map(([name, salt, strength, form, rxRequired, mrp]) => ({ name, salt, strength, form, rxRequired, mrp }))
  );
  console.log(`[seed] ${medicines.length} medicines (${new Set(medicines.map((m) => m.salt)).size} distinct salts)`);

  const ambulances = buildAmbulances();
  const doctors = buildDoctors();
  const pharmacies = buildPharmacies(medicines);

  await Resource.insertMany([...ambulances, ...doctors, ...pharmacies]);

  const als = ambulances.filter((a) => a.attrs.type === 'ALS').length;
  const freeSlots = doctors.reduce((n, d) => n + d.attrs.slots.filter((s) => !s.taken).length, 0);

  console.log(`[seed] ${ambulances.length} ambulances (${als} ALS, ${ambulances.length - als} BLS)`);
  console.log(`[seed] ${doctors.length} doctors, ${freeSlots} free slots in the next 8 hours`);
  console.log(`[seed] ${pharmacies.length} pharmacies across ${ZONES.length} zones`);
  console.log('[seed] done');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await mongoose.disconnect();
  process.exit(1);
});
