"""Post-game report: score our Evidence Pool verdicts against the organisers' answer key.

The brief asks for "which fakes slipped through, why, and how to improve". Everything here is computed from
stored verdicts and the key; nothing is re-run. Reason points (+3) are judged by the organisers, so they are
reported as pending rather than guessed.
"""

from __future__ import annotations

import csv
import io
import math
from typing import Any

POINTS = {"caught": 5, "cleared": 3, "false_alarm": -5, "missed": -3}
_ID_COLS = ("sha256", "sha", "item", "filename", "file", "name", "id")
_LABEL_COLS = ("label", "truth", "answer", "ground_truth", "is_fake", "fake")
_FAKE = {"fake", "1", "true", "yes", "ai", "synthetic", "generated", "deepfake"}
_REAL = {"real", "0", "false", "no", "authentic", "genuine", "human"}


class KeyError_(ValueError):
    """The answer key could not be read."""


def parse_key(text: str) -> list[dict[str, str]]:
    """CSV with an id column (sha256 or file name) and a label column (fake/real or 1/0). Extra columns kept."""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames:
        raise KeyError_("The answer key is empty.")
    cols = {c.strip().lower(): c for c in reader.fieldnames}
    id_col = next((cols[c] for c in _ID_COLS if c in cols), None)
    label_col = next((cols[c] for c in _LABEL_COLS if c in cols), None)
    if not id_col or not label_col:
        raise KeyError_(f"Need an id column ({', '.join(_ID_COLS)}) and a label column ({', '.join(_LABEL_COLS)}); "
                        f"found {', '.join(reader.fieldnames)}.")
    rows = []
    for r in reader:
        raw = (r.get(label_col) or "").strip().lower()
        if raw not in _FAKE | _REAL:
            raise KeyError_(f"Unknown label {raw!r} for {r.get(id_col)!r}; use fake/real or 1/0.")
        extra = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k not in (id_col, label_col)}
        rows.append({"id": (r.get(id_col) or "").strip(), "truth": "fake" if raw in _FAKE else "real", **extra})
    return rows


def _outcome(truth: str, call: str) -> str:
    if truth == "fake":
        return "caught" if call == "fake" else "missed"
    return "cleared" if call == "real" else "false_alarm"


def _why(v: dict[str, Any], outcome: str) -> tuple[str, str]:
    """(why it happened, how to improve), from the verdict's own signals."""
    sig = {s["name"]: s for s in v.get("signals", [])}
    scored = [s for s in v.get("signals", []) if s.get("score") is not None]
    media = v.get("media_type")
    if outcome == "missed":
        df40, gend = sig.get("DF40 face-forgery detector"), sig.get("GenD face-forgery detector")
        if df40 and gend and (df40.get("score") or 0) > 0.5 >= (gend.get("score") or 0):
            return ((f"Face swap: the trusted face model (GenD) scored {gend['score']:.0%}, while the advisory DF40 "
                    f"model flagged it at {df40['score']:.0%} but does not vote."),
                    "Fine-tune the face branch on arena-style swaps (InSwapper/FaceFusion) so a trusted model catches them.")
        if v.get("experimental"):
            return (f"{str(media).capitalize()} is only partly covered by our detectors, so the call stayed cautious.",
                    f"Add and measure a dedicated {media} detector before trusting {media} verdicts.")
        if not scored:
            return ("No detector had usable evidence (no face, no speech, no metadata).",
                    "Add a detector for this content type; an empty verdict defaults to real.")
        top = max(scored, key=lambda s: s["score"])
        return (f"Every detector scored low; the most suspicious was {top['name']} at {top['score']:.0%}.",
                "Add this item's generator to self-play training; consider a second, decorrelated whole-image model.")
    if outcome == "false_alarm":
        p_raw = v.get("p_raw")
        if p_raw is not None and p_raw <= 0.5 < v["p_fake"]:
            return ((f"The detectors leaned real (fused score {p_raw:.0%}), but calibration moved it to "
                    f"{v['p_fake']:.0%} fake."),
                    ("Refit calibration with more real items like this one, or set CORNCAM_FAKE_PRIOR to the pool's "
                    "real fake share."))
        scored = [s for s in scored if s.get("policy") != "ignore"]
        top = max(scored, key=lambda s: s["score"]) if scored else None
        if not top:
            return "Called fake without detector evidence.", "Check the fusion threshold and calibration prior."
        return (f"{top['name']} scored this real item {top['score']:.0%} ({top['reason_code']}).",
                "Add real items like this one to calibration; demote this detector for this media type if it repeats.")
    return ("", "")


def build(verdicts: list[dict[str, Any]], key: list[dict[str, str]]) -> dict[str, Any]:
    """verdicts: [{"sha": .., "filename": .., "verdict": Verdict dict}] for analysed pool items."""
    by_sha = {v["sha"]: v for v in verdicts}
    by_name = {v["filename"]: v for v in verdicts}
    rows, unmatched_key = [], []
    seen = set()
    for k in key:
        item = by_sha.get(k["id"]) or by_name.get(k["id"])
        if not item or not item.get("verdict"):
            unmatched_key.append(k["id"])
            continue
        seen.add(item["sha"])
        v = item["verdict"]
        outcome = _outcome(k["truth"], v["label"])
        why, improve = _why(v, outcome)
        top = sorted((s for s in v.get("signals", []) if s.get("score") is not None),
                     key=lambda s: -s["score"])[:3]
        rows.append({
            "sha": item["sha"], "filename": item["filename"], "media_type": v.get("media_type"),
            "truth": k["truth"], "call": v["label"], "p_fake": v["p_fake"], "confidence": v["confidence"],
            "tier": v["tier"], "reason_code": v["reason_code"], "reason_text": v.get("reason_text", ""),
            "outcome": outcome, "points": POINTS[outcome],
            "why": why, "improve": improve, "source": k.get("team") or k.get("source") or k.get("method") or "",
            "top_signals": [{"name": s["name"], "score": s["score"], "rank": s["rank"]} for s in top],
        })
    unjudged = [v["filename"] for v in verdicts if v["sha"] not in seen]

    n = len(rows)
    counts = {o: sum(r["outcome"] == o for r in rows) for o in POINTS}
    n_fake = counts["caught"] + counts["missed"]
    n_real = counts["cleared"] + counts["false_alarm"]
    brier = sum((r["p_fake"] - (r["truth"] == "fake")) ** 2 for r in rows) / n if n else None
    by_media: dict[str, dict[str, Any]] = {}
    for r in rows:
        m = by_media.setdefault(r["media_type"], {"n": 0, "correct": 0, "points": 0})
        m["n"] += 1
        m["correct"] += r["outcome"] in ("caught", "cleared")
        m["points"] += r["points"]

    # Best single threshold in hindsight: tells us whether the fake prior / calibration was off.
    best_t, best_pts = 0.5, sum(r["points"] for r in rows)
    for t in sorted({0.5, *(r["p_fake"] for r in rows)}):
        pts = sum(POINTS[_outcome(r["truth"], "fake" if r["p_fake"] > t else "real")] for r in rows)
        if pts > best_pts:
            best_t, best_pts = t, pts

    lessons = []
    if counts["false_alarm"]:
        lessons.append(f"{counts['false_alarm']} false alarm(s) cost {5 * counts['false_alarm']} points: the costliest "
                       "mistake. Review the detectors named below before trusting them on similar items.")
    if counts["missed"]:
        lessons.append(f"{counts['missed']} fake(s) slipped through. Their generators are the first self-play targets.")
    if n and abs(best_t - 0.5) > 0.05 and best_pts > sum(r["points"] for r in rows):
        lessons.append(f"A threshold of {best_t:.2f} would have scored {best_pts} instead of "
                       f"{sum(r['points'] for r in rows)}. The pool's fake share was {n_fake / n:.0%}: "
                       f"set CORNCAM_FAKE_PRIOR={n_fake / n:.2f} next game.")
    for m, s in by_media.items():
        if s["n"] >= 2 and s["correct"] / s["n"] < 0.7:
            lessons.append(f"{m}: only {s['correct']} of {s['n']} correct. This media type needs work first.")
    if not lessons and n:
        lessons.append("Every judged item was called correctly.")

    return {
        "n": n, "n_fake": n_fake, "n_real": n_real, "counts": counts,
        "points": sum(r["points"] for r in rows), "reason_points": "pending (judged by the organisers, +3 each)",
        "accuracy": (counts["caught"] + counts["cleared"]) / n if n else None,
        "brier": round(brier, 4) if brier is not None else None,
        "fake_share": round(n_fake / n, 3) if n else None,
        "best_threshold": round(best_t, 3), "best_threshold_points": best_pts,
        "by_media": by_media, "lessons": lessons,
        "slipped": [r for r in rows if r["outcome"] == "missed"],
        "false_alarms": [r for r in rows if r["outcome"] == "false_alarm"],
        "rows": rows, "unmatched_key": unmatched_key, "unjudged": unjudged,
    }


def to_markdown(r: dict[str, Any]) -> str:
    pct = (lambda x: "n/a" if x is None or (isinstance(x, float) and math.isnan(x)) else f"{x:.0%}")
    c = r["counts"]
    out = [
        "# Corncam post-game report", "",
        (f"**{r['points']:+d} points** on {r['n']} judged items ({r['n_fake']} fake, {r['n_real']} real); "
        f"reason points {r['reason_points']}."), "",
        f"- Accuracy {pct(r['accuracy'])}, Brier {r['brier']}",
        (f"- Caught {c['caught']} (+{5 * c['caught']}), cleared {c['cleared']} (+{3 * c['cleared']}), "
        f"false alarms {c['false_alarm']} ({-5 * c['false_alarm']}), missed {c['missed']} ({-3 * c['missed']})"), "",
        "## Lessons", *[f"- {x}" for x in r["lessons"]], "",
        "## Fakes that slipped through",
    ]
    out += [f"- **{x['filename']}** ({x['media_type']}): called real at {pct(x['confidence'])}. {x['why']} "
            f"*Improve:* {x['improve']}" for x in r["slipped"]] or ["- None."]
    out += ["", "## False alarms"]
    out += [f"- **{x['filename']}** ({x['media_type']}): called fake at {pct(x['confidence'])}. {x['why']} "
            f"*Improve:* {x['improve']}" for x in r["false_alarms"]] or ["- None."]
    out += ["", "## By media type", "", "| Media | Items | Correct | Points |", "|---|---|---|---|"]
    out += [f"| {m} | {s['n']} | {s['correct']} | {s['points']:+d} |" for m, s in r["by_media"].items()]
    if r["unmatched_key"]:
        out += ["", f"Key entries not found in our pool: {', '.join(r['unmatched_key'][:20])}"]
    return "\n".join(out) + "\n"
