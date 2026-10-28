"""Evaluate the Detective on a labelled parquet set (e.g. OpenFakeTiny reddit/test).

Reports what matters for the game: false-alarm rate on real items (costs -5 each), miss rate on
fakes (-3 each), accuracy at our 0.5 threshold, AUC, Brier score (calibration, as NIST GenAI uses),
and seconds per item. Images are materialised under data/eval/ (gitignored) because detectors and
provenance read real files.
"""

from __future__ import annotations

import json
import random
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from corncam.detect import detect

GAME_POINTS = {"tp": 5, "tn": 3, "fp": -5, "fn": -3}  # catch fake / clear real / false alarm / miss


def sample_parquet(parquet: Path, n_per_class: int, seed: int, out_dir: Path) -> list[tuple[Path, int, str]]:
    import pyarrow.parquet as pq

    table = pq.read_table(parquet, columns=["label", "model"])
    labels = table.column("label").to_pylist()
    models = table.column("model").to_pylist()
    # label may be int (0/1) or string ("real"/"fake"); normalise to 1 = fake
    is_fake = [int(str(lab).lower() in {"1", "fake", "ai", "synthetic"}) for lab in labels]
    rng = random.Random(seed)
    idx_by_class = defaultdict(list)
    for i, y in enumerate(is_fake):
        idx_by_class[y].append(i)
    chosen = sorted(i for y in (0, 1) for i in rng.sample(idx_by_class[y], min(n_per_class, len(idx_by_class[y]))))

    images = pq.read_table(parquet, columns=["image"]).column("image").take(chosen).to_pylist()
    out_dir.mkdir(parents=True, exist_ok=True)
    items = []
    for i, img in zip(chosen, images, strict=True):
        raw = img["bytes"] if isinstance(img, dict) else img
        ext = Path(img.get("path") or "x.jpg").suffix if isinstance(img, dict) else ".jpg"
        p = out_dir / f"{i:05d}_{'fake' if is_fake[i] else 'real'}{ext or '.jpg'}"
        p.write_bytes(raw)
        items.append((p, is_fake[i], str(models[i])))
    return items


def evaluate(items: list[tuple[Path, int, str]]) -> dict[str, Any]:
    from sklearn.metrics import brier_score_loss, roc_auc_score

    rows = []
    for path, y, model in items:
        t0 = time.perf_counter()
        v = detect(path, use_cache=False)  # a benchmark measures the current code, never stored results
        rows.append({"file": path.name, "y": y, "model": model, "p_fake": v.p_fake, "p_raw": v.p_raw, "label": v.label,
                     "tier": str(v.tier), "reason_code": v.reason_code, "seconds": time.perf_counter() - t0})
    y = [r["y"] for r in rows]
    p = [r["p_fake"] for r in rows]
    pred = [int(r["label"] == "fake") for r in rows]
    tp = sum(a and b for a, b in zip(y, pred, strict=True))
    tn = sum((not a) and (not b) for a, b in zip(y, pred, strict=True))
    fp = sum((not a) and b for a, b in zip(y, pred, strict=True))
    fn = sum(a and (not b) for a, b in zip(y, pred, strict=True))
    n_real, n_fake = y.count(0), y.count(1)
    secs = sorted(r["seconds"] for r in rows)
    return {
        "n": len(rows), "n_real": n_real, "n_fake": n_fake,
        "auc": round(roc_auc_score(y, p), 4) if 0 < n_fake < len(y) else None,
        "accuracy": round((tp + tn) / len(y), 4),
        "false_alarm_rate": round(fp / n_real, 4) if n_real else None,
        "miss_rate": round(fn / n_fake, 4) if n_fake else None,
        "brier": round(brier_score_loss(y, p), 4),
        "game_points": tp * GAME_POINTS["tp"] + tn * GAME_POINTS["tn"] + fp * GAME_POINTS["fp"] + fn * GAME_POINTS["fn"],
        "seconds_median": round(secs[len(secs) // 2], 3),
        "seconds_first": round(rows[0]["seconds"], 3),  # includes model load
        "confusion": {"tp": tp, "tn": tn, "fp": fp, "fn": fn},
        "rows": rows,
    }


def run(parquet: str, n_per_class: int = 25, seed: int = 0, out: str = "data/eval/report.json") -> dict[str, Any]:
    pq_path = Path(parquet)
    items = sample_parquet(pq_path, n_per_class, seed, Path("data/eval") / pq_path.stem)
    report = evaluate(items)
    report["dataset"] = str(pq_path)
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(report, indent=2))
    return report


def folder_items(folder: Path) -> list[tuple[Path, int, str]]:
    """Labelled items from <folder>/real/** and <folder>/fake/**; the generator is the filename prefix."""
    items = []
    for label_dir, y in (("real", 0), ("fake", 1)):
        for path in sorted((folder / label_dir).rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                items.append((path, y, path.name.split("_")[0] if y else "real"))
    return items


def run_folder(folder: str, out: str) -> dict[str, Any]:
    items = folder_items(Path(folder))
    if not items:
        raise FileNotFoundError(f"no files under {folder}/real or {folder}/fake")
    report = evaluate(items)
    report["dataset"] = folder
    by_model: dict[str, list[int]] = defaultdict(list)
    for r in report["rows"]:
        by_model[r["model"]].append(int((r["label"] == "fake") == bool(r["y"])))
    report["accuracy_by_source"] = {m: round(sum(v) / len(v), 3) for m, v in sorted(by_model.items())}
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(report, indent=2))
    return report
