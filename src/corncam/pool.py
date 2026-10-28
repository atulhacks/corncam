"""Evidence Pool: the arena's unlabelled items, stored locally and analysed in the background.

Items are stored by content hash under data/pool/items/; verdicts are cached under data/pool/verdicts/.
A single worker thread analyses queued items one at a time (one model instance, predictable memory).
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from corncam.detect import detect
from corncam.ingest import detect_media_type

ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT / "data" / "pool"
ITEMS = POOL / "items"
VERDICTS = POOL / "verdicts"
INDEX = POOL / "index.json"


@dataclass
class PoolItem:
    sha: str
    filename: str
    media_kind: str
    stored: str  # stored file name under ITEMS
    added: float
    status: str = "new"  # new | queued | analysing | done | failed
    error: str | None = None
    verdict: dict[str, Any] | None = field(default=None, repr=False)


class Pool:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._items: dict[str, PoolItem] = {}
        self._load()
        threading.Thread(target=self._worker, name="pool-worker", daemon=True).start()

    # ---------- persistence ----------
    def _load(self) -> None:
        if INDEX.is_file():
            for raw in json.loads(INDEX.read_text()):
                item = PoolItem(**{k: v for k, v in raw.items() if k != "verdict"})
                vpath = VERDICTS / f"{item.sha}.json"
                if vpath.is_file():
                    item.verdict, item.status = json.loads(vpath.read_text()), "done"
                elif item.status in {"analysing", "done"}:
                    item.status = "queued"  # interrupted run: analyse again
                self._items[item.sha] = item

    def _save(self) -> None:
        POOL.mkdir(parents=True, exist_ok=True)
        rows = [{k: v for k, v in asdict(i).items() if k != "verdict"} for i in self._items.values()]
        INDEX.write_text(json.dumps(rows, indent=1))

    # ---------- API ----------
    def add(self, filename: str, data: bytes) -> PoolItem:
        sha = hashlib.sha256(data).hexdigest()
        with self._lock:
            if sha in self._items:
                return self._items[sha]
            ITEMS.mkdir(parents=True, exist_ok=True)
            suffix = Path(filename).suffix.lower()[:8]
            stored = f"{sha}{suffix}"
            (ITEMS / stored).write_bytes(data)
            item = PoolItem(sha=sha, filename=Path(filename).name, media_kind=str(detect_media_type(ITEMS / stored)),
                            stored=stored, added=time.time())
            self._items[sha] = item
            self._save()
        return item

    def analyse_all(self, retry_failed: bool = True, force: bool = False) -> int:
        """Queue new (and failed) items; with force, also re-judge finished ones (after a detector update)."""
        with self._lock:
            n = 0
            for item in self._items.values():
                if force and item.status == "done":
                    (VERDICTS / f"{item.sha}.json").unlink(missing_ok=True)
                    item.verdict, item.status = None, "queued"
                if item.status == "new" or (item.status == "failed" and retry_failed):
                    item.status, item.error = "queued", None
                n += item.status == "queued"
            self._save()
        self._wake.set()
        return n

    def items(self) -> list[PoolItem]:
        with self._lock:
            return sorted(self._items.values(), key=lambda i: i.added)

    def get(self, sha: str) -> PoolItem | None:
        with self._lock:
            return self._items.get(sha)

    def path(self, sha: str) -> Path | None:
        item = self.get(sha)
        return ITEMS / item.stored if item else None

    def clear(self) -> None:
        with self._lock:
            for item in self._items.values():
                (ITEMS / item.stored).unlink(missing_ok=True)
                (VERDICTS / f"{item.sha}.json").unlink(missing_ok=True)
            self._items.clear()
            self._save()

    def summary(self) -> dict[str, Any]:
        items = self.items()
        done = [i for i in items if i.status == "done" and i.verdict]
        return {
            "total": len(items),
            "new": sum(i.status == "new" for i in items),
            "queued": sum(i.status == "queued" for i in items),
            "analysing": sum(i.status == "analysing" for i in items),
            "done": len(done),
            "failed": sum(i.status == "failed" for i in items),
            "fake": sum(i.verdict["label"] == "fake" for i in done),
            "real": sum(i.verdict["label"] == "real" for i in done),
            "uncertain": sum(i.verdict["tier"] == "uncertain" for i in done),
        }

    def submission(self, fmt: str = "json") -> str:
        """The deliverable for the organisers: one row per item with verdict, confidence and reason."""
        rows = [
            {"item": i.filename, "sha256": i.sha, "verdict": i.verdict["label"], "confidence": i.verdict["confidence"],
             "reason_code": i.verdict["reason_code"], "reason": i.verdict["reason_text"]}
            for i in self.items() if i.verdict
        ]
        if fmt == "csv":
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=list(rows[0]) if rows else ["item"])
            writer.writeheader()
            writer.writerows(rows)
            return buf.getvalue()
        return json.dumps(rows, indent=2)

    # ---------- worker ----------
    def _next(self) -> PoolItem | None:
        with self._lock:
            for item in sorted(self._items.values(), key=lambda i: i.added):
                if item.status == "queued":
                    item.status = "analysing"
                    return item
        return None

    def _worker(self) -> None:
        while True:
            item = self._next()
            if item is None:
                self._wake.wait()
                self._wake.clear()
                continue
            try:
                verdict = detect(ITEMS / item.stored).to_dict()
                verdict["media_kind"] = item.media_kind
                VERDICTS.mkdir(parents=True, exist_ok=True)
                (VERDICTS / f"{item.sha}.json").write_text(json.dumps(verdict, default=str))
                with self._lock:
                    item.verdict, item.status = json.loads(json.dumps(verdict, default=str)), "done"
                    self._save()
            except Exception as exc:  # noqa: BLE001 - one bad item must not stop the queue
                with self._lock:
                    item.status, item.error = "failed", f"{type(exc).__name__}: {exc}"[:300]
                    self._save()


_POOL: Pool | None = None
_POOL_LOCK = threading.Lock()


def get_pool() -> Pool:
    global _POOL  # process-wide singleton owned by the API process
    with _POOL_LOCK:
        if _POOL is None:
            _POOL = Pool()
        return _POOL
