"""Platt calibration of the fused score, fitted on a tuning report and checked on a held-out report.

Why: detector sigmoids are not probabilities. The arena's expected-value rule ("call fake when
P(fake) >= 0.5") is only optimal if P(fake) is calibrated. Platt scaling (a 1-D logistic regression
on the logit of the score) is the scikit-learn recommendation for small sets (<< 1000 samples).
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Any

CALIBRATION_FILE = Path(__file__).with_name("calibration.json")
POINTS = {"tp": 5, "tn": 3, "fp": -5, "fn": -3}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def load(path: Path = CALIBRATION_FILE) -> dict[str, float] | None:
    if path.is_file():
        return json.loads(path.read_text())
    return None


# Heavily re-compressed images (chat forwards) are a separate domain: Smaug loses most of its signal there
# (held-out stress run, 28 Oct 2026: misses 14% -> 54%), so they get their own Platt fit, used only when present.
COMPRESSED_FILE = Path(__file__).with_name("calibration_compressed.json")
_STD_LUMA = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
             14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
             49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]


def jpeg_quality(path: Path) -> int | None:
    """Estimated libjpeg quality from the luminance quantisation table; None if not a JPEG."""
    from PIL import Image

    try:
        with Image.open(path) as im:
            if im.format != "JPEG" or not getattr(im, "quantization", None):
                return None
            table = im.quantization[0]
    except OSError:
        return None
    scale = 100 * sum(table) / sum(_STD_LUMA)
    return round((200 - scale) / 2 if scale <= 100 else 5000 / scale)


def is_compressed(path: Path) -> bool:
    """A chat-forward-like image: JPEG at quality <= 80 and long side <= 1024 px."""
    from PIL import Image

    q = jpeg_quality(path)
    if q is None or q > 80:
        return False
    with Image.open(path) as im:
        return max(im.size) <= 1024


def pool_prior() -> float | None:
    """Fake share of the arena pool, if known (env CORNCAM_FAKE_PRIOR, e.g. 0.7)."""
    raw = os.environ.get("CORNCAM_FAKE_PRIOR")
    if not raw:
        return None
    value = float(raw)
    if not 0 < value < 1:
        raise ValueError(f"CORNCAM_FAKE_PRIOR must be in (0, 1), got {raw}")
    return value


def apply(p: float, params: dict[str, float] | None, prior: float | None = None) -> float:
    """Calibrated P(fake). If the pool's fake share differs from the tuning set's, shift the
    intercept by logit(prior) - logit(train_prior) (standard prior-shift correction)."""
    if not params:
        return p
    z = params["a"] * _logit(p) + params["b"]
    if prior is not None:
        z += _logit(prior) - _logit(params.get("train_prior", 0.5))
    return 1 / (1 + math.exp(-z))


def _metrics(y: list[int], p: list[float]) -> dict[str, Any]:
    from sklearn.metrics import brier_score_loss, roc_auc_score

    pred = [int(x >= 0.5) for x in p]
    c = {"tp": 0, "tn": 0, "fp": 0, "fn": 0}
    for t, k in zip(y, pred, strict=True):
        c["tp" if t and k else "tn" if not t and not k else "fp" if k else "fn"] += 1
    return {
        "auc": round(roc_auc_score(y, p), 4), "brier": round(brier_score_loss(y, p), 4),
        "accuracy": round((c["tp"] + c["tn"]) / len(y), 4),
        "false_alarm_rate": round(c["fp"] / max(1, y.count(0)), 4),
        "miss_rate": round(c["fn"] / max(1, y.count(1)), 4),
        "game_points": sum(POINTS[k] * v for k, v in c.items()), "confusion": c,
    }


def fit(tune_report: str, validate_report: str, write: bool = True) -> dict[str, Any]:
    from sklearn.linear_model import LogisticRegression

    tune = json.loads(Path(tune_report).read_text())["rows"]
    val = json.loads(Path(validate_report).read_text())["rows"]
    held_out = {r["file"] for r in val}
    tune = [r for r in tune if r["file"] not in held_out]  # no leakage between tuning and validation

    x = [[_logit(r.get("p_raw", r["p_fake"]))] for r in tune]
    y = [r["y"] for r in tune]
    lr = LogisticRegression(C=1e6).fit(x, y)  # effectively unregularised Platt scaling
    params = {"a": float(lr.coef_[0][0]), "b": float(lr.intercept_[0]), "n_tune": len(tune),
              "train_prior": round(sum(y) / len(y), 4), "source": Path(tune_report).name}

    vy = [r["y"] for r in val]
    before = _metrics(vy, [r.get("p_raw", r["p_fake"]) for r in val])
    after = _metrics(vy, [apply(r.get("p_raw", r["p_fake"]), params) for r in val])
    if write:
        CALIBRATION_FILE.write_text(json.dumps(params, indent=2))
    return {"params": params, "validation_before": before, "validation_after": after}
