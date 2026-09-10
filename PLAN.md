# MediRoute — Urgency-Aware Healthcare Access & Dispatch
## 3-HOUR SOLO BUILD PLAN

**Problem statement:** P21 — AI Healthcare Access & Emergency Booking Assistant
**Constraint:** 180 minutes, one developer, accounts already provisioned
**Stack:** React + Tailwind · Node/Express + MongoDB · PyTorch (FastAPI) · Gemini · Cloudinary

---

## 0. The scope decision

Three hours solo cannot produce the eight-feature system. It **can** produce a system that is
narrow but genuinely hard — which is exactly what Rule 8 asks for:

> *"A basic form + database + dashboard alone is not sufficient for a top score."*

So we cut breadth, not depth. Five features, one demo path, zero half-built screens.

| Kept | Why it survives the cut |
|---|---|
| F1 Intake → AI triage (PyTorch + Gemini) | The spine. Nothing else has meaning without a tier |
| F2 Generic constrained matcher | The technical depth. Serves doctors, ambulances **and** pharmacies |
| F3 Live simulation + dispatch + tracking | Proves "changing conditions" and gives the demo motion |
| F4 Prescription photo → medicines (Cloudinary + Gemini vision) | The wow moment, and it uses Cloudinary meaningfully |
| F5 Chaos panel + fallback ladders | Rubric names *"fallback providers and error states"* verbatim. 15 min for a Round-3 win |

| Cut | Replaced by |
|---|---|
| Second PyTorch model for ETA | Analytical ETA + empirical spread factor → still reports p50/p90 |
| Hungarian global assignment | Urgency-sorted greedy + one explicit preemption rule |
| Separate dispatcher app | Role tab inside the same React app |
| Split orders, waitlists, auth, payments, voice | Named in README as "out of scope / next steps" |

**Cut order if you fall behind** (your call, recorded): doctor booking first → then the metrics
comparison → then prescription vision. Never cut F5; it is the cheapest marks on the board.

---

## 1. The one decision that makes 3 hours possible

**A single `resources` collection and a single generic matcher.**

A doctor, an ambulance and a pharmacy are the same thing to the dispatch layer: a geo-located
resource with capabilities, availability and a load factor. Model them once and the matching
engine — the hardest code in the project — gets written **once and used three times**.

```js
// server/src/services/matcher.js  — the heart of the project, ~70 lines
async function matchResources(request, kind) {
  const candidates = await Resource.aggregate([          // 1. indexed geo candidate generation
    { $geoNear: { near: request.loc, distanceField: 'distM',
                  maxDistance: RADIUS[kind], query: { kind, active: true }, limit: 12 } }
  ]);
  const feasible = candidates.filter(r => HARD_CONSTRAINTS[kind](request, r));  // 2. hard filter
  return feasible
    .map(r => ({ resource: r, ...score(request, r, kind) }))                    // 3. cost + breakdown
    .sort((a, b) => a.cost - b.cost);                                           // 4. rank
}
```

That single function is also your best Round-3 answer: *"the dispatch layer is resource-agnostic;
adding blood banks or diagnostic labs is a new constraint function and a seed file, not new code."*

---

## 2. Architecture (three processes, one repo)

```
React 18 + Vite + Tailwind  ──REST + Socket.IO──►  Node/Express :5000
  ├ Patient tab   (SOS · Intake · Triage · Options · Track)        │
  └ Dispatcher tab (Map · Queue · Review · Chaos panel · KPIs)     │
                                                                   ├──► MongoDB Atlas (2dsphere)
                                                                   ├──► Gemini  (3 bounded jobs)
                                                                   ├──► Cloudinary (prescriptions)
                                                                   └──► FastAPI :8000 (PyTorch M1)
  In-process sim: setInterval 1s → move vehicles, drift traffic, emit socket events
```

**The argument to give judges:** prediction is learned and uncertain, so it lives in PyTorch.
*Decisions* must be deterministic, auditable and replayable, so they live in Express as explicit
cost functions. Gemini never decides anything — it structures messy input and explains structured
output. That separation is why every outcome can be explained, and why the system still works when
any model is unavailable.

**Hard rule, never broken:** no diagnosis. The model emits a *routing priority tier*; its label
vocabulary contains zero disease names. Enforced in code, stated on every screen.

### Repo layout
```
GGU/
├─ client/   Vite + React + Tailwind (role-switched tabs, react-leaflet)
├─ server/   Express · Mongoose · Socket.IO · matcher · fallback · sim · audit
├─ ml-svc/   FastAPI + PyTorch (train.py ~60 lines, app.py ~40 lines)
└─ shared/   enums.js — tiers, symptom tags, states, zones (imported by all three)
```

### Data model — 5 collections, deliberately
| Collection | Shape |
|---|---|
| `resources` | `{kind:'doctor'\|'ambulance'\|'pharmacy', name, loc:Point, attrs:{}, capabilities[], load, active, imageUrl}` |
| `requests` | `{rawInput, parsed, tier, confidence, drivers[], needsHumanReview, state, timeline[], loc}` |
| `assignments` | `{requestId, resourceId, kind, cost, breakdown{}, etaP50, etaP90, status, history[]}` |
| `medicines` | `{name, salt, strength, form, rxRequired}` — substitute = same salt+strength |
| `auditLog` | `{ts, actor:'ai'\|'human', model, purpose, confidence, output, humanAction}` |

Zones + traffic indices live in `shared/enums.js` as a constant — not worth a collection today.

---

## 3. The PyTorch model (M1 — Urgency Tier)

One model, done properly. Trains in <60s on CPU.

- **Input (18 features):** multi-hot over 12 *administrative* symptom tags (chest-pain,
  breathing-difficulty, trauma-bleeding, unconscious, high-fever, fracture-suspected,
  abdominal-pain, burn, poisoning-suspected, pregnancy-related, minor-injury, routine-followup),
  duration bucket, age bucket, chronic flag, mobility flag, self-reported severity 1–5, hour-of-day.
- **Output:** 4 tiers — T1 emergency dispatch / T2 urgent same-day / T3 routine / T4 pharmacy-only.
- **Net:** MLP 18→64→32→4, ReLU, dropout 0.2, Adam, 30 epochs, 8k synthetic rows from a documented
  rule labeller + label noise (Rule 8 permits simulated data — say so, don't hide it).
- **Abstain band:** `maxProb < 0.65` or `top1 − top2 < 0.15` → `needsHumanReview = true`, provisional
  tier set to **the more urgent** of the two (safety-biased tie-break). This is your human-in-the-loop.
- **Explainability:** leave-one-out delta across the 18 features (18 forward passes, ~2ms) → top-3
  drivers rendered as *"Raised priority: breathing difficulty (+0.31), age 71 (+0.12)"*.
- **Report in README:** held-out accuracy + confusion matrix + the calibration note.

**ETA (no second model):** `p50 = distance / speed × trafficIndex`, `p90 = p50 × (1 + 0.35·traffic)`.
Presented honestly as analytical with an empirical spread factor. T1 dispatch decides on **p90**
(worst case matters in an emergency), T3 on p50 (throughput) — same number, two risk postures.
A learned heteroscedastic ETA model is listed as next step.

**Fallback:** Node calls `POST /triage` with a 2.5s timeout. On any failure it uses a documented
rule table and stamps `source: "rule-fallback"`, which renders as an amber badge. Never a silent guess.

---

## 4. Gemini's three bounded jobs

1. **Intake parsing** — free text (any language) → strict JSON via `responseSchema`:
   `{symptomTags[], durationHours, age, flags[], severitySelf, language}`. Zod-validated; on schema
   failure fall back to the structured form. **Gemini never outputs a tier.**
2. **Prescription vision** — Cloudinary URL → `{medicineName, strength, qty, confidence}[]` → fuzzy
   match against `medicines`. Every Rx item requires pharmacist confirmation; low-confidence lines
   are flagged for manual edit.
3. **Explanation + translation** — structured decision object → plain language in the patient's
   language. System prompt forbids diagnosis/treatment; a blocklist post-filter ("you have",
   "likely condition", "take X mg") swaps in safe canned copy and logs the incident.

Every call writes to `auditLog`. A **"Where AI was used"** drawer per request lists model, purpose,
confidence and whether a human reviewed it — a direct answer to Rule 1.

Ship `GEMINI_MOCK=true` fixtures from the start. It makes the build testable offline and saves the
demo when venue Wi-Fi dies.

---

## 5. The cost function (what judges will probe)

```
cost(q, r) =  w1·norm(etaP90)          // speed — risk-averse for T1
            + w2·(1 − capabilityMatch) // right care, not merely near care
            + w3·loadPenalty(r)        // don't hammer one provider
            + w4·norm(patientCost)     // affordability
            − w5·urgencyBoost(q)       // tier-weighted
```
Hard constraints filter **before** scoring: ALS-only for T1 trauma/cardiac, Rx validity, pharmacy
delivery radius, doctor slot window, vehicle availability.

**Preemption with human approval** — the demo centrepiece, ~25 lines. A T1 arrives, every ambulance
is committed to T2/T3 runs. The matcher computes the least-harm reassignment and *proposes* it. The
dispatcher sees both patients, both cost breakdowns, both new ETAs, and clicks Approve or Reject.
One interaction that demonstrates competing objectives, changing conditions and human-in-the-loop
simultaneously.

---

## 6. Fallback ladders + chaos panel (F5 — never cut this)

`fallbackEngine.js` walks a documented ladder and records which rung was used:

- **Ambulance:** nearest suitable → adjacent zone → downgrade vehicle class *with explicit warning* →
  partner call-out list → guided self-transport + nearest ER.
- **Doctor:** exact specialty → teleconsult now → nearby general physician → next available slot.
- **Medicine:** in stock nearby → same-salt generic substitute (pharmacist approves) → pickup instead
  of delivery → backorder with ETA.
- **Infrastructure:** Gemini down → structured form · ML down → rule table · socket drop → 5s polling
  · Cloudinary fail → manual entry · GPS denied → manual pincode.

Every fallback shows a plain-language banner: what degraded, what we did instead, what to expect.

**Chaos panel** (dispatcher tab): toggles to kill Gemini, kill ml-svc, spike a zone's traffic, take an
ambulance offline, zero a pharmacy's stock. Flip them live while judges watch. This converts
"we handle errors" from a claim into a demonstration.

---

## 7. Minute-by-minute build (T+0 → T+180)

Exit tests are non-negotiable — if one fails, fix it before moving on.

### SETUP · T+0 → T+20
- **First command, backgrounded:** `pip install torch --index-url https://download.pytorch.org/whl/cpu`
  (the single biggest time risk — start it before anything else)
- `npm create vite@latest client -- --template react` · Tailwind v3 · axios · react-leaflet · socket.io-client
- `server/`: Express · CORS · Mongoose connect · Socket.IO · Zod · `GET /api/health`
- `shared/enums.js` — tiers, 12 symptom tags, states, 4 zones
- `.env` from the three provisioned accounts + committed `.env.example` with values blanked
- ✅ **Exit:** client renders, `/api/health` returns `{mongo:true}`, `:8000/health` returns ok

### F1 · Intake → Triage · T+20 → T+60
The spine. Nothing else starts until this works end to end.
- `ml-svc/train.py`: synthetic generator + MLP + save `model.pt` + print accuracy/confusion matrix
- `ml-svc/app.py`: `POST /triage` → tier, confidence, top-3 drivers, abstain flag
- `server`: `POST /api/requests` → Gemini parse → Zod → ml-svc → persist request + auditLog → rule fallback
- `client`: intake screen (text + symptom chips), triage result card with drivers, confidence,
  "not a diagnosis" notice, and the "awaiting human review" state
- ✅ **Exit:** *"chest pain and breathlessness for 30 minutes, age 62"* → persisted **T1**, confidence,
  3 drivers, 1 audit row. Kill ml-svc → same request completes with an amber `rule-fallback` badge.

### F2 · Generic matcher + dispatch + booking · T+60 → T+95
- `seed.js`: 15 ambulances, 25 doctors, 12 pharmacies, 40 medicines, 4 zones — **deterministic**
- `matcher.js`: `$geoNear` → hard constraints → cost + breakdown → ranked
- `POST /api/assignments` with slot/vehicle locking; preemption proposal path
- `client`: ranked options with a *"why this one"* cost-breakdown chip; confirm
- ✅ **Exit:** T1 returns ranked ALS units and it is **not** always the nearest — open the breakdown
  and the capability term explains why. Double-booking is rejected.

### F3 · Simulation + live map + tracking · T+95 → T+125
- `sim.js`: 1 Hz — move assigned vehicles along the bearing, drift zone traffic, re-emit ETA
- Socket.IO room per request; dispatcher subscribes to all
- `client`: Leaflet + OSM tiles (no API key), live markers, ETA band p50–p90, status timeline
- ✅ **Exit:** dispatch a T1, the marker moves, the ETA band updates every tick, both tabs stay in sync

### 🚩 T+125 — HARD CHECKPOINT
Intake → triage → dispatch → track must run end to end. **If it doesn't, stop adding features and
fix it.** Everything below is additive.

### F4 · Prescription photo → medicines · T+125 → T+145
- Cloudinary unsigned upload from the browser → `secure_url` to the API
- Gemini vision → extract → fuzzy-match → confidence flags → pharmacist approval gate
- Reuse `matchResources(request, 'pharmacy')` — inventory + radius are just its hard constraints
- ✅ **Exit:** photo → 2 medicines found, 1 out of stock → same-salt substitute proposed → approved →
  order placed with a delivery ETA

### F5 · Chaos panel + fallback ladders · T+145 → T+160
- `fallbackEngine.js` + `fallbackUsed` on every response + degradation banners + chaos toggles
- ✅ **Exit:** with Gemini **and** ml-svc both killed, a request still completes end to end, with a
  banner naming each degradation

### FREEZE · T+160 → T+180
- `npm run seed:demo` — stages the exact demo scenario in one command (rehearse this, not the app)
- README: problem · users · architecture diagram · setup/run · **where AI is used** · model accuracy ·
  limitations · next steps
- Two full dry-runs against the clock. **Any feature not working at T+170 gets flagged off.**

---

## 8. Four-minute demo script

1. Type *"seene mein dard aur saans phoolna, 30 minutes"* → parsed → **T1**, confidence 0.91, three
   drivers, "not a diagnosis" notice visible.
2. Dispatch: an **ALS** unit that is *not* the nearest. Open the cost breakdown — the capability
   constraint explains it. ETA 7 min, p90 11 min.
3. **Chaos toggle:** traffic spike in Zone 3 → ETA band widens → preemption proposed → approve →
   both patients' timelines update live.
4. Second request lands at confidence 0.58 → **human review queue** → confirm the tier → the patient
   screen shows *"reviewed by a human"*.
5. **Prescription photo** → 2 medicines → 1 out of stock → substitute → pharmacist approves → ETA.
6. **Kill Gemini and ml-svc.** A new request still completes on rules, with amber banners.
   Nothing silently guesses.
7. Limitations slide. Then stop talking.

---

## 9. Limitations to state yourself (Rule 4 rewards this)

- All data is synthetic; the tier model is trained on rule-generated labels and is **not clinically
  validated** — it prioritises dispatch, it does not diagnose.
- ETA is analytical over a simulated traffic process, not real road data.
- Prescription OCR is best-effort; every Rx item requires pharmacist confirmation.
- Substitution matches salt + strength only — no interaction or allergy checking.
- No real identity, payments, telephony or hospital-system integration.

**Next steps:** learned heteroscedastic ETA, real traffic/map-matching, clinician-labelled triage data
with prospective validation, global (Hungarian) assignment, ABDM/HMIS integration, fairness audit of
tier assignment across age and language groups.

---

## 10. Risk register

| Risk | Mitigation |
|---|---|
| Torch install eats 20 min | Backgrounded as the very first command at T+0 |
| Gemini quota / venue Wi-Fi | 4s timeout · response cache · `GEMINI_MOCK=true` fixtures · rule fallback |
| Atlas blocked on venue network | Local `mongod` + a `MONGODB_URI` switch ready |
| Map keys / billing | Leaflet + OSM tiles — no key at all |
| Solo context-switching | Strict phase order; never open two features at once |
| Scope creep | Auth, payments, chat, voice, split orders are **out of scope** — say it, don't build it |

---

## 11. Rubric check at T+170

| Marks | Item | Evidence |
|---|---|---|
| 5 | Problem understanding | Access + tracking framing, no diagnosis, documented fallback ladders |
| 10 | Originality | Resource-agnostic matcher + preemption-with-approval + chaos-proven resilience |
| 15 | Technical implementation | PyTorch tier model w/ calibration + abstain, geo-indexed matching, 1 Hz sim, audit log |
| 10 | Functioning MVP | Intake → triage → dispatch → medicines → live tracking |
| 5 | Problem-solving | Preemption, substitutes, five degradation modes |
| 5 | Scalability | `$geoNear` top-K, one matcher for N resource kinds, stateless API, model versioning |
| 20 | UI/UX | Emergency Mode, WCAG AA contrast, keyboard nav, explicit degradation states |
| 30 | Communication | Demo script above, cost breakdowns on screen, honest limitations |
