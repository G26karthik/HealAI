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

## Getting started

**Never used Git or a terminal? Start here.** Follow every step in order. It takes about
20 minutes, most of which is downloads running by themselves.

---

### Step 1 — Install four programs (one time only)

| Program | Where | Notes |
|---|---|---|
| **Node.js** | [nodejs.org](https://nodejs.org) | Pick the big green **LTS** button |
| **Python** | [python.org/downloads](https://www.python.org/downloads/) | ⚠️ **Tick "Add python.exe to PATH"** on the first install screen |
| **Git** | [git-scm.com/downloads](https://git-scm.com/downloads) | Click Next through everything |
| **VS Code** | [code.visualstudio.com](https://code.visualstudio.com) | The editor we use |

> The Python **"Add to PATH"** checkbox is easy to miss and is the single most common reason setup
> fails. If you missed it, re-run the installer and choose *Modify*.

**Restart your computer after installing.** Windows will not see the new programs until you do.

---

### Step 2 — Download the code

Open VS Code → **Terminal** menu → **New Terminal**. A panel opens at the bottom. Type:

```powershell
cd Desktop
git clone https://github.com/G26karthik/HealAI.git
cd HealAI
```

<details>
<summary><strong>What did that just do?</strong></summary>

- `cd Desktop` — move into your Desktop folder
- `git clone …` — download a copy of the project from GitHub into a new `HealAI` folder
- `cd HealAI` — move into it

You now have the whole project on your machine. Everything from here runs inside this folder.
</details>

Now open the folder in VS Code: **File → Open Folder…** → pick `HealAI`. Open a new terminal
(**Terminal → New Terminal**) and it will already be in the right place.

---

### Step 3 — Install everything

```powershell
npm run setup
```

This takes 5–15 minutes and prints its progress. It installs the app's packages, creates the
Python environment, downloads PyTorch (a big file — be patient), and creates your config file.

If it stops with a red ✗, read the message: it names the problem and what to do. Fixing that and
running `npm run setup` again is always safe.

---

### Step 4 — Add the keys

The app needs four credentials. **They are not in the repository on purpose** — API keys must never
be put on GitHub, where anyone could find and use them.

In VS Code's file list on the left, open `server` → `.env` and fill in:

```
MONGODB_URI=              the database
GEMINI_API_KEY=           reads what the patient typed
CLOUDINARY_CLOUD_NAME=    stores photos
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

**Ask your team lead for these values.** Paste each one directly after its `=`, with no spaces and
no quote marks. Save with `Ctrl+S`.

> **No keys yet?** You can still run and explore the app. Set `GEMINI_MOCK=true` and it uses
> built-in sample answers. Only `MONGODB_URI` is truly required — without it nothing can be saved.

---

### Step 5 — Build the AI model and the test data

```powershell
npm run train
```

Takes about a minute. It trains the urgency model and prints its accuracy. You only need to do this
once.

```powershell
npm run seed
```

Takes seconds. It creates the pretend hospital world: 16 ambulances, 24 doctors, 12 pharmacies.

---

### Step 6 — Start the app

```powershell
npm run dev
```

**Leave this running.** Three colour-coded services start together — `[api]`, `[web]`, `[ml]`.
Wait for these three lines:

```
[ml]   Uvicorn running on http://127.0.0.1:8000
[api]  http://localhost:5000
[web]  ➜  Local:   http://localhost:5173/
```

Then open **<http://localhost:5173>** in your browser.

You should see the app with **four green dots** in the top-right corner. Green means every service
is healthy. To stop everything, click the terminal and press `Ctrl + C`.

---

### Every day after that

You only do Steps 1–5 once. From then on it is:

```powershell
cd Desktop\HealAI
git pull          # get your teammates' latest changes
npm run dev       # start it
```

If a teammate added a new package, `git pull` then `npm run setup` again.

---

### Where things are

| URL | What it is |
|---|---|
| <http://localhost:5173> | **The app** — this is the one you want |
| <http://localhost:5000/api/health> | Is the backend alive, and are its services connected |
| <http://localhost:8000/docs> | A page for testing the AI model by hand |

---

### When something goes wrong

| What you see | What to do |
|---|---|
| `'npm' is not recognized` | Node isn't installed, or you didn't restart after installing |
| `'git' is not recognized` | Same, for Git |
| `Python was not found` | You missed the **Add to PATH** tick box. Re-run the Python installer → *Modify* |
| `port 5000 is already in use` | The app is already running in another terminal. Press `Ctrl+C` there, or close it |
| Four dots aren't all green | A service is down. The colour tag in the terminal — `[api]`, `[web]`, `[ml]` — tells you which |
| `"mongo": false` | `MONGODB_URI` is missing or wrong in `server/.env`. **Restart after editing it** — config is only read at startup |
| `"gemini": "mock"` | No Gemini key found. The app still works using sample answers |
| `model_loaded: false` | Run `npm run train`, then restart |
| Nothing works after `git pull` | Run `npm run setup` again |

**The golden rule:** the coloured tag in the terminal tells you which part is unhappy.
`[api]` = backend, `[web]` = the website, `[ml]` = the AI model.

`RUNBOOK.md` goes further — how to test the AI yourself, what the tiers mean, and how to use the
chaos panel.

---

### Settings you may want to change

Both live in `server/.env`. Restart the app after editing.

| Variable | Purpose |
|---|---|
| `GEMINI_MOCK=true` | Stop calling the Gemini API and use built-in samples. **The free tier is only 20 requests per day** — use this while developing and save the real quota for the demo |
| `SIM_SPEED` | How fast simulated ambulances move. Default `30` means a 15-minute journey plays out in 30 seconds. Set `1` for real time |

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
