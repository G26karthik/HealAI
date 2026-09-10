# HealAI — Judges / Invigilators Guide 🎓

**Problem Statement P21** — AI Healthcare Access & Emergency Booking Assistant

ఈ file లో: project explanation (Telugu + English mix), tech stack ఎందుకు వాడాం, మరియు
**judges అడిగే ప్రశ్నలకు ready answers**.

> Team కోసం full Telugu guide: [`README.te.md`](README.te.md) · Setup: [`README.md`](README.md)

---

## 1. ఒక్క లైన్ లో చెప్పాలంటే (The 20-second pitch)

> ఒక patient **తన మాటల్లో** సమస్య చెప్తాడు. HealAI ఎంత **urgent** అనేది decide చేసి, సరైన
> **ambulance / doctor / pharmacy** ని match చేసి, **live track** చేస్తుంది — ప్రతి decision
> కి **reason చూపిస్తూ**, doubt వచ్చినప్పుడు **మనిషిని అడుగుతూ**.

**English version for judges:**
> One request goes in — typed in any language — and HealAI triages it for urgency, matches the
> right ambulance or doctor under real constraints, and tracks it to arrival. Every AI decision
> shows its reasoning, and the uncertain ones stop for a human.

---

## 2. ⚠️ మొదట చెప్పాల్సిన disclaimer

**"Our app does NOT diagnose."**

మన model **dispatch priority** (ఎంత తొందరగా, ఎవరి దగ్గరకు) మాత్రమే decide చేస్తుంది.
ఏ disease పేరూ చెప్పదు. Model output vocabulary లో **ఏ ఒక్క condition name కూడా లేదు** —
ఇది code లో enforce చేశాం, కేవలం policy కాదు.

Event rule: *"Healthcare challenges are administrative/accessibility/tracking/decision-support
only; no diagnosis claims."* — మనం దీన్ని strict గా follow చేశాం.

---

## 3. Tech Stack — ఏది, ఎందుకు

| Layer | Technology | ఎందుకు ఇదే (Why this) |
|---|---|---|
| **Frontend** | React 18 + Vite + Tailwind CSS | Component-based UI, Vite fast build, Tailwind వల్ల consistent design system |
| **Backend** | Node.js + Express | Decision layer — deterministic, auditable, replayable |
| **Database** | MongoDB Atlas (`2dsphere` index) | Geo-queries మన hot path. Indexed geo-search వల్ల DB size పెరిగినా cost పెరగదు |
| **ML** | PyTorch (FastAPI service) | Calibrated classifier + real abstain gate. 60 సెకన్లలో retrain అవుతుంది |
| **AI / NLP** | Google Gemini (`gemini-3.6-flash`) | Free-text → structured JSON, multilingual, vision for prescriptions |
| **Images** | Cloudinary | Prescription photos, auto-resize, secure URLs |
| **Real-time** | Socket.IO | Vehicle positions push అవుతాయి, poll చేయము (polling backstop ఉంది) |
| **Maps** | Leaflet + OpenStreetMap | **API key అవసరం లేదు, billing లేదు** — event రోజు expire అయ్యేది ఏదీ లేదు |
| **Auth** | scrypt (Node crypto) + JWT | Memory-hard hashing, built-in — extra dependency లేదు |

---

## 4. Architecture — ఎందుకు మూడు layers?

```
React (Vite + Tailwind)  ──REST + Socket.IO──►  Node/Express :5000
   Patient · Medicines · Dispatcher                    │  DECISION layer
                                                        ├──► MongoDB Atlas (2dsphere)
                                                        ├──► Gemini    (parse · vision)
                                                        ├──► Cloudinary (photos)
                                                        └──► FastAPI + PyTorch :8000
                                                                  PREDICTION layer
             in-process simulation: 1 Hz vehicle movement + traffic drift
```

### 🎯 ఇదే మన architecture argument (Round 3 లో ఇది చెప్పండి)

> **Prediction is learned and uncertain → PyTorch లో ఉంటుంది.**
> **Decisions must be auditable and replayable → Express లో explicit cost functions గా ఉంటాయి.**
> **Gemini ఏ decision తీసుకోదు** — messy human input ని structure చేస్తుంది, structured
> decision ని plain language లోకి మారుస్తుంది. అంతే.

ఈ separation వల్లే —
1. ప్రతి outcome **explain** చేయగలం
2. ఏ model fail అయినా **system పని చేస్తూనే ఉంటుంది**

---

## 5. Features — ఏమి చేస్తుంది, ఎలా పని చేస్తుంది

### F1 · Intake + Triage (AI urgency scoring)
**ఏం చేస్తుంది:** ఏ భాషలోనైనా సమస్య రాయొచ్చు → 4 urgency tiers లో ఒకటి assign అవుతుంది.
**ఎలా:** Gemini (JSON schema-constrained) → structured fields → PyTorch MLP (18→64→32→4)
→ temperature-calibrated softmax → tier + confidence + top-3 reasons.
**Safety:** Confidence < 65% అయితే **abstain** → human review queue.

### F2 · Constrained Matching (the core innovation)
**ఏం చేస్తుంది:** సరైన ambulance/doctor/pharmacy ని rank చేస్తుంది.
**ఎలా:** `$geoNear` top-12 → **hard constraints filter** → weighted cost function → rank.

```
cost = w₁·ETA + w₂·(capability gap) + w₃·load + w₄·price − w₅·urgency
```

**⭐ Key point:** Hard constraint fail అయిన candidate ని **తక్కువ rank ఇవ్వము — పూర్తిగా
తీసేస్తాం.** Cardiac case కి BLS ambulance పంపడం *worse option* కాదు, అది *option కానే కాదు*.

### F3 · Live Simulation + Tracking
**ఏం చేస్తుంది:** Ambulance map మీద నిజంగా కదులుతుంది, traffic మారుతుంది, ETA update అవుతుంది.
**ఎలా:** 1 Hz tick loop — vehicles move, zone traffic random-walks. ETA 2+ నిమిషాలు మారితే
**కారణం చెప్తుంది**.

### F4 · Prescription Photo → Order
**ఏం చేస్తుంది:** Prescription ఫోటో తీస్తే మందులు order అవుతాయి.
**ఎలా:** Cloudinary upload → Gemini vision → **మన catalogue తో Levenshtein match** →
pharmacist approval gate.
**Safety:** AI చెప్పిన పేరు మన catalogue లో లేకపోతే **order కాదు**.

### F5 · Fallback Ladders (resilience)
**ఏం చేస్తుంది:** Ideal option లేకపోతే, next-best కి దిగుతుంది — silently కాదు, **చెప్పి**.

| Ladder | Rungs |
|---|---|
| **Ambulance** | nearest-suitable → adjacent-zone → downgrade-class → partner-operator → guided-self-transport |
| **Doctor** | exact-specialty → **teleconsult-now** → general-physician → next-available → escalation |
| **Medicine** | in-stock → split-order → same-salt-substitute → pickup → backorder |

### F6 · Chaos Panel (proven, not claimed)
5 switches — Gemini, ML service, traffic, ambulance, pharmacy stock. Judge చేతికే switch ఇచ్చి
live గా పాడు చేయిస్తాం.

### F7 · Authentication + Roles
3 roles (patient / dispatcher / pharmacist), **server-side enforced**. Patient path మాత్రం open —
emergency లో sign-up wall ఉండకూడదు.

---

## 6. Model Card — the numbers

| Metric | Value | అర్థం |
|---|---|---|
| Test accuracy | **0.829** | Overall |
| Accuracy (confident cases) | **0.884** | Model keep చేసిన cases మీద |
| Accuracy (abstained cases) | **0.536** | Human కి పంపిన cases మీద |
| Abstain rate | **15.8%** | 6 లో 1 case మనిషికి వెళ్తుంది |
| ECE (calibration) | 0.029 → **0.018** | Temperature scaling తర్వాత |
| T1 recall | **0.933** | Emergencies caught |
| **True T1 → T3/T4** | **0** | ⭐ ఒక్క emergency కూడా routine కి వెళ్ళలేదు |

### ⭐ Abstain gate justification
Model keep చేసిన cases మీద **88%** correct. Human కి పంపిన cases మీద అది **53.6%** మాత్రమే
correct అయ్యేది — అంటే **random గా abstain చేయట్లేదు**, నిజంగా కష్టమైన cases ని గుర్తిస్తోంది.

### Confusion Matrix
```
              predicted →
true ↓      T1    T2    T3    T4
  T1       444    32     0     0     ← ఒక్కటీ T3/T4 కి పడలేదు
  T2        51   163    52     0
  T3         0    31   315    38
  T4         0     0    53   321
```
Errors అన్నీ **adjacent tier** లోనే. Emergency నుంచి self-care కి ఎప్పుడూ jump కాలేదు.

---

## 7. 🎤 Judges అడిగే ప్రశ్నలు — Ready Answers

### Q1. "ఇది just ఒక booking form + database కదా?"
**జవాబు:** కాదు. Booking form లో constraints ఉండవు. మా దగ్గర —
- **Hard constraints:** cardiac T1 కి ALS-only, Rx gating, delivery radius
- **Competing objectives:** ETA vs capability vs load vs cost — ఒకేసారి balance చేస్తాం
- **Uncertainty:** ETA ఒక **range** (p50/p90), point estimate కాదు
- **Changing conditions:** traffic live గా మారుతుంది, ETA update అవుతుంది
- **Failures:** chaos panel — మీరే switch off చేసి చూడండి

*"Demo చూపిస్తాను — దగ్గరలో ఉన్న ambulance ని system reject చేస్తుంది, ఎందుకో కూడా చెప్తుంది."*

### Q2. "మీ AI disease diagnose చేస్తుందా?"
**జవాబు:** **లేదు.** Model output లో 4 tiers మాత్రమే — T1/T2/T3/T4. అవి *queues*, disease
names కాదు. Model label vocabulary లో ఒక్క condition name కూడా లేదు. `shared/enums.js` లో
చూడొచ్చు. Gemini prompt లో కూడా *"never diagnose"* అని ఉంది, **plus output మీద blocklist
post-filter** కూడా పెట్టాం.

### Q3. "AI fail అయితే ఏమవుతుంది?"
**జవాబు:** *"మీరే switch off చేసి చూడండి."* → Chaos panel → **Kill ML service** →
అదే request submit చేయండి. **1 millisecond లో** rule table నుంచి answer వస్తుంది, amber
badge తో *"reduced mode"* అని చూపిస్తుంది. **Silently guess చేయము.**

### Q4. "PyTorch ఎందుకు? Simple if-else rules సరిపోవా?"
**జవాబు:** మూడు కారణాలు —
1. **Calibrated confidence** — rules కి "నాకు 62% నమ్మకం" అని చెప్పడం రాదు
2. **Abstain gate** — ఆ confidence వల్లే *"ఇది మనిషికి పంపాలి"* అని decide చేయగలం
3. **Attribution** — leave-one-out తో ఏ fact ఎంత contribute చేసిందో చెప్పగలం

*మరియు* rule table ని కూడా రాశాం — అది మా **fallback**. రెండూ ఉన్నాయి.

### Q5. "Assignment కి ML ఎందుకు వాడలేదు?"
**జవాబు:** ఇది deliberate design decision.
> Dispatch decisions **auditable మరియు replayable** గా ఉండాలి. Learned ranker *"ఈ ambulance
> ఎందుకు?"* అని dispatcher కి explain చేయలేదు. మా cost function లో ప్రతి term visible —
> UI లో breakdown table చూపిస్తాం.

**Prediction = learned. Decision = deterministic.**

### Q6. "Scale ఎలా చేస్తారు? 10,000 ambulances ఉంటే?"
**జవాబు:** Candidate generation **indexed `$geoNear` top-K (K=12)**. Cost scoring ఆ 12 మీదే
జరుగుతుంది. అంటే **DB size పెరిగినా per-request cost పెరగదు** — O(K), O(n) కాదు.
Sharding key `zoneId` అవుతుంది. API stateless కాబట్టి horizontal scale అవుతుంది.

### Q7. "MongoDB ఎందుకు? SQL కాదు ఎందుకు?"
**జవాబు:** రెండు కారణాలు —
1. **`2dsphere` geospatial index** native గా ఉంది — మా hot path అదే
2. **ఒకే `resources` collection** — doctor, ambulance, pharmacy అన్నీ ఒకే shape.
   దీనివల్ల **matcher ఒక్కసారి రాసి మూడు చోట్ల వాడతాం**. Blood bank add చేయాలంటే ఒక
   constraint function + seed file చాలు, కొత్త code అక్కర్లేదు.

### Q8. "Data నిజమైనదా?"
**జవాబు:** **కాదు, 100% synthetic.** Event rules synthetic data allow చేస్తాయి. Training
data ఒక documented rule process + noise తో generate చేశాం — `ml-svc/train.py` లో ఉంది.
నిజమైన patient, doctor, hospital, address ఏదీ లేదు. **ఇది limitation గా మేమే చెప్తున్నాం.**

### Q9. "Human-in-the-loop ఎక్కడ ఉంది?"
**జవాబు:** మూడు చోట్ల, మరియు మూడూ **server లో enforce** అవుతాయి —
1. **Triage abstain** — confidence < 65% → dispatch **block** అవుతుంది (409 error)
2. **Tier override** — dispatcher confirm/change చేయగలడు, audit log లో పేరుతో record
3. **Pharmacist approval** — Rx-only/substituted items order కావాలంటే named pharmacist తప్పనిసరి

*"Button దాచడం access control కాదు"* — curl తో direct call చేసినా 403 వస్తుంది.

### Q10. "ETA రెండు నంబర్లు ఎందుకు?"
**జవాబు:** Point estimate అబద్ధం చెప్తుంది. మేము p50 (typical) + p90 (worst case) ఇస్తాం.
**మరియు అవి వేరే వేరే decisions కి వాడతాం:**
- T1/T2 → **p90** మీద rank (emergency లో worst case ముఖ్యం)
- T3/T4 → **p50** మీద rank (routine లో throughput ముఖ్యం)

ఒకే number, **రెండు risk postures**. ఇది genuine competing-objectives trade-off.

### Q11. "Security ఎలా handle చేశారు?"
**జవాబు:**
- Passwords: **scrypt** (memory-hard) + constant-time comparison
- Sessions: JWT, 12h expiry
- Roles: server-side middleware — UI మీద ఆధారపడము
- Secrets: `.env` gitignored, `.env.example` మాత్రమే commit
- Input: **Zod validation** ప్రతి endpoint మీద
- AI output: schema-constrained + blocklist post-filter

### Q12. "Limitations ఏమిటి?"
**జవాబు:** (ఇవి మనమే ముందు చెప్పడం better — rule 4 దీనికి marks ఇస్తుంది)
- Data synthetic; model **clinically validated కాదు**
- ETA analytical (real road network లేదు)
- Simulation 30× accelerated (screen మీద చూపిస్తున్నాం)
- Assignment greedy + urgency ordering — global optimum కాదు
- Handwriting OCR best-effort → అందుకే pharmacist gate పెట్టాం
- `partner-operator` rung documented, integration లేదు

### Q13. "Next steps ఏమిటి?"
**జవాబు:** Learned heteroscedastic ETA model · real traffic APIs · clinician-labelled
training data · Hungarian global assignment with preemption · ABDM/HMIS integration ·
fairness audit across age and language groups.

### Q14. "AI ఎక్కడెక్కడ వాడారు? Explain చేయగలరా?"
**జవాబు:** UI లోనే **"Where AI was used"** panel ఉంది — ప్రతి request కి.

| Purpose | Model | Human review point |
|---|---|---|
| Free-text → structured fields | Gemini (schema-constrained) | Fields visible + editable |
| Urgency tier | `urgency-mlp-v1` (PyTorch) | **Abstains below 65%** |
| Prescription reading | Gemini vision | Pharmacist must approve |
| Explanation | Template + Gemini translation | Blocklist post-filter |
| **Resource ranking** | **Model కాదు — deterministic cost function** | Dispatcher override |

ప్రతి AI call `auditLog` collection లో record అవుతుంది.

---

## 8. 🎬 5-నిమిషాల Demo Script

| # | ఏం చేయాలి | ఏం చెప్పాలి |
|---|---|---|
| 1 | Landing page చూపించండి | *"Every claim here, the running app can demonstrate."* |
| 2 | `/help` → `"chest pain and breathlessness for 30 minutes, he is 62"` | *"Any language. Gemini structures it, PyTorch scores it."* |
| 3 | Result — T1, confidence, 3 drivers | *"It shows why. And it never names a condition."* |
| 4 | Find ambulance → **"ruled out"** open చేయండి | ⭐ *"The nearest was rejected — it lacked ALS. Nearest is not nearest-suitable."* |
| 5 | Dispatch → live map, ETA range | *"p90 for emergencies. Worst case is what matters."* |
| 6 | Dispatcher → **Kill ML service** → అదే request | ⭐ *"Switch it off yourself. It still works — and says it's degraded."* |
| 7 | Low-confidence case → review queue → confirm | *"Below 65% it stops and asks a human. Dispatch is blocked until then."* |
| 8 | `/medicines` → photo → substitute → pharmacist approval | *"Nothing is ordered from the photo. A pharmacist signs off."* |
| 9 | Limitations చెప్పండి | *"Synthetic data, not clinically validated."* — **మనమే ముందు చెప్పడం** |

**⏱️ Timing:** Steps 1–5 లో 3 నిమిషాలు, 6–8 లో 90 సెకన్లు, step 9 లో 30 సెకన్లు.

---

## 9. Rubric Mapping (100 marks)

| Marks | Item | మన Evidence |
|---|---|---|
| 5 | Problem understanding | Access + tracking framing, no diagnosis, 3 documented ladders |
| 10 | Originality | Resource-agnostic matcher · p90 risk posture · chaos-proven resilience |
| 15 | Technical implementation | PyTorch (calibrated + abstain) · geo-indexed matching · 1 Hz sim · audit log · scrypt+JWT |
| 10 | Functioning MVP | Intake → triage → dispatch → medicines → live tracking, end to end |
| 5 | Problem-solving | Fallback ladders · substitutions · 5 degradation modes |
| 5 | Scalability | `$geoNear` top-K · one matcher for N kinds · stateless API · model versioning |
| 20 | UI/UX | Landing page · Emergency Mode · WCAG AA · keyboard nav · reduced-motion · degradation states |
| 30 | Communication | Demo script above · on-screen cost breakdowns · honest limitations |

---

## 10. ⚡ ఆఖరి నిమిషం Checklist

- [ ] `npm run seed:demo` — పాత data clear
- [ ] నాలుగు status dots **green**
- [ ] `GEMINI_MOCK=false` (real demo కి) — కానీ **quota 20/day** గుర్తుంచుకోండి
- [ ] `JWT_SECRET` set
- [ ] Dispatcher గా already sign in
- [ ] Chaos switches అన్నీ **OFF**
- [ ] Browser లో రెండు tabs — ఒకటి `/help`, ఒకటి `/dispatch`

---

## 11. మూడు వాక్యాలు — ఇవి మాత్రం మర్చిపోవద్దు

1. **"It assigns dispatch priority, not a diagnosis."**
2. **"When it isn't confident, it stops and asks a human — and dispatch is blocked until then."**
3. **"Break it yourself. It keeps working, and it tells you it's degraded."**

---

*Built for Engineering Day · Problem Statement P21 · Synthetic data only · Not a diagnostic system*
