# HealAI — Urgency-Aware Healthcare Access & Dispatch

**Problem statement P21** — AI Healthcare Access & Emergency Booking Assistant

One request goes in — typed or spoken, in any language — and HealAI takes it all the way to an
outcome: triaged for urgency, matched to the right ambulance or doctor, dispatched, and tracked
until arrival. It does this under real constraints: too few ambulances, traffic that changes,
providers that drop offline. Every AI decision shows its inputs and its confidence, and the ones it
is not sure about stop for a human.

> **HealAI does not diagnose.** It assigns a *dispatch priority* and coordinates access. The model's
> output vocabulary contains no medical condition, and that is enforced in code, not just in policy.

---

## The users

| User | What they do |
|---|---|
| **Patient / caller** | Describes the problem in their own words, sees the priority and why, picks an option, tracks arrival |
| **Dispatcher** | Works an urgency-sorted queue, confirms or overrides what the model was unsure about, watches the live map, can break dependencies to test resilience |
| **Doctor / pharmacy** | Receives bookings against real slot and stock constraints |

---

## What makes this more than a booking form

The event's hardness standard says a form + database + dashboard is not enough. Each requirement
maps to something concrete:

| Requirement | How it is met |
|---|---|
| **Constraints** | ALS-only vehicles for cardiac/trauma T1, slot windows, delivery radius, prescription gating |
| **Competing objectives** | Assignment cost blends travel time vs capability fit vs provider load vs patient cost vs urgency |
| **Uncertainty** | ETA is a **range** (p50/p90), and the model **abstains** when it is not confident |
| **Failures** | A chaos panel kills Gemini, the ML service, vehicles or stock live — the system keeps working and says how it is degraded |
| **Changing conditions** | A 1 Hz simulation moves vehicles and drifts traffic; ETAs update and explain themselves |
| **Human-in-the-loop** | Low-confidence triage is blocked from dispatch until a person confirms it |

### Two risk postures, one estimate
`T1/T2` rank options on **p90** — in an emergency the worst case is what matters.
`T3/T4` rank on **p50** — for routine work, throughput matters. Same numbers, opposite posture.

### Nearest is not nearest-suitable
For a cardiac T1, a basic ambulance 1232 m away is **removed**, not ranked lower, and an advanced
unit at 1455 m is chosen. The UI shows what was ruled out and why.

---

## Architecture

```
React + Vite + Tailwind          ──REST + Socket.IO──►   Node / Express  :5000
  Patient   SOS · Intake · Result · Options · Track           │   decision layer
  Dispatcher Queue · Review · Map · Chaos · KPIs              │
                                                              ├──► MongoDB Atlas (2dsphere)
                                                              ├──► Gemini      (parse · translate)
                                                              ├──► Cloudinary  (prescription photos)
                                                              └──► FastAPI + PyTorch  :8000
                                        in-process simulation: 1 Hz vehicle + traffic tick
```

**Why the layers split this way.** Prediction is learned and uncertain, so it lives in PyTorch.
*Decisions* must be deterministic, auditable and replayable, so they live in Express as explicit
cost functions. Gemini never decides anything — it turns messy human input into structured fields
and turns structured decisions back into plain language. That separation is why every outcome can
be explained, and why the system still works when any model is unavailable.

### One matcher, three resource kinds
A doctor, an ambulance and a pharmacy are the same thing to the dispatch layer: a geo-located
resource with capabilities, availability and load. So `matchResources()` is written once and used
three times:

```
$geoNear top-K  →  hard constraints  →  weighted cost  →  rank
(indexed, so     (remove the           (breakdown stored
 cost is         impossible, don't      on the assignment)
 independent      merely demote)
 of DB size)
```

Adding blood banks or diagnostic labs is a constraint function and a seed file, not new code.

---

## Where AI is used

| Purpose | Model | Human review point |
|---|---|---|
| Read free-text intake → structured fields | `gemini-3.6-flash`, JSON schema-constrained | Fields are shown and editable |
| Assign dispatch priority tier | `urgency-mlp-v1` (PyTorch, 18→64→32→4) | **Abstains below 65% confidence** |
| Explain the decision | Template, Gemini for translation | Guardrail blocks any diagnostic phrasing |
| Rank and assign resources | Deterministic cost function — **not** a model | Dispatcher can override |

Every AI call and every human override is written to an `auditLog` collection and surfaced in the
UI as a "Where AI was used" panel.

### Model card — `urgency-mlp-v1`

Trained on 8,000 synthetic intakes generated by a documented rule process plus label noise.

| Metric | Value |
|---|---|
| Test accuracy | 0.829 |
| Accuracy on cases it keeps | 0.884 |
| Accuracy on cases it abstains from | 0.536 |
| Abstain rate | 15.8% |
| Calibration error (ECE) | 0.029 → 0.018 after temperature scaling |
| T1 recall | 0.933 |
| **True T1 sent to T3/T4** | **0** |

The abstain gate is doing real work: on cases it hands to a human it would have been right barely
half the time, versus 88% on the cases it keeps. Errors only ever land in an *adjacent* tier — the
model never jumps from emergency to self-care.

**Explanations** use leave-one-out attribution against an *urgency margin*
(`max(T1,T2) − max(T3,T4)`) in logit space. Probabilities saturate at 0.9999 on a clear emergency,
which would make every contribution read as zero exactly when the model is most certain; and
attributing to the chosen tier inverts the meaning whenever that tier is a low-urgency one.

---

## Running it

**Prerequisites:** Node 20+, Python 3.10+, a MongoDB Atlas cluster, a Gemini API key, a Cloudinary
account.

```bash
# 1. install
npm install
npm --prefix client install
npm --prefix server install
python -m venv ml-svc/.venv
ml-svc/.venv/Scripts/pip install torch --index-url https://download.pytorch.org/whl/cpu
ml-svc/.venv/Scripts/pip install -r ml-svc/requirements.txt

# 2. configure — copy the template and fill in your own keys
cp server/.env.example server/.env

# 3. train the urgency model (~60s on CPU)
npm run train

# 4. seed the synthetic world
npm run seed

# 5. run everything
npm run dev
```

| Service | URL |
|---|---|
| App | http://localhost:5173 |
| API health | http://localhost:5000/api/health |
| Model service | http://localhost:8000/health |
| Interactive model tester | http://localhost:8000/docs |

`RUNBOOK.md` has a plain-English guide, test cases and a troubleshooting table.

### Useful settings
| Variable | Purpose |
|---|---|
| `GEMINI_MOCK=true` | Serve canned fixtures instead of calling the API — the Gemini free tier is **20 requests/day** |
| `SIM_SPEED` | Simulation acceleration, default `30` (a 15-minute ETA plays out in 30 seconds) |

---

## Technology choices

| Choice | Why |
|---|---|
| **PyTorch** for triage | A calibrated classifier with a real abstain gate; small enough to retrain in 60s |
| **Cost function, not a model**, for assignment | Dispatch decisions must be auditable and replayable; a learned ranker could not explain itself to a dispatcher |
| **MongoDB `2dsphere`** | Geo candidate generation is the hot path; indexed top-K keeps cost independent of database size |
| **One `resources` collection** | Lets the matcher be written once for three resource kinds |
| **Leaflet + OpenStreetMap** | No API key, no billing, nothing to expire on event day |
| **Socket.IO** | Vehicle positions and queue changes are push, not poll — with a polling backstop |
| **Gemini with a response schema** | Constrains output to a fixed tag vocabulary, so free text can never reach the classifier as an unknown category |

---

## Known limitations

- All data is **synthetic**. No real provider, patient, address or inventory is represented.
- The urgency model is trained on rule-generated labels and is **not clinically validated**. It
  prioritises dispatch; it does not diagnose.
- ETA is analytical (distance ÷ speed, adjusted for road factor and simulated traffic) with an
  empirically-shaped spread. There is no real road network or traffic feed behind it.
- The simulation runs at 30× real time by default. This is stated in the API and shown on screen.
- Assignment is greedy per request with urgency ordering, not a global optimum.
- No real identity verification, payments, telephony or hospital-system integration.
- Prescription OCR (in progress) is best-effort and every prescription item requires pharmacist
  confirmation before ordering.

## Next steps

- Learned heteroscedastic ETA model replacing the analytical estimate
- Real traffic and map-matching APIs
- Clinician-labelled triage data with prospective validation
- Global (Hungarian) assignment across competing requests, with preemption approval
- ABDM / HMIS integration
- Fairness audit of tier assignment across age and language groups

---

## Repository layout

```
client/     React app — patient and dispatcher tabs
server/     Express API, matcher, fallback ladders, simulation, audit log
ml-svc/     FastAPI + PyTorch — train.py builds the model, app.py serves it
shared/     enums.js — the single contract all three layers import
PLAN.md     Build plan and rubric mapping
RUNBOOK.md  Plain-English operating guide
```

Built for the Engineering Day hackathon. Synthetic data only.
