# MediRoute — How to Run It

A plain-English guide. Keep this open during the event.

---

## 1. What the app is made of

Three programs run at the same time. They are separate on purpose.

| Part | Language | Port | What it does |
|---|---|---|---|
| **Frontend** | React | 5173 | What you see in the browser |
| **Backend** | Node/Express | 5000 | The brain — makes decisions, saves data |
| **Model** | Python/PyTorch | 8000 | The AI — predicts how urgent a case is |

The backend also talks to three outside services: **MongoDB** (stores data),
**Gemini** (understands human language), **Cloudinary** (stores photos).

```
   Browser  ──►  Backend  ──►  Model
   :5173         :5000         :8000
                    │
                    ├─► MongoDB
                    ├─► Gemini
                    └─► Cloudinary
```

**Why separate?** The AI needs Python. The website needs JavaScript. And keeping
decisions in the middle means that if the AI stops working, the backend can still
answer using simple rules — which is a feature we deliberately show off.

---

## 2. Running everything (the normal way)

Open a terminal in VS Code with **Ctrl + `** and run this from the `GGU` folder:

```bash
npm run dev
```

That starts all three at once. You'll see three coloured streams of text:

```
[api]  blue     — the backend
[web]  magenta  — the frontend
[ml]   yellow   — the AI model
```

**Wait for these three lines before opening the browser:**

```
[ml]   Uvicorn running on http://127.0.0.1:8000
[api]  [api] http://localhost:5000  (client origin http://localhost:5173)
[web]  ➜  Local:   http://localhost:5173/
```

**To stop everything:** click in the terminal and press `Ctrl + C`.

---

## 3. Running one part at a time (for debugging)

Useful when one part is misbehaving and you want clean output.

```bash
npm run dev:api     # backend only
npm run dev:web     # frontend only
npm run dev:ml      # AI model only
```

Each needs its own terminal tab.

---

## 4. Training the AI model

You only need to do this **once**, or again if you change `ml-svc/train.py`.

```bash
npm run train
```

Takes about a minute. It creates fake training data, trains the model, and saves it to
`ml-svc/models/urgency_mlp_v1.pt`.

You should see something like:

```
[train] test accuracy        0.829
[train] confident subset     0.884  (abstain rate 15.8%)
[train] T1 recall 0.933   T1 under-routed to T3/T4: 0
```

**The line that matters:** `T1 under-routed to T3/T4: 0` means no real emergency was
ever mistaken for a routine case. That's the safety number to quote to judges.

> After training, restart the model service (or the whole thing) so it picks up the new file.

---

## 5. Checking everything is alive

Open these in your browser. All four should look right before you build or demo.

| URL | Healthy looks like |
|---|---|
| http://localhost:5173 | The app loads, four **green** pills top-right |
| http://localhost:5000/api/health | `"mongo":true, "mlSvc":true, "gemini":"live", "cloudinary":true` |
| http://localhost:8000/health | `"model_loaded": true` |
| http://localhost:8000/docs | An interactive page for testing the AI |

If a pill is amber or red, the matching service is down. The app is built to keep
working anyway — that's the point — but for a demo you want all four green.

---

## 6. How to use the app

### The Patient tab
The home screen. Big red **Get help now** button for emergencies, three cards below
for doctor / medicines / ambulance.

> Right now these are visual only. Intake and triage arrive in F1.

### The Dispatcher tab
This is where a hospital coordinator would sit. Contains the **Chaos panel**, which
already works.

### Using the Chaos panel (this works today)

Five switches. Flip one and the whole system changes behaviour:

| Switch | What breaks | What the app does instead |
|---|---|---|
| Kill Gemini | Language understanding | Falls back to a normal form |
| Kill ML service | The AI model | Falls back to simple if-then rules |
| Traffic spike | Roads in Zone 3 | Arrival times stretch, reassignment offered |
| Ambulance offline | One vehicle | Walks down the fallback list |
| Pharmacy stockout | One pharmacy's stock | Suggests an equivalent medicine |

**Try this:** open the Dispatcher tab in two browser windows side by side. Flip a
switch in one — the other updates instantly. That's the live connection working.

**Why this exists:** the judging rules explicitly ask for *"fallback providers and
error states."* Instead of claiming the system handles failure, you hand a judge a
switch and let them break it while it keeps running.

---

## 7. Testing the AI model yourself

Go to **http://localhost:8000/docs** → click **POST /triage** → **Try it out**.

The model reads **18 numbers**:

- **1–12** — symptoms, `1` = present, `0` = absent, in this order:
  `chest-pain, breathing-difficulty, trauma-bleeding, unconscious, poisoning,
  pregnancy, burn, fracture, high-fever, abdominal-pain, minor-injury, routine-followup`
- **13** — how long: `0` = under an hour … `1` = over 3 days
- **14** — age: `0` = infant, `0.4` = adult, `0.8` = 61–75, `1` = 76+
- **15** — has a long-term condition: `0` or `1`
- **16** — cannot move unaided: `0` or `1`
- **17** — severity the caller reports: `0.2` (mild) … `1.0` (worst)
- **18** — time of day: `0` = midnight, `0.5` = noon

### Three cases worth trying

**Emergency** — chest pain + breathlessness, 30 min, age 62, severity 4:
```json
{"features": [1,1,0,0,0,0,0,0,0,0,0,0, 0, 0.8, 0, 0, 0.8, 0.6]}
```
Expect **T1**, high confidence.

**Routine** — follow-up, 5 days, age 30, severity 2:
```json
{"features": [0,0,0,0,0,0,0,0,0,0,0,1, 1, 0.4, 0, 0, 0.4, 0.5]}
```
Expect **T4**.

**Uncertain** — fever, 1 day, age 70, long-term condition, severity 3:
```json
{"features": [0,0,0,0,0,0,0,0,1,0,0,0, 0.5, 0.8, 1, 0, 0.6, 0.5]}
```
Look for **`"needsHumanReview": true`**. This is the best thing in the project — the
AI refusing to decide and handing the case to a person. Nudge severity up and down
to find the exact point where it flips.

### Reading the answer

```jsonc
{
  "tier": "T1",                  // T1 emergency, T2 urgent today, T3 routine, T4 pharmacy
  "confidence": 0.94,            // how sure it is
  "needsHumanReview": false,     // true = a human must confirm
  "safetyTieBreak": false,       // true = it rounded UP in urgency to be safe
  "drivers": [                   // why it decided this
    {"label": "difficulty breathing reported", "delta": 0.31}
  ],
  "disclaimer": "Dispatch priority only. Not a diagnosis..."
}
```

`drivers` is the "why". A bigger `delta` means that fact pushed the decision harder.

Also visit **http://localhost:8000/metrics** — the model's own report card, including
its stated limitations.

---

## 8. What the tiers mean

These are **queues**, not medical labels. The system never names a condition.

| Tier | Meaning | Target response |
|---|---|---|
| **T1** | Emergency dispatch | ambulance, 10 min |
| **T2** | Urgent, same day | doctor, 2 hrs |
| **T3** | Routine appointment | doctor, 24 hrs |
| **T4** | Pharmacy or self-care | medicines, 48 hrs |

---

## 9. When something goes wrong

| Problem | Fix |
|---|---|
| `Port 5000 already in use` | An old copy is still running. `Ctrl + C`, or close other terminals |
| `model_loaded: false` | Run `npm run train`, then restart |
| `"mongo": false` | Check `server/.env` has `MONGODB_URI`, and Atlas allows your IP (`0.0.0.0/0`) |
| `"gemini": "mock"` | No API key found in `server/.env`. The app still works, using canned answers |
| Browser shows nothing | Look at the `[web]` lines — Vite may still be starting |
| Changed `server/.env` | Restart. Environment files are only read at startup |
| Nothing works after `git pull` | `npm install` in the root, `client` and `server` folders |

**Rule of thumb:** the coloured tag in the terminal tells you which part is unhappy.
`[api]` = backend, `[web]` = frontend, `[ml]` = the model.

---

## 10. Where things live

```
GGU/
├─ client/        the website you see
│  └─ src/pages/  PatientHome.jsx, Dispatcher.jsx
├─ server/        the backend brain
│  ├─ src/models.js    what the data looks like
│  ├─ src/index.js     the API
│  └─ .env             YOUR KEYS — never share or commit
├─ ml-svc/        the AI
│  ├─ train.py         builds the model
│  ├─ app.py           serves predictions
│  └─ models/          the trained file
├─ shared/enums.js  the shared rulebook all three read
├─ PLAN.md          the 3-hour build plan
└─ RUNBOOK.md       this file
```

---

## 11. What isn't built yet

Being honest so nothing surprises you mid-demo:

- The SOS button and the three cards do nothing yet
- There is no intake form — you cannot yet type a sentence and get a tier
- The dispatcher has no queue and no map
- The database is empty; nothing writes to it yet
- No doctors, ambulances or pharmacies exist yet

**Next up (F1):** type a sentence in the browser → Gemini tidies it → the model scores
it → it saves to MongoDB → the screen shows the tier, the confidence and the reasons.
Plus the rules-based backup for when the model is switched off.
