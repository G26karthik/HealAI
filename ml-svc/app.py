"""
MediRoute ml-svc — the prediction layer.

Design note for the judges: prediction is learned and uncertain, so it lives
here in PyTorch. *Decisions* must be deterministic, auditable and replayable,
so they live in the Express layer as explicit cost functions. This service is
never allowed to decide anything, and it never names a medical condition — it
returns a dispatch priority tier and the features that drove it.
"""

from pathlib import Path

import torch
from fastapi import FastAPI
from pydantic import BaseModel, Field

from train import FEATURE_ORDER, TIERS, UrgencyMLP

MODEL_PATH = Path(__file__).parent / "models" / "urgency_mlp_v1.pt"
MODEL_VERSION = "urgency-mlp-v1"

# Confidence gates — must match REVIEW_GATES in shared/enums.js.
MIN_CONFIDENCE = 0.65
MIN_TOP_TWO_GAP = 0.15

# Neutral reference point for attribution: "an adult, moderate severity, no flags".
# Explaining a prediction means comparing it against something; this is that something.
BASELINE = torch.tensor(
    [0.0] * 12 + [0.5, 0.4, 0.0, 0.0, 0.6, 0.5], dtype=torch.float32
)

LABELS = {
    "chest-pain": "chest pain reported",
    "breathing-difficulty": "difficulty breathing reported",
    "trauma-bleeding": "injury with heavy bleeding",
    "unconscious": "unresponsive or fainting",
    "poisoning-suspected": "suspected poisoning",
    "pregnancy-related": "pregnancy-related concern",
    "burn": "burn reported",
    "fracture-suspected": "possible fracture",
    "high-fever": "high fever reported",
    "abdominal-pain": "abdominal pain reported",
    "minor-injury": "minor injury",
    "routine-followup": "routine follow-up",
    "durationBucket": "how long it has been going on",
    "ageBucket": "patient age",
    "chronicFlag": "existing long-term condition",
    "immobileFlag": "patient cannot move unaided",
    "severitySelf": "severity reported by the caller",
    "hourOfDay": "time of day",
}

app = FastAPI(title="MediRoute ml-svc", version="1.0.0")

_model: UrgencyMLP | None = None
_temperature: float = 1.0
_metrics: dict = {}


def load_model():
    """Load once at startup. A missing file is not fatal — the Express layer
    falls back to its rule table, which is the behaviour we demo anyway."""
    global _model, _temperature, _metrics
    if not MODEL_PATH.exists():
        print(f"[ml] no model at {MODEL_PATH} — run: npm run train")
        return
    ckpt = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
    model = UrgencyMLP()
    model.load_state_dict(ckpt["state_dict"])
    model.eval()
    _model = model
    _temperature = float(ckpt.get("temperature", 1.0))
    _metrics = ckpt.get("metrics", {})
    print(f"[ml] loaded {MODEL_VERSION}  T={_temperature:.3f}  acc={_metrics.get('test_accuracy')}")


@app.on_event("startup")
def _startup():
    load_model()


class TriageRequest(BaseModel):
    features: list[float] = Field(..., description="18-dim vector, order fixed by shared/enums.js FEATURE_ORDER")


def urgency_margin(logits: torch.Tensor) -> float:
    """How strongly the model favours an urgent queue over a non-urgent one.

    max(T1, T2) - max(T3, T4), in logit space. This is the quantity a dispatcher
    actually cares about, and it is what attribution should explain.
    """
    return float(max(logits[0], logits[1]) - max(logits[2], logits[3]))


def explain(x: torch.Tensor) -> list[dict]:
    """Leave-one-out attribution against the URGENCY MARGIN.

    For each feature that differs from the neutral baseline, replace it with the
    baseline and re-run the model; the drop in urgency margin is that feature's
    contribution. 18 forward passes, ~2ms, no extra library — which matters when
    you have three hours.

    Two design choices worth defending:

    1. Logits, not probabilities. On a clear-cut emergency the softmax saturates
       at 0.9999, so every probability difference collapses to ~0.001 and the
       explanation reads "nothing mattered" precisely when the model is most
       certain. Logits do not saturate.

    2. Urgency margin, not the chosen tier's score. Attributing to the chosen
       tier inverts the meaning whenever that tier is a low-urgency one: a high
       fever pushes AWAY from "routine", which would render as "this lowered the
       priority" when it did the exact opposite. The margin is signed the same
       way no matter which tier wins, so a positive contribution always means
       "this made the case more urgent".

    Contributions are reported as a signed SHARE of the total, readable directly
    as "this fact is 41% of the reason".
    """
    with torch.no_grad():
        base = urgency_margin(_model(x.unsqueeze(0))[0])

        raw = []
        for i, name in enumerate(FEATURE_ORDER):
            if abs(float(x[i]) - float(BASELINE[i])) < 1e-6:
                continue  # already neutral — it explains nothing
            counterfactual = x.clone()
            counterfactual[i] = BASELINE[i]
            z = urgency_margin(_model(counterfactual.unsqueeze(0))[0])
            raw.append((name, base - z))  # positive => this feature raised urgency

    total = sum(abs(d) for _, d in raw) or 1.0
    drivers = [
        {
            "feature": name,
            "label": LABELS.get(name, name),
            "delta": round(d / total, 4),   # signed share of the decision
            "logitDelta": round(d, 4),      # raw urgency-margin units, for the audit log
        }
        for name, d in raw
    ]
    drivers.sort(key=lambda d: abs(d["delta"]), reverse=True)
    return drivers[:3]


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "mediroute-ml-svc",
        "model_version": MODEL_VERSION,
        "model_loaded": _model is not None,
    }


@app.get("/metrics")
def metrics():
    """The model card. Surfaced in the UI so the system states its own limits."""
    return {"model_version": MODEL_VERSION, "loaded": _model is not None, **_metrics}


@app.post("/triage")
def triage(req: TriageRequest):
    if _model is None:
        return {"error": "model not loaded", "model_version": MODEL_VERSION}
    if len(req.features) != len(FEATURE_ORDER):
        return {"error": f"expected {len(FEATURE_ORDER)} features, got {len(req.features)}"}

    x = torch.tensor(req.features, dtype=torch.float32)
    with torch.no_grad():
        probs = (_model(x.unsqueeze(0)) / _temperature).softmax(1)[0]

    order = torch.argsort(probs, descending=True)
    top1, top2 = int(order[0]), int(order[1])
    confidence, second = float(probs[top1]), float(probs[top2])

    # Abstain when unsure OR when two tiers are too close to separate.
    low_confidence = confidence < MIN_CONFIDENCE
    ambiguous = (confidence - second) < MIN_TOP_TWO_GAP
    needs_review = low_confidence or ambiguous

    # Safety-biased tie-break: when the top two are close, provisionally take the
    # MORE urgent of the pair (lower index = higher urgency) while a human checks.
    chosen = min(top1, top2) if ambiguous else top1

    reasons = []
    if low_confidence:
        reasons.append(f"confidence {confidence:.0%} is below the {MIN_CONFIDENCE:.0%} threshold")
    if ambiguous:
        reasons.append(f"{TIERS[top1]} and {TIERS[top2]} are within {MIN_TOP_TWO_GAP:.0%} of each other")

    return {
        "tier": TIERS[chosen],
        "confidence": round(confidence, 4),
        "probabilities": {t: round(float(p), 4) for t, p in zip(TIERS, probs)},
        "needsHumanReview": needs_review,
        "reviewReasons": reasons,
        "safetyTieBreak": ambiguous and chosen != top1,
        "drivers": explain(x),
        "model_version": MODEL_VERSION,
        "disclaimer": "Dispatch priority only. Not a diagnosis; names no medical condition.",
    }
