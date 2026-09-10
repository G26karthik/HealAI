# HealAI — తెలుగు గైడ్ 🚑

మన టీమ్‌లో కొత్తగా వచ్చిన వాళ్ళ కోసం. **యాప్‌లో ప్రతి ఫీచర్ ఎలా వాడాలో** ఇక్కడ సింపుల్‌గా ఉంది.

> English setup instructions: [`README.md`](README.md) · Operating guide: [`RUNBOOK.md`](RUNBOOK.md)

---

## 1. మన యాప్ ఏం చేస్తుంది?

ఒక పేషెంట్ **తనకి ఏమైందో తన మాటల్లో** చెప్తాడు. HealAI ఆ సమస్య **ఎంత అర్జెంట్** అనేది
నిర్ణయిస్తుంది, తర్వాత **సరైన ambulance, doctor లేదా pharmacy** ని వెతికి, అది వచ్చే వరకు
**live track** చేస్తుంది.

**చాలా ముఖ్యమైన విషయం:** మన యాప్ **రోగ నిర్ధారణ (diagnosis) చేయదు.** ఏ జబ్బు అని ఎప్పుడూ
చెప్పదు. కేవలం *"ఎంత తొందరగా, ఎవరి దగ్గరకు పంపాలి"* అనేది మాత్రమే నిర్ణయిస్తుంది. ఇది
event rules లో ఉన్న నియమం — ఎవరైనా అడిగితే ఇదే చెప్పండి.

---

## 2. యాప్ స్టార్ట్ చేయడం

VS Code లో terminal ఓపెన్ చేసి (**Ctrl + `**), ఈ కమాండ్ టైప్ చేయండి:

```powershell
npm run dev
```

మూడు services ఒకేసారి స్టార్ట్ అవుతాయి. ఈ మూడు లైన్లు కనిపించే వరకు వెయిట్ చేయండి:

```
[ml]   Uvicorn running on http://127.0.0.1:8000
[api]  http://localhost:5000
[web]  ➜  Local:   http://localhost:5173/
```

తర్వాత browser లో **<http://localhost:5173>** ఓపెన్ చేయండి.

కుడి పైన **నాలుగు ఆకుపచ్చ (green) చుక్కలు** కనిపిస్తే అంతా బాగా పని చేస్తోంది అని అర్థం.

ఆపడానికి terminal లో **Ctrl + C** నొక్కండి.

> మొదటిసారి అయితే ముందు `npm run setup`, తర్వాత `npm run train`, ఆ తర్వాత `npm run seed`
> ఒకసారి రన్ చేయాలి. వివరాలు [`README.md`](README.md) లో ఉన్నాయి.

---

## 3. ఫీచర్ 1 — హోమ్ పేజీ (Landing Page)

**ఎక్కడ:** <http://localhost:5173>

మన యాప్ ఏం చేస్తుందో వివరించే మొదటి పేజీ. ఇక్కడ:

- **8 feature cards** ఉంటాయి. ప్రతి దాని మీద **"How it works →"** నొక్కితే, లోపల technical
  వివరణ కనిపిస్తుంది.
- పైన **System status** బార్ ఉంటుంది — ఇది నిజంగా server నుంచి live గా వస్తుంది, ఊరికే
  డిజైన్ కోసం పెట్టినది కాదు.

**టిప్:** జడ్జెస్‌కి చూపించేటప్పుడు ఈ పేజీతో మొదలుపెట్టండి. 30 సెకన్లలో మొత్తం అర్థమవుతుంది.

---

## 4. ఫీచర్ 2 — సైన్ ఇన్ (Login)

**ఎక్కడ:** <http://localhost:5173/login>

మూడు రకాల accounts ఉన్నాయి. **password అవసరం లేదు** — ఒక్క క్లిక్ చాలు:

| రోల్ | ఏం చేయగలరు |
|---|---|
| 🙋 **Patient** | సహాయం అడగడం, track చేయడం |
| 🎛️ **Dispatcher** | Priority confirm చేయడం, override చేయడం, Chaos panel వాడడం |
| 💊 **Pharmacist** | Prescription items approve చేయడం |

**ముఖ్యం:** సహాయం అడగడానికి **account అవసరం లేదు**. ఎమర్జెన్సీలో ఉన్న మనిషిని
sign-up పేజీ దగ్గర ఆపకూడదు — అందుకే ఆ దారి open గా ఉంచాం.

కానీ **Dispatcher పనులు** (chaos panel, override) చేయాలంటే మాత్రం dispatcher గా
sign in అవ్వాలి. ఇది **server లో check అవుతుంది**, కేవలం button దాచడం కాదు.

---

## 5. ఫీచర్ 3 — సహాయం అడగడం (Get Help)

**ఎక్కడ:** <http://localhost:5173/help>

### ఎలా వాడాలి

1. **సమస్యను టైప్ చేయండి** — ఏ భాషలోనైనా రాయొచ్చు. తెలుగు, హిందీ, ఇంగ్లీష్ అన్నీ పని చేస్తాయి.
   ఉదాహరణ: `ఛాతీలో నొప్పి, ఊపిరి ఆడటం లేదు, 30 నిమిషాల నుంచి, వయసు 62`
2. కావాలంటే **Details** లో వయసు, ఎంతసేపటి నుంచి, ఎంత తీవ్రంగా ఉంది అని పెట్టండి.
3. **"Get help now"** బటన్ నొక్కండి.

### ఏం జరుగుతుంది

| దశ | ఏం జరుగుతుంది |
|---|---|
| 1 | **Gemini AI** మీ వాక్యాన్ని చదివి, structured facts గా మారుస్తుంది |
| 2 | **PyTorch model** ఆ facts చూసి urgency tier నిర్ణయిస్తుంది |
| 3 | Result screen లో tier, confidence %, మరియు **ఎందుకు అలా నిర్ణయించిందో** కారణాలు కనిపిస్తాయి |

### నాలుగు Tiers

| Tier | అర్థం | ఎవరి దగ్గరకు |
|---|---|---|
| 🔴 **T1** | Emergency — వెంటనే | Ambulance (10 నిమిషాల్లో) |
| 🟠 **T2** | ఈరోజే చూడాలి | Doctor (2 గంటల్లో) |
| 🔵 **T3** | మామూలు appointment | Doctor (24 గంటల్లో) |
| 🟢 **T4** | Pharmacy / self-care | Medicines |

### "A human is reviewing this" అని వస్తే?

Model కి **65% కంటే తక్కువ confidence** ఉంటే, అది **తనంతట తానుగా నిర్ణయం తీసుకోదు**.
మనిషి దగ్గరకు పంపిస్తుంది.

**ఇది bug కాదు — ఇదే మన యాప్ లో ఉత్తమమైన feature.** AI కి తెలియనప్పుడు "నాకు తెలియదు"
అని ఒప్పుకుని మనిషిని అడగడం, తప్పుగా guess చేయడం కంటే మంచిది. Judges కి ఇది తప్పకుండా
చూపించండి.

అలాంటప్పుడు **Dispatcher** tab కి వెళ్ళి confirm చేయాలి. అప్పుడే ambulance పంపగలం.

---

## 6. ఫీచర్ 4 — Ambulance / Doctor బుక్ చేయడం

Triage result వచ్చాక **"Find an ambulance"** (లేదా "Find a doctor") నొక్కండి.

### జాబితాలో ఏం కనిపిస్తుంది

- ప్రతి ambulance/doctor కి **ETA** — `5–8 min` లాగా **రెండు నంబర్లు** ఉంటాయి
- **"Why this one?"** నొక్కితే, cost breakdown table కనిపిస్తుంది

### ⭐ Judges కి తప్పకుండా చూపించాల్సిన విషయం

కింద **"N ruled out — including closer ones"** అని ఉంటుంది. అది ఓపెన్ చేయండి.

అక్కడ ఇలా కనిపిస్తుంది:

```
BLS-02 · 1.2 km   →  advanced life support required
```

అంటే — **దగ్గరలో ఉన్న ambulance ని వదిలేసి, కొంచెం దూరంలో ఉన్నదాన్ని పంపాం.** ఎందుకంటే
గుండె సమస్యకు **ALS (Advanced Life Support)** ambulance కావాలి, మామూలుది సరిపోదు.

*"దగ్గరిది కాదు — సరైనది"* — ఇదే మన project యొక్క ముఖ్యమైన idea.

### ETA రెండు నంబర్లు ఎందుకు?

- **5 min (p50)** = సాధారణంగా ఇంత టైం పడుతుంది
- **8 min (p90)** = 90% సందర్భాల్లో ఇంతకంటే ఎక్కువ కాదు

**Emergency (T1, T2)** లో మనం **p90** చూసి నిర్ణయిస్తాం — ఎందుకంటే ఎమర్జెన్సీలో
*"worst case ఎంత"* అనేది ముఖ్యం.
**Routine (T3, T4)** లో **p50** చూస్తాం — ఎందుకంటే అక్కడ *throughput* ముఖ్యం.

---

## 7. ఫీచర్ 5 — Live Tracking (మ్యాప్)

Ambulance book చేసిన వెంటనే **live map** కనిపిస్తుంది.

- Ambulance **నిజంగా కదులుతుంది** (ప్రతి సెకనుకు update)
- Traffic మారితే **ETA కూడా మారుతుంది**, మరియు **ఎందుకు మారిందో చెప్తుంది**:
  > *"Arrival window widened — traffic in Z3 is now ×2.9"*

### ⏱️ Simulation speed

Ambulance **30× వేగంగా** కదులుతుంది. అంటే 15 నిమిషాల ప్రయాణం 30 సెకన్లలో అయిపోతుంది.

ఇది demo కోసం. **దాచడం లేదు** — screen మీద *"simulation 30× real time"* అని రాసి ఉంటుంది.
ఎవరైనా అడిగితే నిజం చెప్పండి: *"demo కోసం accelerated clock, screen మీద చూపిస్తున్నాం."*

---

## 8. ఫీచర్ 6 — Prescription ఫోటో (మందులు) 💊

**ఎక్కడ:** <http://localhost:5173/medicines>

### ఎలా వాడాలి

1. **"Choose a photo"** నొక్కి prescription ఫోటో పెట్టండి
2. AI అందులోని **మందుల పేర్లు చదువుతుంది**
3. ప్రతి మందు పక్కన **confidence %** కనిపిస్తుంది
4. **"Find pharmacies"** నొక్కండి
5. Pharmacist పేరు రాసి **"Place order"** నొక్కండి

### ⭐ ఇక్కడ చూపించాల్సిన మూడు విషయాలు

**1. Prescription-only మందులు flag అవుతాయి**
`prescription-only` అని tag ఉన్న మందులకు **pharmacist approval తప్పనిసరి**. పేరు రాయకపోతే
order వెళ్ళదు — ఇది **server లో block అవుతుంది**, screen లో మాత్రమే కాదు.

**2. Stock లేకపోతే — equivalent medicine**
ఒక మందు లేకపోతే, **అదే salt, అదే strength** ఉన్న వేరే మందు సూచిస్తుంది:
```
Telma 40  →  Telmisartan 40   (same salt, same strength)
```

**3. ఏ మందూ AI నుంచి నేరుగా రాదు**
AI చదివిన పేరును **మన catalogue తో match** చేస్తాం. AI ఏదైనా తప్పు పేరు చెప్తే, అది మన
list లో ఉండదు కాబట్టి order అవ్వదు. ఇది safety కోసం.

---

## 9. ఫీచర్ 7 — Dispatcher Console

**ఎక్కడ:** <http://localhost:5173/dispatch>
**ముందు dispatcher గా sign in అవ్వండి.**

ఇక్కడ ఏం ఉంటుంది:

| భాగం | ఏం చేస్తుంది |
|---|---|
| **KPI cards** | మొత్తం requests, review కోసం ఎదురుచూస్తున్నవి, fallback వాడినవి |
| **Live map** | అన్ని ambulances, patients, traffic zones |
| **Dispatch queue** | Urgency ప్రకారం sort అయిన list |
| **Review** | AI కి doubt వచ్చిన cases — ఇక్కడ మనిషి confirm చేస్తాడు |
| **Chaos panel** | System ని కావాలని పాడు చేయడానికి 🔥 |

### Review ఎలా చేయాలి

పసుపు రంగులో ఉన్న request దగ్గర:
- **"Confirm T1"** — AI చెప్పింది సరైనదే అనుకుంటే
- **"Change to T2"** — మీరు వేరేగా అనుకుంటే

రెండూ **audit log లో మీ పేరుతో record అవుతాయి**.

---

## 10. ఫీచర్ 8 — Chaos Panel 🔥 (అత్యంత ముఖ్యం)

Dispatcher page లో కుడి వైపు ఉంటుంది. ఐదు switches:

| Switch | ఏం పాడవుతుంది | యాప్ ఏం చేస్తుంది |
|---|---|---|
| **Kill Gemini** | భాష అర్థం చేసుకోవడం | Keyword reader వాడుతుంది |
| **Kill ML service** | AI model | Simple rules వాడుతుంది |
| **Traffic spike** | Zone 3 లో ట్రాఫిక్ | ETA పెరుగుతుంది |
| **Ambulance offline** | ఒక vehicle | తర్వాతి option వెతుకుతుంది |
| **Pharmacy stockout** | ఒక pharmacy stock | Substitute సూచిస్తుంది |

### ఇది ఎందుకు ముఖ్యం?

Event rules లో **"fallback providers and error states"** అని స్పష్టంగా రాసి ఉంది.

చాలా టీమ్‌లు *"మా system errors handle చేస్తుంది"* అని **చెప్తారు**. మనం జడ్జ్ చేతికే
switch ఇచ్చి, **వాళ్ళ ముందే పాడు చేయిస్తాం** — అయినా యాప్ పని చేస్తూనే ఉంటుంది, మరియు
*"ఇప్పుడు నేను reduced mode లో ఉన్నాను"* అని openly చెప్తుంది.

### Demo లో ఇలా చేయండి

1. Dispatcher గా sign in అవ్వండి
2. **"Kill ML service"** ON చేయండి
3. `/help` కి వెళ్ళి అదే chest pain వాక్యం మళ్ళీ టైప్ చేయండి
4. **అది ఇప్పటికీ పని చేస్తుంది** — కానీ పసుపు రంగు banner తో *"reduced mode"* అని చూపిస్తుంది

---

## 11. ఏదైనా సమస్య వస్తే

| ఏం కనిపిస్తుంది | ఏం చేయాలి |
|---|---|
| నాలుగు చుక్కలు green కాదు | Terminal లో `[api]`, `[web]`, `[ml]` — ఏ tag దగ్గర error ఉందో చూడండి |
| `port 5000 already in use` | వేరే terminal లో యాప్ రన్ అవుతోంది. అక్కడ `Ctrl + C` నొక్కండి |
| పదే పదే sign out అవుతోంది | `server/.env` లో `JWT_SECRET` లేదు |
| `Sign in to do that` | Login చేయాలి — `/login` కి వెళ్ళండి |
| `This action is for dispatcher accounts` | Patient గా ఉన్నారు. Sign out చేసి **Dispatcher** ఎంచుకోండి |
| Map ఖాళీగా ఉంది | `npm run seed` రన్ చేయండి |
| `git pull` తర్వాత పని చేయట్లేదు | `npm run setup` మళ్ళీ రన్ చేయండి |

**గుర్తుంచుకోండి:** terminal లో ఉన్న రంగు tag ఏ భాగం లో problem ఉందో చెప్తుంది —
`[api]` = backend, `[web]` = website, `[ml]` = AI model.

---

## 12. ⚠️ Gemini quota — జాగ్రత్త

Gemini free tier లో **రోజుకి 20 requests మాత్రమే**. Practice చేస్తూ ఉంటే అది అయిపోతుంది.

**Practice చేసేటప్పుడు** `server/.env` లో ఇలా పెట్టండి:

```
GEMINI_MOCK=true
```

అప్పుడు Gemini ని పిలవదు, built-in sample answers వాడుతుంది. **అసలు demo కి ముందు మాత్రం
తిరిగి `false` చేయండి.**

---

## 13. Demo కి ముందు checklist ✅

- [ ] `npm run seed:demo` రన్ చేశారా? (పాత requests clear అవుతాయి)
- [ ] నాలుగు చుక్కలూ green ఉన్నాయా?
- [ ] `GEMINI_MOCK=false` ఉందా?
- [ ] `JWT_SECRET` set చేశారా?
- [ ] Dispatcher గా sign in అయ్యారా?
- [ ] Chaos panel అన్నీ OFF లో ఉన్నాయా?

---

## 14. ఎప్పుడూ మర్చిపోకూడని మూడు వాక్యాలు

1. **"మన యాప్ diagnosis చేయదు."** — ఎంత అర్జెంట్ అనేది మాత్రమే చెప్తుంది, ఏ జబ్బో చెప్పదు.
2. **"AI కి doubt వస్తే మనిషిని అడుగుతుంది."** — 65% కంటే తక్కువ confidence ఉంటే ఆగిపోతుంది.
3. **"ఏదైనా పాడైనా యాప్ పని చేస్తుంది — మరియు పాడైందని చెప్తుంది."** — ఎప్పుడూ silently guess చేయదు.

---

**మొత్తం data synthetic (కల్పితం).** నిజమైన patient, doctor, hospital ఎవరూ లేరు.
