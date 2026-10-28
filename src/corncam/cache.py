"""Evidence cache: detector results stored on disk, keyed by the file's SHA-256, so the same file is never re-scanned.

What is cached: raw detector *signals* (per full detection, and per investigator/Studio tool call with its arguments).
What is not: the verdict. Fusion and calibration re-run on every request (they take microseconds), so a new
calibration or fusion rule applies immediately to cached evidence.

Invalidation: SIGNALS_VERSION must be bumped whenever a detector, its model revision, its thresholds or its evidence
wording changes. Entries written under another version are ignored. `CORNCAM_NO_CACHE=1` bypasses the cache, and
evaluation runs always bypass it so a benchmark measures the current code, never stored results.

Storage: data/cache/<sha[:2]>/<sha>/<key>.json, written atomically (temp file + rename). data/ is gitignored and never
leaves the machine.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import asdict
from pathlib import Path
from typing import Any

from corncam.schema import Category, Policy, Rank, Signal

SIGNALS_VERSION = "signals-2026-10-28.1"
CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"


def enabled() -> bool:
    return os.environ.get("CORNCAM_NO_CACHE", "").strip() not in ("1", "true", "yes")


def _key(name: str, args: dict[str, Any] | None = None) -> str:
    raw = json.dumps({"v": SIGNALS_VERSION, "name": name, "args": args or {}}, sort_keys=True)
    return f"{name}-{hashlib.sha256(raw.encode()).hexdigest()[:16]}"


def _path(sha: str, key: str) -> Path:
    return CACHE_DIR / sha[:2] / sha / f"{key}.json"


def to_dict(s: Signal) -> dict[str, Any]:
    return asdict(s)


def from_dict(d: dict[str, Any]) -> Signal:
    return Signal(name=d["name"], category=Category(d["category"]), score=d["score"], rank=Rank(d["rank"]),
                  reason_code=d["reason_code"], evidence=d["evidence"], policy=Policy(d["policy"]),
                  decisive=bool(d.get("decisive", False)), details=d.get("details") or {}, seconds=d.get("seconds"))


def get(sha: str, name: str, args: dict[str, Any] | None = None) -> list[Signal] | None:
    if not enabled():
        return None
    p = _path(sha, _key(name, args))
    try:
        data = json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if data.get("version") != SIGNALS_VERSION:
        return None
    try:
        return [from_dict(d) for d in data["signals"]]
    except (KeyError, ValueError, TypeError):
        return None  # a malformed entry is treated as a miss, never trusted


def put(sha: str, name: str, signals: list[Signal], args: dict[str, Any] | None = None) -> None:
    if not enabled():
        return
    p = _path(sha, _key(name, args))
    p.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps({"version": SIGNALS_VERSION, "name": name, "args": args or {},
                       "signals": [to_dict(s) for s in signals]}, default=str)
    fd, tmp = tempfile.mkstemp(dir=p.parent, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(body)
        os.replace(tmp, p)  # atomic: readers never see a half-written file
    except OSError:
        Path(tmp).unlink(missing_ok=True)


def stats() -> dict[str, Any]:
    files = list(CACHE_DIR.glob("*/*/*.json")) if CACHE_DIR.exists() else []
    return {"version": SIGNALS_VERSION, "enabled": enabled(), "entries": len(files),
            "items": len({f.parent.name for f in files}), "bytes": sum(f.stat().st_size for f in files)}
