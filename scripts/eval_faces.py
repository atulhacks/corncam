"""Compare face-forgery models on the held-out face set (scripts/build_face_eval.py).

Each model scores every face (max over detected faces). Reports AUC, false-alarm and miss rates at 0.5, and the
false-alarm rate at the threshold that catches 80% of fakes, so a model can't look good just by being trigger-happy.

Usage: uv run python scripts/eval_faces.py [data/face_eval] [--models clip,pe,df40] [--out data/eval/faces.json]
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

from corncam.ingest import load_item
from corncam.signals import face

MODELS = {
    "clip": lambda it: face.gend_faces(it, "clip"),
    "pe": lambda it: face.gend_faces(it, "pe"),
    "df40": face.df40_faces,
}


def metrics(y: np.ndarray, p: np.ndarray) -> dict:
    real, fake = p[y == 0], p[y == 1]
    t80 = float(np.quantile(fake, 0.2))  # threshold that still catches 80% of fakes
    return {
        "n": len(y), "auc": round(float(roc_auc_score(y, p)), 4),
        "false_alarm@0.5": round(float((real > 0.5).mean()), 4), "miss@0.5": round(float((fake <= 0.5).mean()), 4),
        "false_alarm@80%catch": round(float((real >= t80).mean()), 4),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("folder", nargs="?", default="data/face_eval", type=Path)
    ap.add_argument("--models", default="clip,pe,df40")
    ap.add_argument("--out", default="data/eval/faces.json")
    a = ap.parse_args()
    files = [(p, y) for d, y in (("real", 0), ("fake", 1)) for p in sorted((a.folder / d).glob("*")) if p.is_file()]
    report: dict = {"folder": str(a.folder), "models": {}}
    for name in a.models.split(","):
        rows, t0 = [], time.perf_counter()
        for p, y in files:
            s = MODELS[name](load_item(p))
            if s.score is not None:
                rows.append((p.name, y, float(s.score)))
        y = np.array([r[1] for r in rows])
        sc = np.array([r[2] for r in rows])
        m = metrics(y, sc) if len(set(y)) == 2 else {"n": len(rows)}
        m["no_face"] = len(files) - len(rows)
        m["seconds"] = round(time.perf_counter() - t0, 1)
        report["models"][name] = {**m, "rows": rows}
        print(name, {k: v for k, v in m.items()}, flush=True)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
