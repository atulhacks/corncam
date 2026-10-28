"""HTTP API for the Corncam web UI. Binds to localhost only; media never leaves the machine."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import threading
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from corncam import ai as ai_mod
from corncam import calibrate
from corncam import forger as forger_mod
from corncam import pipeline as pipeline_mod
from corncam import pool as pool_mod
from corncam import report as report_mod
from corncam.detect import COVERED, detect
from corncam.ingest import detect_media_type
from corncam.signals import image as image_signals

ROOT = Path(__file__).resolve().parents[2]
UPLOADS = ROOT / "data" / "uploads"
EVAL_DIR = ROOT / "data" / "eval"
MAX_BYTES = 200 * 1024 * 1024
_SHA = re.compile(r"^[0-9a-f]{64}$")

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Warm the image model in the background so the first upload is not a cold start (~15 s on M4).
    threading.Thread(target=image_signals._smaug, name="warm-smaug", daemon=True).start()
    yield


app = FastAPI(title="Corncam API", version="0.1.0", lifespan=lifespan)

_LOCAL = {"localhost", "127.0.0.1", "[::1]"}
# Pool items and uploads are attacker-chosen files: never let one run as a page on this origin.
_MEDIA_HEADERS = {"X-Content-Type-Options": "nosniff",
                  "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'"}


@app.middleware("http")
async def local_only(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    """Block DNS rebinding (foreign Host) and cross-site requests (foreign Origin) to this unauthenticated API."""
    host = (request.headers.get("host") or "").rsplit(":", 1)[0]
    origin = request.headers.get("origin")
    if host not in _LOCAL or (origin and urlsplit(origin).hostname not in {"localhost", "127.0.0.1", "::1"}):
        return JSONResponse({"detail": "local requests only"}, status_code=403)
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers.update(_MEDIA_HEADERS)
        if response.headers.get("content-type", "").startswith(("application/json", "application/x-ndjson")):
            response.headers["Cache-Control"] = "no-store"  # data changes with every analysis and every redeploy
    return response


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "covered_media": sorted(str(m) for m in COVERED),
        "calibrated": calibrate.load() is not None,
        "fake_prior": calibrate.pool_prior(),
        "aicheck": shutil.which("aic") is not None,
    }


async def _store_upload(file: UploadFile) -> tuple[str, Path]:
    data = await file.read()
    if not data:
        raise HTTPException(400, "empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "file too large (max 200 MB)")
    sha = hashlib.sha256(data).hexdigest()
    suffix = Path(file.filename or "upload").suffix.lower()[:8]
    UPLOADS.mkdir(parents=True, exist_ok=True)
    path = UPLOADS / f"{sha}{suffix}"
    if not path.exists():
        path.write_bytes(data)
    return sha, path


@app.post("/api/investigate")
async def investigate_upload(file: UploadFile) -> StreamingResponse:
    """AI-led investigation, streamed as newline-delimited JSON events (see corncam.investigate)."""
    from corncam.ingest import load_item
    from corncam.investigate import investigate

    sha, path = await _store_upload(file)
    name = file.filename or path.name

    def events():
        try:
            for ev in investigate(load_item(path)):
                if ev["type"] == "verdict":
                    ev["verdict"] |= {"filename": name, "media_url": f"/api/media/{sha}",
                                      "media_kind": str(detect_media_type(path))}
                yield json.dumps(ev, default=str) + "\n"
        except Exception as exc:  # noqa: BLE001 - surface the failure to the page instead of a dropped stream
            yield json.dumps({"type": "error", "text": f"Investigation failed: {exc}"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


_STUDIO_NODE = re.compile(r"^[a-z_]{3,40}$")
_ARTIFACT = re.compile(r"^[0-9a-f]{16}_[a-z]+\.png$")


@app.get("/api/studio/tools")
def studio_tools() -> list[dict[str, Any]]:
    """The node palette: every tool the Studio canvas (or the AI) can add, with the media types it applies to."""
    from corncam import forensics
    from corncam.investigate import (
        ALLOWED,
        CATALOG,
        CATEGORIES,
        CORE,
        STUDIO_TOOLS,
        TOOLS,
    )

    out = []
    for t in TOOLS + STUDIO_TOOLS:
        fn = t["function"]
        if fn["name"] == "finish":
            continue
        kinds = (sorted(str(k) for k in forensics.APPLIES[fn["name"]]) if fn["name"] in forensics.APPLIES
                 else sorted(str(k) for k, names in ALLOWED.items() if fn["name"] in names))
        core = sorted(str(k) for k, steps in CORE.items() if any(n == fn["name"] for n, _ in steps))
        category, purpose = CATALOG.get(fn["name"], ("Other", fn["description"]))
        out.append({"name": fn["name"], "description": fn["description"], "media": kinds,
                    "advisory": fn["name"] in forensics.APPLIES, "core": core, "category": category,
                    "purpose": purpose})
    order = {c: i for i, c in enumerate(CATEGORIES)}
    return sorted(out, key=lambda t: (order.get(t["category"], 99), t["advisory"]))


@app.post("/api/studio/investigate")
async def studio_investigate(file: UploadFile, goal: str = Form(""), requested: str = Form("")) -> StreamingResponse:
    """Studio run: the AI plans around the person's goal; nodes they placed on the canvas always run."""
    from corncam.ingest import load_item
    from corncam.investigate import investigate

    nodes = [n for n in (x.strip() for x in requested.split(",")) if n and _STUDIO_NODE.match(n)][:12]
    sha, path = await _store_upload(file)
    name = file.filename or path.name

    def events():
        try:
            for ev in investigate(load_item(path), goal=goal.strip()[:500] or "", requested=nodes):
                if ev["type"] == "verdict":
                    ev["verdict"] |= {"filename": name, "media_url": f"/api/media/{sha}",
                                      "media_kind": str(detect_media_type(path))}
                yield json.dumps(ev, default=str) + "\n"
        except Exception as exc:  # noqa: BLE001 - surface the failure to the page instead of a dropped stream
            yield json.dumps({"type": "error", "text": f"Studio run failed: {exc}"}) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.get("/api/studio/artifacts/{name}")
def studio_artifact(name: str) -> FileResponse:
    from corncam import forensics

    if not _ARTIFACT.match(name) or not (forensics.ARTIFACTS / name).is_file():
        raise HTTPException(404, "no such artifact")
    return FileResponse(forensics.ARTIFACTS / name, media_type="image/png")


@app.post("/api/detect")
async def detect_upload(file: UploadFile) -> dict[str, Any]:
    sha, path = await _store_upload(file)
    verdict = await run_in_threadpool(detect, path)  # model inference is blocking; keep the event loop free
    out = verdict.to_dict()
    out["filename"] = file.filename or path.name
    out["media_url"] = f"/api/media/{sha}"
    out["media_kind"] = str(detect_media_type(path))
    return out


@app.get("/api/media/{sha}")
def media(sha: str) -> FileResponse:
    if not _SHA.match(sha):
        raise HTTPException(400, "bad id")
    matches = list(UPLOADS.glob(f"{sha}*"))
    if not matches:
        raise HTTPException(404, "not found")
    return FileResponse(matches[0])


@app.get("/api/benchmark")
def benchmark() -> list[dict[str, Any]]:
    """Summaries of evaluation reports in data/eval (no per-item rows)."""
    reports = []
    for p in sorted(EVAL_DIR.glob("*.json")):
        try:
            r = json.loads(p.read_text())
        except json.JSONDecodeError:
            continue
        if "rows" in r:
            # Only held-out runs may be headlined: tuning runs fit the calibration, smoke runs are tiny, stress runs
            # re-score the held-out set after a deliberate attack (e.g. WhatsApp re-compression) and are shown apart.
            role = ("tuning" if "tune" in p.stem else "stress" if "stress" in p.stem
                    else "smoke" if r.get("n", 0) < 50 else "held-out")
            # Media type from the files the run scored, so image headlines never compare against audio runs.
            first = (r["rows"] or [{}])[0].get("file", "")
            media = str(detect_media_type(Path(first))) if first else "image"
            reports.append({"name": p.stem, "role": role, "media": media, "created": p.stat().st_mtime,
                            **{k: v for k, v in r.items() if k != "rows"}})
    return sorted(reports, key=lambda x: x["created"])


# ---------------- Evidence Pool ----------------


def _item_out(item: pool_mod.PoolItem) -> dict[str, Any]:
    v = item.verdict or {}
    return {
        "sha": item.sha, "filename": item.filename, "media_kind": item.media_kind, "status": item.status,
        "error": item.error, "added": item.added, "media_url": f"/api/pool/{item.sha}/media",
        "label": v.get("label"), "tier": v.get("tier"), "p_fake": v.get("p_fake"),
        "confidence": v.get("confidence"), "reason_code": v.get("reason_code"),
    }


@app.get("/api/pool")
def pool_list() -> dict[str, Any]:
    p = pool_mod.get_pool()
    return {"summary": p.summary(), "items": [_item_out(i) for i in p.items()]}


@app.post("/api/pool/upload")
async def pool_upload(files: list[UploadFile]) -> dict[str, Any]:
    p = pool_mod.get_pool()
    added = 0
    for f in files:
        data = await f.read()
        if not data or len(data) > MAX_BYTES or Path(f.filename or "").name.startswith("."):
            continue  # skip empty, oversized and hidden files (e.g. .DS_Store from folder uploads)
        p.add(f.filename or "item", data)
        added += 1
    return {"added": added, "summary": p.summary()}


@app.post("/api/pool/analyse")
def pool_analyse(force: bool = False) -> dict[str, Any]:
    p = pool_mod.get_pool()
    return {"queued": p.analyse_all(force=force), "summary": p.summary()}


@app.get("/api/pool/{sha}")
def pool_item(sha: str) -> dict[str, Any]:
    if not _SHA.match(sha):
        raise HTTPException(400, "bad id")
    item = pool_mod.get_pool().get(sha)
    if item is None:
        raise HTTPException(404, "not found")
    out = _item_out(item)
    if item.verdict:
        out["verdict"] = {**item.verdict, "media_url": out["media_url"], "filename": item.filename}
    return out


@app.get("/api/pool/{sha}/media")
def pool_media(sha: str) -> FileResponse:
    if not _SHA.match(sha):
        raise HTTPException(400, "bad id")
    path = pool_mod.get_pool().path(sha)
    if path is None or not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path)


@app.get("/api/pool-export.{fmt}")
def pool_export(fmt: str) -> Response:
    if fmt not in {"json", "csv"}:
        raise HTTPException(400, "format must be json or csv")
    body = pool_mod.get_pool().submission(fmt)
    media = "text/csv" if fmt == "csv" else "application/json"
    return Response(body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="corncam-submission.{fmt}"'})


@app.delete("/api/pool")
def pool_clear() -> dict[str, Any]:
    p = pool_mod.get_pool()
    p.clear()
    return {"summary": p.summary()}


@app.get("/api/pipeline")
def pipeline() -> dict[str, Any]:
    return pipeline_mod.describe()


# ---------------- Post-game report ----------------
ANSWER_KEY = pool_mod.POOL / "answer_key.json"


def _report() -> dict[str, Any] | None:
    if not ANSWER_KEY.is_file():
        return None
    key = json.loads(ANSWER_KEY.read_text())
    verdicts = [{"sha": i.sha, "filename": i.filename, "verdict": i.verdict}
                for i in pool_mod.get_pool().items() if i.verdict]
    return report_mod.build(verdicts, key)


@app.post("/api/report/key")
async def report_key(file: UploadFile) -> dict[str, Any]:
    data = await file.read()
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(400, "answer key must be a CSV under 5 MB")
    try:
        key = report_mod.parse_key(data.decode("utf-8", errors="replace"))
    except report_mod.KeyError_ as exc:
        raise HTTPException(400, str(exc)) from exc
    ANSWER_KEY.parent.mkdir(parents=True, exist_ok=True)
    ANSWER_KEY.write_text(json.dumps(key))
    return _report() or {}


@app.get("/api/report")
def report_get() -> dict[str, Any] | None:
    return _report()  # null until an answer key is imported


@app.get("/api/report.md")
def report_markdown() -> Response:
    r = _report()
    if r is None:
        raise HTTPException(404, "no answer key imported yet")
    return Response(report_mod.to_markdown(r), media_type="text/markdown",
                    headers={"Content-Disposition": 'attachment; filename="corncam-post-game-report.md"'})


@app.delete("/api/report/key")
def report_key_clear() -> dict[str, Any]:
    ANSWER_KEY.unlink(missing_ok=True)
    return {"cleared": True}


# ---------------- AI layer (explains, answers, writes; never decides) ----------------


def _ai_call(fn, *args):
    try:
        return fn(*args)
    except ai_mod.AIError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/ai/status")
def ai_status() -> dict[str, Any]:
    return ai_mod.status()


class VerdictBody(BaseModel):
    verdict: dict[str, Any]


class AskBody(VerdictBody):
    question: str
    history: list[dict[str, str]] = []


@app.post("/api/ai/explain")
def ai_explain(body: VerdictBody) -> dict[str, Any]:
    return _ai_call(ai_mod.explain, body.verdict)


@app.post("/api/ai/ask")
def ai_ask(body: AskBody) -> dict[str, str]:
    return {"answer": _ai_call(ai_mod.ask, body.verdict, body.question, body.history)}


@app.post("/api/ai/report")
def ai_report() -> dict[str, Any]:
    r = _report()
    if r is None:
        raise HTTPException(404, "no answer key imported yet")
    return _ai_call(ai_mod.report_narrative, r)


class ScenesBody(BaseModel):
    persona: str
    theme: str = ""
    n: int = 4


@app.post("/api/ai/scenes")
def ai_scenes(body: ScenesBody) -> dict[str, list[str]]:
    from dataclasses import asdict

    persona = _forger_call(forger_mod.load_persona, body.persona)
    return {"scenes": _ai_call(ai_mod.scene_ideas, asdict(persona), body.theme, body.n)}


# ---------------- Forger (Red team) ----------------
_CID = re.compile(r"^[0-9a-f]{12}$")


def _cand_out(c: forger_mod.Candidate) -> dict[str, Any]:
    from dataclasses import asdict

    return {**asdict(c), "media_url": f"/api/forger/candidates/{c.id}/media"}


def _forger_call(fn, *args):
    try:
        return fn(*args)
    except forger_mod.ForgerError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/forger/status")
def forger_status() -> dict[str, Any]:
    tools = {t: shutil.which(t) is not None or (Path.home() / ".local/bin" / t).is_file()
             for t in ("mflux-generate-flux2", "mflux-generate-flux2-edit")}
    return {"tools": tools, "image_model": forger_mod.IMAGE_MODEL, "kinds": sorted(forger_mod.GENERATORS),
            "gemini": ai_mod.gemini_key() is not None, "gemini_image_model": ai_mod.gemini_image_model(),
            "max_submission": forger_mod.MAX_SUBMISSION}


@app.get("/api/forger/personas")
def forger_personas() -> list[dict[str, Any]]:
    from dataclasses import asdict

    return [{**asdict(p), "reference_url": f"/api/forger/personas/{p.id}/reference" if p.has_reference else None}
            for p in forger_mod.list_personas()]


@app.post("/api/forger/personas")
async def forger_persona_create(
    name: str = Form(...), bio: str = Form(""), appearance: str = Form(""), voice: str = Form(""),
    source: str = Form(""), synthetic: bool = Form(False), reference: UploadFile | None = None,
) -> dict[str, Any]:
    from dataclasses import asdict

    data = await reference.read() if reference else None
    if data and len(data) > 20 * 1024 * 1024:
        raise HTTPException(400, "reference image must be under 20 MB")
    p = _forger_call(forger_mod.save_persona, name, bio, appearance, voice, source, synthetic, data or None)
    return asdict(p)


@app.get("/api/forger/personas/{pid}/reference")
def forger_persona_reference(pid: str) -> FileResponse:
    path = _forger_call(forger_mod._persona_dir, pid) / "reference.jpg"
    if not path.is_file():
        raise HTTPException(404, "no reference image")
    return FileResponse(path)


class GenerateRequest(BaseModel):
    persona: str
    kind: str = "image"
    scene: str
    n: int = 1
    engine: str = "local"


@app.post("/api/forger/generate")
def forger_generate(req: GenerateRequest) -> list[dict[str, Any]]:
    forge = forger_mod.get_forge()
    return [_cand_out(c) for c in _forger_call(forge.generate, req.persona, req.kind, req.scene, req.n, req.engine)]


@app.get("/api/forger/candidates")
def forger_candidates() -> list[dict[str, Any]]:
    return [_cand_out(c) for c in forger_mod.get_forge().items()]


@app.post("/api/forger/candidates/{cid}/launder")
def forger_launder(cid: str, preset: str = "phone") -> dict[str, Any]:
    if not _CID.match(cid):
        raise HTTPException(400, "bad id")
    return _cand_out(_forger_call(forger_mod.get_forge().launder, cid, preset))


class SelectRequest(BaseModel):
    selected: bool


@app.post("/api/forger/candidates/{cid}/select")
def forger_select(cid: str, req: SelectRequest) -> dict[str, Any]:
    if not _CID.match(cid):
        raise HTTPException(400, "bad id")
    return _cand_out(_forger_call(forger_mod.get_forge().select, cid, req.selected))


@app.get("/api/forger/candidates/{cid}/media")
def forger_media(cid: str) -> FileResponse:
    if not _CID.match(cid):
        raise HTTPException(400, "bad id")
    path = forger_mod.get_forge().path(cid)
    if path is None or not path.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(path)


@app.post("/api/forger/export")
def forger_export() -> dict[str, Any]:
    return _forger_call(forger_mod.get_forge().export)


def serve(host: str = "127.0.0.1", port: int = 8000) -> None:
    import uvicorn

    uvicorn.run(app, host=host, port=port)
