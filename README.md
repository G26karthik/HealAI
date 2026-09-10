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

| User | What they do | Account needed? |
|---|---|---|
| **Patient / caller** | Describes the problem in their own words, sees the priority and why, picks an option, tracks arrival | **No** — deliberately open |
| **Dispatcher** | Works an urgency-sorted queue, confirms or overrides what the model was unsure about, watches the live map, can break dependencies to test resilience | Yes |
| **Pharmacist** | Approves prescription-only and substituted items before they can be dispensed | Yes |
| **Doctor / pharmacy** | Receives bookings against real slot and stock constraints | — |

Roles are enforced by middleware on the **server**. Hiding a button is a courtesy to the user; it
is not access control, and a dispatcher-only action stays dispatcher-only even if someone calls the
endpoint directly. The patient path is left open on purpose: nobody should meet a sign-up wall in
an emergency.

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

The app needs five credentials. **They are not in the repository on purpose** — API keys must never
be put on GitHub, where anyone could find and use them.

In VS Code's file list on the left, open `server` → `.env` and fill in:

```
MONGODB_URI=              the database
GEMINI_API_KEY=           reads what the patient typed
CLOUDINARY_CLOUD_NAME=    stores prescription photos
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
JWT_SECRET=               signs login tokens
```

**Ask your team lead for the first five.** Paste each one directly after its `=`, with no spaces
and no quote marks. Save with `Ctrl+S`.

`JWT_SECRET` you can generate yourself — any long random string will do:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Why it matters:** without it, a new signing key is created every time the server restarts,
> which signs everyone out. During development the server restarts on every file save, so you
> would be logged out constantly.

> **No keys yet?** You can still run and explore the app. Set `GEMINI_MOCK=true` and it uses
> built-in sample answers. Only `MONGODB_URI` is truly required — without it nothing can be saved
> and you cannot sign in.

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

### Step 7 — Take the tour

| Page | What to do there |
|---|---|
| **Home** `/` | The landing page. Tap *How it works* on any feature card for the technical version |
| **Get help** `/help` | Describe a problem → see the priority and why → pick an ambulance or doctor → track it |
| **Medicines** `/medicines` | Photograph a prescription → matched to pharmacies → pharmacist approves → order |
| **Dispatcher** `/dispatch` | Live map, the queue, review the cases the AI was unsure about, and the chaos panel |
| **Sign in** `/login` | Three one-click demo roles, or create a real account |

**Sign in with a demo account** — no password needed, just click:

| Role | What it unlocks |
|---|---|
| 🙋 **Patient** | Asking for help and tracking it |
| 🎛️ **Dispatcher** | Confirming priorities, overriding the model, the chaos panel |
| 💊 **Pharmacist** | Approving prescription items |

You do **not** need an account to ask for help — that path is deliberately open, because nobody
should hit a sign-up wall in an emergency. But dispatcher actions are enforced on the server, so
the chaos toggles and the review queue will refuse you until you sign in as a dispatcher.

**Three things worth trying:**

1. Type *"chest pain and breathlessness for 30 minutes, he is 62"* on `/help`. Watch it come back
   T1, then open **Why this one?** on the ambulance list — the nearest vehicle is often rejected.
2. Sign in as **dispatcher**, then flip **Kill ML service** on the chaos panel and submit the same
   sentence again. It still works, and says it is running in a reduced mode.
3. Go to `/medicines` and upload any photo. It will find medicines, flag the prescription-only ones,
   and refuse to place the order until a pharmacist name is entered.

---

### Every day after that

You only do Steps 1–5 once. From then on it is:

```powershell
cd Desktop\HealAI
git pull          # get your teammates' latest changes
npm run dev       # start it
```

---

### Updating after someone else has pushed

`git pull` brings the code, but **not** new packages or new config lines. If anything looks broken
after pulling, run this — it is always safe and only takes a minute if nothing changed:

```powershell
git pull
npm run setup     # installs any new packages
npm run dev
```

> ⚠️ **`npm run setup` will never touch your existing `server/.env`** — deliberately, so it cannot
> wipe your keys. That means **new settings are not added for you.** If a teammate adds a config
> line, you have to copy it across by hand.
>
> Compare your `server/.env` against `server/.env.example` after any pull that changes it. Right
> now the one most likely to be missing is **`JWT_SECRET`** — without it you get signed out every
> time the server restarts.

If the database looks wrong or the map is empty, rebuild the test world:

```powershell
npm run seed        # fresh ambulances, doctors, pharmacies
npm run seed:demo   # the same, but also wipes old requests — use before a demo
```

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
| Signed out every few seconds | `JWT_SECRET` is missing from `server/.env`. Copy the line from `.env.example` and generate a value |
| `Sign in to do that` (401) | That action needs an account. Go to `/login` and use a demo role |
| `This action is for dispatcher accounts` (403) | You are signed in, but as the wrong role. Sign out and pick **Dispatcher** |
| `Cannot find module` after a pull | A new package was added. Run `npm run setup` |
| Map is empty, no ambulances | Run `npm run seed` |

**The golden rule:** the coloured tag in the terminal tells you which part is unhappy.
`[api]` = backend, `[web]` = the website, `[ml]` = the AI model.

`RUNBOOK.md` goes further — how to test the AI yourself, what the tiers mean, and how to use the
chaos panel.

---

### Settings you may want to change

All live in `server/.env`. **Restart the app after editing** — config is only read at startup.

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs login tokens. Set it, or everyone is signed out on every server restart |
| `GEMINI_MOCK=true` | Stop calling the Gemini API and use built-in samples. **The free tier is only 20 requests per day** — use this while developing and save the real quota for the demo |
| `SIM_SPEED` | How fast simulated ambulances move. Default `30` means a 15-minute journey plays out in 30 seconds. Set `1` for real time |
| `GEMINI_TIMEOUT_MS` | How long to wait for the language AI before falling back. Default `15000` |

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
| **scrypt from Node's crypto**, not bcrypt | Memory-hard and constant-time, built in, and one fewer package to install on venue wifi |
| **Server-side role middleware** | A hidden button is not access control. The same rules hold whether the request comes from our UI or from curl |

---

## Known limitations

- All data is **synthetic**. No real provider, patient, address or inventory is represented.
- The urgency model is trained on rule-generated labels and is **not clinically validated**. It
  prioritises dispatch; it does not diagnose.
- ETA is analytical (distance ÷ speed, adjusted for road factor and simulated traffic) with an
  empirically-shaped spread. There is no real road network or traffic feed behind it.
- The simulation runs at 30× real time by default. This is stated in the API and shown on screen.
- Assignment is greedy per request with urgency ordering, not a global optimum.
- Prescription transcription is best-effort. Handwriting is genuinely ambiguous, so every line is
  matched against our own catalogue and every prescription-only or substituted item requires a
  named pharmacist before it can be ordered.
- Authentication is real (scrypt + JWT, server-enforced roles) but there is no email verification,
  password reset, rate limiting or account recovery.
- The `partner-operator` rung of the ambulance ladder is documented but has no integration behind
  it — it always falls through to guided self-transport.
- Substitution matches salt and strength only. It does not consider interactions or allergies.
- No real identity verification, payments, telephony or hospital-system integration.

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
client/
  src/pages/        Landing · PatientHome · Medicines · Dispatcher · Login
  src/components/   TriageResult · OptionsList · PrescriptionFlow · MapView · RequestQueue
  src/context/      AuthContext — token, current user, role helpers
  src/lib/          api.js (axios + auth header) · socket.js

server/
  src/routes/       auth · requests · assignments · pharmacy · fleet
  src/services/     triage · matcher · fallback · sim · eta · gemini · prescription · auth · audit
  src/models.js     resources · requests · assignments · orders · users · medicines · auditLog
  src/seed/seed.js  the deterministic synthetic world

ml-svc/             FastAPI + PyTorch — train.py builds the model, app.py serves it
shared/enums.js     the single contract all three layers import
scripts/setup.mjs   one-command setup for a fresh machine

README.md           this file
RUNBOOK.md          plain-English operating guide: testing the AI, tiers, chaos panel
PLAN.md             build plan and rubric mapping
```

### Where to start reading the code

| If you want to understand… | Read |
|---|---|
| How urgency is decided | `ml-svc/train.py`, then `server/src/services/triage.js` |
| How a provider is chosen | `server/src/services/matcher.js` — the cost function is the whole idea |
| What happens when something is unavailable | `server/src/services/fallback.js` |
| How vehicles move | `server/src/services/sim.js` |
| How the AI is kept honest | `server/src/services/gemini.js` (guardrails) and `audit.js` |

Everything shares one vocabulary — tiers, symptom tags, the model's 18 input features, zones — and
it all lives in **`shared/enums.js`**. Change it there or the three layers will disagree.

---

Built for the Engineering Day hackathon. Synthetic data only. Not a diagnostic system.
