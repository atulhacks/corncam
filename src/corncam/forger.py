"""Forger (Red team): make persona fakes locally, launder them, and pick the five our own Detective misses.

Brief: "a pipeline to generate synthetic media from the provided personas"; each team submits 5 fakes. Rules enforced
here: a persona must be marked synthetic (organisers' pack or our fictional test persona) or nothing is generated;
every file stays under data/ (gitignored, never uploaded; see .claude/hooks/block_media_upload.sh).

Generators run as isolated command-line tools (uv tools), never inside the Detective's environment:
  image  mflux FLUX.2-klein-4B Q4 (Apache-2.0): text-to-image, or edit from the persona's reference photo so the face
         stays consistent.
Self-play: every candidate (and each laundered variant) is scored by corncam.detect; lower P(fake) = better fake.
"""

from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PERSONAS = ROOT / "data" / "personas"
FORGE = ROOT / "data" / "forger"
CANDIDATES = FORGE / "candidates"
SUBMISSION = FORGE / "submission"
INDEX = FORGE / "index.json"
MAX_SUBMISSION = 5

IMAGE_MODEL = "mflux-community/flux2-klein-4b-mflux-q4"  # pinned download: 794cd159538149ad9830848508c31f0ea7088e58
IMAGE_BASE = "flux2-klein-4b"
IMAGE_STEPS = 4
_SLUG = re.compile(r"[^a-z0-9]+")


class ForgerError(ValueError):
    """A request the Forger refuses or cannot run."""


# ---------------------------------------------------------------- personas


@dataclass
class Persona:
    id: str
    name: str
    bio: str
    synthetic: bool
    appearance: str = ""
    voice: str = ""
    source: str = ""  # e.g. "organisers' pack" or "fictional test persona"
    has_reference: bool = False
    has_voice: bool = False


def _persona_dir(pid: str) -> Path:
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", pid):  # also blocks path traversal
        raise ForgerError("bad persona id")
    return PERSONAS / pid


def list_personas() -> list[Persona]:
    out = []
    for d in sorted(PERSONAS.glob("*/persona.json")):
        out.append(load_persona(d.parent.name))
    return out


def load_persona(pid: str) -> Persona:
    d = _persona_dir(pid)
    meta = json.loads((d / "persona.json").read_text())
    return Persona(
        id=pid, name=meta["name"], bio=meta.get("bio", ""), synthetic=bool(meta.get("synthetic")),
        appearance=meta.get("appearance", ""), voice=meta.get("voice", ""), source=meta.get("source", ""),
        has_reference=(d / "reference.jpg").is_file(), has_voice=(d / "voice.wav").is_file(),
    )


def save_persona(name: str, bio: str, appearance: str, voice: str, source: str, synthetic: bool,
                 reference: bytes | None = None) -> Persona:
    if not synthetic:
        raise ForgerError("Only synthetic personas are allowed (brief rule: no real people).")
    pid = _SLUG.sub("-", name.lower()).strip("-")[:40] or uuid.uuid4().hex[:8]
    d = PERSONAS / pid
    d.mkdir(parents=True, exist_ok=True)
    (d / "persona.json").write_text(json.dumps({
        "name": name, "bio": bio, "appearance": appearance, "voice": voice, "source": source, "synthetic": True,
    }, indent=2))
    if reference:
        img = Image.open(io.BytesIO(reference)).convert("RGB")
        img.save(d / "reference.jpg", quality=95)  # re-encoded: no camera metadata carried over
    return load_persona(pid)


# ---------------------------------------------------------------- laundering


# "phone": one social-media re-save. "whatsapp": a forwarded chat image (720 px, re-compressed twice). Self-play on
# 28 Oct 2026: whatsapp took a FLUX fake from P(fake) 0.99 to 0.41 on our own Detective (Smaug 1.00 -> 0.03);
# Nano Banana stayed at 0.99 under every transform we tried (grain, recapture, crop/rotate, colour, blur).
LAUNDER_PRESETS: dict[str, tuple[int, tuple[int, ...]]] = {"phone": (1080, (85,)), "whatsapp": (720, (80, 70))}


def launder_image(src: Path, dst: Path, preset: str = "phone") -> list[str]:
    """What sharing does to a picture: drop metadata, resize to a social-media size, re-compress as JPEG.

    Removes provenance labels (C2PA, PNG text, EXIF) and smooths some generator pixel traces. Returns the steps applied.
    """
    if preset not in LAUNDER_PRESETS:
        raise ForgerError(f"unknown launder preset {preset!r}")
    long_side, qualities = LAUNDER_PRESETS[preset]
    img = Image.open(src).convert("RGB")
    steps = ["metadata stripped"]
    w, h = img.size
    scale = long_side / max(w, h)
    if scale < 1:
        img = img.resize((round(w * scale), round(h * scale)), Image.Resampling.LANCZOS)
        steps.append(f"resized to {img.size[0]}x{img.size[1]}")
    for q in qualities[:-1]:  # earlier shares in a forward chain
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=q)
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    img.save(dst, "JPEG", quality=qualities[-1], optimize=True)  # fresh file: no EXIF/XMP/C2PA/PNG text
    steps.append(" then ".join(f"JPEG q{q}" for q in qualities))
    return steps


# ---------------------------------------------------------------- generators


def _tool(name: str) -> str:
    exe = shutil.which(name) or str(Path.home() / ".local" / "bin" / name)
    if not Path(exe).is_file():
        raise ForgerError(f"{name} is not installed (uv tool install mflux==0.24.0)")
    return exe


def image_prompt(persona: Persona, scene: str, edit: bool) -> str:
    if edit:
        return (f"The same person as in the reference photo, {scene}. Keep the face and identity identical. "
                "Candid smartphone photo, natural light, realistic skin texture, no text, no watermark.")
    look = persona.appearance or persona.bio
    return (f"Candid smartphone photo of {look}, {scene}. Natural light, realistic skin texture, "
            "slight motion blur, no text, no watermark.")


def generate_image(persona: Persona, scene: str, seed: int, out: Path) -> dict[str, Any]:
    edit = persona.has_reference
    prompt = image_prompt(persona, scene, edit)
    cmd = [_tool("mflux-generate-flux2-edit" if edit else "mflux-generate-flux2"),
           "--model", IMAGE_MODEL, "--base-model", IMAGE_BASE, "--prompt", prompt,
           "--steps", str(IMAGE_STEPS), "--seed", str(seed), "--output", str(out)]
    if edit:
        cmd += ["--image-paths", str(_persona_dir(persona.id) / "reference.jpg")]
    else:
        cmd += ["--width", "832", "--height", "1104"]  # portrait, phone-like aspect
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900, check=False)
    if proc.returncode != 0 or not out.is_file():
        raise ForgerError(f"image generation failed: {(proc.stderr or proc.stdout)[-400:]}")
    return {"model": f"{IMAGE_MODEL} ({'edit from reference' if edit else 'text-to-image'})", "prompt": prompt,
            "seed": seed}


def generate_image_gemini(persona: Persona, scene: str, seed: int, out: Path) -> dict[str, Any]:
    """Nano Banana 2.1 (Gemini) text-to-image, or an edit from the persona's reference photo for identity
    consistency. Sends only the prompt and the organisers' persona photo, never an evidence item. Paid tier only."""
    import base64

    from corncam import ai

    edit = persona.has_reference
    prompt = image_prompt(persona, scene, edit)
    parts: list[dict[str, Any]] = [{"text": prompt}]
    if edit:
        ref = (_persona_dir(persona.id) / "reference.jpg").read_bytes()
        parts.insert(0, {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(ref).decode()}})
    body = {"contents": [{"parts": parts}],
            "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "3:4"}}}
    try:
        data = ai.gemini_post(ai.gemini_image_model(), body)
    except ai.AIError as exc:
        msg = str(exc)
        low = msg.lower()
        if "http 429" in low or "billing" in low or "quota" in low or "free tier" in low:
            raise ForgerError("Nano Banana needs a Gemini key with billing enabled (no free tier for image "
                              f"generation). Details: {msg[:200]}") from exc
        raise ForgerError(msg) from exc
    for cand in data.get("candidates") or []:
        for part in cand.get("content", {}).get("parts", []):
            blob = part.get("inlineData") or part.get("inline_data")
            if blob and blob.get("data"):
                img = Image.open(io.BytesIO(base64.b64decode(blob["data"]))).convert("RGB")
                img.save(out, "PNG")
                return {"model": f"{ai.gemini_image_model()} ({'edit from reference' if edit else 'text-to-image'})",
                        "prompt": prompt, "seed": seed}
    reason = ((data.get("candidates") or [{}])[0]).get("finishReason") or data.get("promptFeedback")
    raise ForgerError(f"Nano Banana returned no image ({reason})")


def generate_text(persona: Persona, scene: str, seed: int, out: Path) -> dict[str, Any]:
    """A short post in the persona's voice, written by the AI layer (DeepSeek). Only the persona card and the topic
    are sent; nothing from the evidence pool."""
    from corncam import ai

    try:
        post = ai.persona_post(asdict(persona), scene)["post"]
    except ai.AIError as exc:
        raise ForgerError(str(exc)) from exc
    if not post:
        raise ForgerError("the AI returned an empty post")
    out.write_text(post + "\n")
    return {"model": f"{ai.model()} (persona voice)", "prompt": scene}


GENERATORS = {"image": generate_image, "text": generate_text}
# Image engines: FLUX.2 Klein on this Mac, or Nano Banana 2.1 through the Gemini API (the generator other teams are
# most likely to use, so it is also our self-play test of the Detective).
IMAGE_ENGINES = {"local": generate_image, "gemini": generate_image_gemini}
EXTENSION = {"image": ".png", "text": ".txt"}


# ---------------------------------------------------------------- candidates and the worker


@dataclass
class Candidate:
    id: str
    persona: str
    kind: str
    scene: str
    file: str  # name under CANDIDATES
    created: float
    status: str = "queued"  # queued | generating | scoring | done | failed
    error: str | None = None
    model: str = ""
    prompt: str = ""
    seed: int = 0
    parent: str | None = None  # laundered variants point at their original
    engine: str = "local"  # image engine: local (FLUX.2) or gemini (Nano Banana)
    launder: list[str] = field(default_factory=list)
    preset: str | None = None  # launder preset for laundered variants
    p_fake: float | None = None
    label: str | None = None
    reason_code: str | None = None
    selected: bool = False


class Forge:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._items: dict[str, Candidate] = {}
        self._jobs: list[tuple[str, str]] = []  # (action, candidate id)
        CANDIDATES.mkdir(parents=True, exist_ok=True)
        if INDEX.is_file():
            for raw in json.loads(INDEX.read_text()):
                c = Candidate(**raw)
                if c.status in ("queued", "generating", "scoring"):
                    c.status, c.error = "failed", "interrupted by a restart"
                self._items[c.id] = c
        threading.Thread(target=self._worker, name="forger-worker", daemon=True).start()

    # ---- public
    def items(self) -> list[Candidate]:
        with self._lock:
            return sorted(self._items.values(), key=lambda c: c.created, reverse=True)

    def get(self, cid: str) -> Candidate | None:
        with self._lock:
            return self._items.get(cid)

    def path(self, cid: str) -> Path | None:
        c = self.get(cid)
        return CANDIDATES / c.file if c else None

    def generate(self, persona_id: str, kind: str, scene: str, n: int = 1, engine: str = "local") -> list[Candidate]:
        persona = load_persona(persona_id)
        if not persona.synthetic:
            raise ForgerError("Only synthetic personas are allowed.")
        if kind not in GENERATORS:
            raise ForgerError(f"kind must be one of {sorted(GENERATORS)}")
        if kind == "image" and engine not in IMAGE_ENGINES:
            raise ForgerError(f"engine must be one of {sorted(IMAGE_ENGINES)}")
        if not scene.strip():
            raise ForgerError("Describe the scene to generate.")
        out = []
        for i in range(max(1, min(n, 4))):
            cid = uuid.uuid4().hex[:12]
            c = Candidate(id=cid, persona=persona_id, kind=kind, scene=scene.strip(), file=f"{cid}{EXTENSION[kind]}",
                          created=time.time() + i * 1e-3, seed=int(time.time()) % 100000 + i * 7919,
                          engine=engine if kind == "image" else "local")
            out.append(self._enqueue(c, "generate"))
        return out

    def launder(self, cid: str, preset: str = "phone") -> Candidate:
        src = self.get(cid)
        if not src or src.status != "done":
            raise ForgerError("only finished candidates can be laundered")
        if src.kind != "image":
            raise ForgerError("laundering is implemented for images")
        if preset not in LAUNDER_PRESETS:
            raise ForgerError(f"unknown launder preset {preset!r}")
        vid = uuid.uuid4().hex[:12]
        v = Candidate(id=vid, persona=src.persona, kind=src.kind, scene=src.scene, file=f"{vid}.jpg",
                      created=time.time(), model=src.model, prompt=src.prompt, seed=src.seed, parent=src.id,
                      engine=src.engine, preset=preset)
        return self._enqueue(v, "launder")

    def select(self, cid: str, selected: bool) -> Candidate:
        with self._lock:
            c = self._items.get(cid)
            if not c or c.status != "done":
                raise ForgerError("only finished candidates can be selected")
            if selected and not c.selected and sum(x.selected for x in self._items.values()) >= MAX_SUBMISSION:
                raise ForgerError(f"The brief allows {MAX_SUBMISSION} fakes; unselect one first.")
            c.selected = selected
            self._save()
            return c

    def export(self) -> dict[str, Any]:
        """Copy the selected fakes to data/forger/submission/ under neutral names; truth manifest stays local."""
        chosen = [c for c in self.items() if c.selected]
        if not chosen:
            raise ForgerError("Select up to five candidates first.")
        if SUBMISSION.exists():
            shutil.rmtree(SUBMISSION)
        SUBMISSION.mkdir(parents=True)
        manifest = []
        for i, c in enumerate(sorted(chosen, key=lambda x: x.created), 1):
            name = f"item_{i}{Path(c.file).suffix}"
            if c.kind == "image":  # re-save so no generator metadata survives the copy
                Image.open(CANDIDATES / c.file).convert("RGB").save(SUBMISSION / name, quality=95)
            else:
                shutil.copy2(CANDIDATES / c.file, SUBMISSION / name)
            manifest.append({"submitted_as": name, "candidate": c.id, "persona": c.persona, "kind": c.kind,
                             "our_detector_p_fake": c.p_fake, "model": c.model, "launder": c.launder})
        (FORGE / "submission_manifest.json").write_text(json.dumps(manifest, indent=2))
        return {"count": len(manifest), "folder": str(SUBMISSION.relative_to(ROOT)), "items": manifest}

    # ---- internals
    def _enqueue(self, c: Candidate, action: str) -> Candidate:
        with self._lock:
            self._items[c.id] = c
            self._jobs.append((action, c.id))
            self._save()
        self._wake.set()
        return c

    def _save(self) -> None:
        INDEX.parent.mkdir(parents=True, exist_ok=True)
        INDEX.write_text(json.dumps([asdict(c) for c in self._items.values()], indent=2))

    def _set(self, c: Candidate, **kw: Any) -> None:
        with self._lock:
            for k, v in kw.items():
                setattr(c, k, v)
            self._save()

    def _worker(self) -> None:
        while True:
            self._wake.wait(timeout=5)
            self._wake.clear()
            while True:
                with self._lock:
                    if not self._jobs:
                        break
                    action, cid = self._jobs.pop(0)
                    c = self._items.get(cid)
                if c is None:
                    continue
                try:
                    self._run(action, c)
                except Exception as exc:  # noqa: BLE001 - one failed candidate must not stop the worker
                    self._set(c, status="failed", error=str(exc)[:500])

    def _run(self, action: str, c: Candidate) -> None:
        from corncam.detect import detect

        out = CANDIDATES / c.file
        if action == "generate":
            self._set(c, status="generating")
            gen = IMAGE_ENGINES[c.engine] if c.kind == "image" else GENERATORS[c.kind]
            meta = gen(load_persona(c.persona), c.scene, c.seed, out)
            self._set(c, model=meta["model"], prompt=meta["prompt"])
        elif action == "launder":
            self._set(c, status="generating")
            parent = self.get(c.parent or "")
            if parent is None:
                raise ForgerError("original candidate is gone")
            self._set(c, launder=launder_image(CANDIDATES / parent.file, out, c.preset or "phone"))
        self._set(c, status="scoring")
        v = detect(out)  # self-play: how does our own Detective judge it?
        self._set(c, status="done", p_fake=v.p_fake, label=v.label, reason_code=v.reason_code)


_forge: Forge | None = None
_forge_lock = threading.Lock()


def get_forge() -> Forge:
    global _forge
    with _forge_lock:
        if _forge is None:
            _forge = Forge()
        return _forge
