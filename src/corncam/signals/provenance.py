"""Provenance: metadata, Content Credentials (C2PA) and generator markers.

High-precision, low-recall: when a generator's label survives, it is near-certain evidence with a
ready-made reason. Absence of labels proves nothing (metadata is easy to strip).

Two sources:
1. A built-in scan (always available): C2PA digitalSourceType markers, AI-tool strings in
   EXIF / XMP / PNG text chunks / container tags, and camera EXIF.
2. `aicheck` CLI (github.com/MatrixA/aicheck) when installed: 11 methods incl. H.264 SEI markers
   for Kling/Sora/Runway etc. Parsed from its text report.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
from pathlib import Path

from corncam.ingest import Item
from corncam.schema import Category, MediaType, Policy, Rank, Signal

# C2PA / IPTC digital source types (spec 2.3): AI-generated or AI-composited media.
_C2PA_AI = (b"trainedAlgorithmicMedia", b"compositeWithTrainedAlgorithmicMedia", b"algorithmicMedia")

# Generator / tool names that appear in metadata written by AI tools.
_AI_TOOLS = [
    "dall-e", "dall·e", "openai", "gpt-image", "chatgpt", "midjourney", "stable diffusion", "stability ai",
    "comfyui", "automatic1111", "invokeai", "fooocus", "firefly", "imagen", "gemini", "google ai", "nano banana",
    "flux", "black forest labs", "ideogram", "leonardo", "recraft", "seedream", "jimeng", "qwen", "kling", "sora",
    "runway", "pika", "luma", "hailuo", "pixverse", "vidu", "veo", "elevenlabs", "suno", "udio", "midjourney",
    "made with ai", "ai generated", "ai-generated", "aigc",
]
_TOOL_RE = re.compile("|".join(re.escape(t) for t in _AI_TOOLS), re.IGNORECASE)
_SD_PARAMS_RE = re.compile(r"\bSteps:\s*\d+.*\bSampler:", re.IGNORECASE | re.DOTALL)  # A1111/ComfyUI PNG params

_MAX_SCAN = 64 * 1024 * 1024  # read whole file up to 64 MB, else head + tail


def _raw_bytes(path: Path) -> bytes:
    size = path.stat().st_size
    with path.open("rb") as f:
        if size <= _MAX_SCAN:
            return f.read()
        head = f.read(_MAX_SCAN // 2)
        f.seek(size - _MAX_SCAN // 2)
        return head + f.read()


def _image_metadata(path: Path) -> tuple[dict[str, str], bool]:
    """Return (text metadata fields, has_camera_exif)."""
    from PIL import ExifTags, Image, UnidentifiedImageError

    fields: dict[str, str] = {}
    has_camera = False
    try:
        with Image.open(path) as img:
            for k, v in (img.info or {}).items():
                if isinstance(v, (str, bytes)) and k not in {"icc_profile", "exif"}:
                    fields[f"info:{k}"] = v.decode("utf-8", "ignore") if isinstance(v, bytes) else v
            exif = img.getexif()
            for tag_id, value in exif.items():
                name = ExifTags.TAGS.get(tag_id, str(tag_id))
                if isinstance(value, (str, bytes)):
                    fields[f"exif:{name}"] = value.decode("utf-8", "ignore") if isinstance(value, bytes) else value
            has_camera = bool(exif.get(0x010F) and exif.get(0x0110))  # Make + Model
    except (OSError, UnidentifiedImageError, ValueError) as exc:  # unreadable: provenance has nothing to say
        fields["error"] = f"metadata unreadable: {exc}"
    return fields, has_camera


def _container_tags(path: Path) -> dict[str, str]:
    if not shutil.which("ffprobe"):
        return {}
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", str(path)],
            capture_output=True, text=True, timeout=30, check=False,
        ).stdout
        data = json.loads(out or "{}")
    except (subprocess.SubprocessError, json.JSONDecodeError):
        return {}
    tags: dict[str, str] = {}
    for k, v in (data.get("format", {}).get("tags") or {}).items():
        tags[f"format:{k}"] = str(v)
    for i, s in enumerate(data.get("streams", [])):
        for k, v in (s.get("tags") or {}).items():
            tags[f"stream{i}:{k}"] = str(v)
    return tags


def builtin_scan(item: Item) -> Signal:
    t0 = time.perf_counter()
    raw = _raw_bytes(item.path)
    c2pa_hits = [m.decode() for m in _C2PA_AI if m in raw]
    has_c2pa = b"c2pa" in raw

    fields: dict[str, str] = {}
    has_camera = False
    if item.media_type is MediaType.IMAGE:
        fields, has_camera = _image_metadata(item.path)
    elif item.media_type in (MediaType.VIDEO, MediaType.AUDIO):
        fields = _container_tags(item.path)

    tool_hits = {k: m.group(0) for k, v in fields.items() if (m := _TOOL_RE.search(v))}
    sd_params = any(_SD_PARAMS_RE.search(v) for v in fields.values())
    details = {"c2pa_present": has_c2pa, "c2pa_ai_markers": c2pa_hits, "ai_tool_fields": tool_hits,
               "sd_generation_params": sd_params, "camera_exif": has_camera}
    dt = time.perf_counter() - t0

    if c2pa_hits:
        return Signal("Content Credentials (C2PA)", Category.PROVENANCE, 0.99, Rank.HIGH, "PROVENANCE_AI_DECLARED",
                      f"Embedded Content Credentials declare the file as AI-generated ({c2pa_hits[0]}).",
                      Policy.TRUST, decisive=True, details=details, seconds=dt)
    if tool_hits or sd_params:
        where, tool = next(iter(tool_hits.items())) if tool_hits else ("info:parameters", "Stable Diffusion params")
        # Field names can be chosen by whoever made the file (PNG text-chunk keys); only plain short names are echoed.
        where = where if re.fullmatch(r"[A-Za-z0-9:_. -]{1,40}", where) else "a metadata field"
        return Signal("Metadata scan", Category.PROVENANCE, 0.92, Rank.HIGH, "PROVENANCE_AI_TOOL",
                      f"File metadata names an AI generator: '{tool}' in {where}.",
                      Policy.TRUST, details=details, seconds=dt)
    if has_camera:
        return Signal("Metadata scan", Category.PROVENANCE, 0.25, Rank.LOW, "PROVENANCE_CAMERA",
                      "Camera make/model present in EXIF and no AI-tool labels (weak evidence: EXIF can be copied).",
                      Policy.INCLUDE, details=details, seconds=dt)
    return Signal("Metadata scan", Category.PROVENANCE, None, Rank.NA, "NO_PROVENANCE",
                  "No provenance labels found (common after re-saving or sharing; not evidence either way).",
                  Policy.INCLUDE, details=details, seconds=dt)


_AIC_LINE = re.compile(r"^\s*(HIGH|MEDIUM|LOW)\s+(.*)$")
# aicheck finding kinds that read embedded metadata (high precision) vs pixel/spectral/filename heuristics,
# which can fire on real media and must never carry trusted votes (a false alarm costs -5 in the game).
_AIC_HEURISTIC = re.compile(r"^(WATERMARK|INVISIBLE|VISIBLE|SPECTR|AUDIO|FFT|FILENAME|DWT)", re.IGNORECASE)
# Guesses from the file format alone (e.g. "WAV: Audio characteristics suggest TTS: mono 16000Hz 16bit"). Phone voice
# notes and call recordings share that format, so these are shown but never vote. Found 27 Oct 2026 on a plain WAV.
_AIC_FORMAT = re.compile(r"characteristics suggest", re.IGNORECASE)
_LEVELS = ("LOW", "MEDIUM", "HIGH")


def aicheck_scan(item: Item) -> list[Signal]:
    """Run the `aic` CLI if installed. Returns [] when unavailable.

    Emits up to two signals: a trusted provenance signal for metadata findings, and a weak
    visual-noise signal for heuristic findings.
    """
    exe = shutil.which("aic")
    if not exe:
        return []
    t0 = time.perf_counter()
    try:
        proc = subprocess.run([exe, "check", str(item.path)], capture_output=True, text=True, timeout=120, check=False)
    except subprocess.SubprocessError:
        return []
    findings = [(m.group(1), m.group(2).strip()) for line in proc.stdout.splitlines() if (m := _AIC_LINE.match(line))]
    dt = time.perf_counter() - t0
    details = {"findings": findings, "raw": proc.stdout[-2000:]}
    fmt = [f for f in findings if _AIC_FORMAT.search(f[1])]
    findings = [f for f in findings if f not in fmt]
    metadata = [f for f in findings if not _AIC_HEURISTIC.match(f[1])]
    heuristic = [f for f in findings if _AIC_HEURISTIC.match(f[1])]

    signals: list[Signal] = []
    if fmt:
        signals.append(Signal("aicheck format hint", Category.PROVENANCE, None, Rank.NA, "FORMAT_HINT",
                              f"File format resembles common AI output ({fmt[0][1]}); many real recordings share it, "
                              "so this is context only.", Policy.IGNORE, details=details, seconds=dt))
    if metadata:
        level, text = max(metadata, key=lambda f: _LEVELS.index(f[0]))
        score, rank, decisive = {"HIGH": (0.97, Rank.HIGH, True), "MEDIUM": (0.88, Rank.HIGH, False),
                                 "LOW": (0.65, Rank.UNCERTAIN, False)}[level]
        signals.append(Signal("aicheck metadata", Category.PROVENANCE, score, rank, "PROVENANCE_AI_MARKER",
                              f"aicheck ({level.lower()} confidence): {text}",
                              Policy.TRUST if level != "LOW" else Policy.INCLUDE,
                              decisive=decisive, details=details, seconds=dt))
    if heuristic:
        level, text = max(heuristic, key=lambda f: _LEVELS.index(f[0]))
        text = re.sub(r"\s*\((strong|medium|weak) evidence\)", "", text, flags=re.IGNORECASE)  # we grade it ourselves
        signals.append(Signal("aicheck pixel heuristics", Category.VISUAL_NOISE, 0.6, Rank.UNCERTAIN,
                              "WATERMARK_HEURISTIC",
                              f"Pixel-pattern heuristic suggests a possible invisible watermark (weak; can fire on real photos): {text}",
                              Policy.INCLUDE, details=details, seconds=dt))
    if not signals:
        signals.append(Signal("aicheck", Category.PROVENANCE, None, Rank.NA, "NO_PROVENANCE",
                              "aicheck found no AI-generation markers.", Policy.INCLUDE, details=details, seconds=dt))
    return signals


def run(item: Item) -> list[Signal]:
    return [builtin_scan(item), *aicheck_scan(item)]
