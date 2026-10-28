"""Studio forensics: extra checks the AI (or the user) can add to an investigation.

Every check here is ADVISORY: it returns Policy.IGNORE signals that are shown as evidence but never vote and are never
passed to fusion. None of them has been measured on held-out data, so they may inform a person, not the verdict.

Privacy: `evidence` lines are what the AI reads (via investigate._brief), so they describe what was found, never the
payload itself. Decoded content (QR text, base64 text, URLs) lives in `details`, which only the page shows.
"""

from __future__ import annotations

import base64
import binascii
import json
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from corncam.ingest import Item
from corncam.schema import Category, MediaType, Policy, Rank, Signal

ARTIFACTS = Path(__file__).resolve().parents[2] / "data" / "studio"

_EXIF_TAGS = {271: "make", 272: "model", 305: "software", 306: "modified", 36867: "taken", 42036: "lens"}
_GENERATOR_KEYS = ("parameters", "prompt", "workflow", "Software", "Comment", "Description")
_GENERATOR_WORDS = re.compile(r"stable diffusion|comfyui|midjourney|dall[-· ]?e|firefly|flux|imagen|gemini|"
                              r"nano banana|sdxl|automatic1111|invokeai|leonardo|ideogram|runway|sora|kling", re.IGNORECASE)


def _signal(name: str, cat: Category, code: str, evidence: str, flagged: bool = False,
            details: dict[str, Any] | None = None) -> Signal:
    return Signal(name=name, category=cat, score=None, rank=Rank.UNCERTAIN if flagged else Rank.LOW,
                  reason_code=code, evidence=evidence, policy=Policy.IGNORE, details=details or {})


# ---------------------------------------------------------------- origin


def _ffprobe_tags(path: Path) -> dict[str, str]:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format_tags:stream_tags", "-of", "json",
                          str(path)], capture_output=True, text=True, check=False, timeout=30)
    try:
        data = json.loads(out.stdout or "{}")
    except json.JSONDecodeError:
        return {}
    tags: dict[str, str] = {}
    for block in [data.get("format", {})] + data.get("streams", []):
        for k, v in (block.get("tags") or {}).items():
            tags.setdefault(k.lower(), str(v))
    return tags


def origin_metadata(item: Item) -> list[Signal]:
    """Where did the file come from? Camera make/model, editing software, generator tags, container encoder."""
    found: dict[str, Any] = {}
    if item.media_type is MediaType.IMAGE:
        from PIL import Image

        with Image.open(item.path) as im:
            exif = im.getexif()
            for tag, key in _EXIF_TAGS.items():
                if exif.get(tag):
                    found[key] = str(exif.get(tag)).strip("\x00 ")[:80]
            found["gps_present"] = 34853 in exif  # whether, never where
            text = {k: str(v)[:4000] for k, v in im.info.items() if isinstance(v, str | bytes) and k in _GENERATOR_KEYS}
        raw = item.path.read_bytes()[:2_000_000]
        m = re.search(rb"CreatorTool[=>\"']+([^<\"']{1,80})", raw)
        if m:
            found["creator_tool"] = m.group(1).decode("utf-8", "replace")
        found["c2pa_marker"] = b"c2pa" in raw or b"jumb" in raw
        blob = " ".join([*text.values(), found.get("software", ""), found.get("creator_tool", "")])
        gen = _GENERATOR_WORDS.search(blob)
        if gen:
            found["generator_hint"] = gen.group(0)
        if text:
            found["embedded_text_keys"] = sorted(text)
    elif item.media_type in (MediaType.VIDEO, MediaType.AUDIO):
        tags = _ffprobe_tags(item.path)
        for key in ("encoder", "handler_name", "com.apple.quicktime.make", "com.apple.quicktime.model",
                    "com.apple.quicktime.software", "creation_time", "comment", "title"):
            if key in tags:
                found[key.split(".")[-1]] = tags[key][:80]
        gen = _GENERATOR_WORDS.search(" ".join(tags.values()))
        if gen:
            found["generator_hint"] = gen.group(0)
    else:
        return [_signal("Origin metadata", Category.PROVENANCE, "NOT_APPLICABLE", "No metadata to read for text.")]

    parts = []
    if found.get("make") or found.get("model"):
        parts.append(f"camera {found.get('make', '')} {found.get('model', '')}".strip())
    for key, label in (("software", "software"), ("creator_tool", "edited with"), ("encoder", "encoder"),
                       ("handler_name", "handler")):
        if found.get(key):
            parts.append(f"{label} {found[key]}")
    if found.get("generator_hint"):
        parts.append(f"names an AI tool ({found['generator_hint']})")
    if found.get("c2pa_marker"):
        parts.append("Content Credentials data present")
    if not parts:
        evidence = ("No camera or software metadata. Common for screenshots, social-media re-saves and AI "
                    "generators alike, so this alone proves nothing.")
        code = "NO_ORIGIN_METADATA"
    else:
        evidence = "Origin clues: " + "; ".join(parts) + "."
        code = "GENERATOR_NAMED" if found.get("generator_hint") else "ORIGIN_METADATA"
    return [_signal("Origin metadata", Category.PROVENANCE, code, evidence,
                    flagged=bool(found.get("generator_hint")), details=found)]


# ---------------------------------------------------------------- compression


def jpeg_forensics(item: Item) -> list[Signal]:
    """Compression history: JPEG quality, chroma subsampling, size, and whether our detector is reliable on it."""
    from PIL import Image

    from corncam import calibrate

    with Image.open(item.path) as im:
        fmt, (w, h) = im.format, im.size
        sampling = None
        if fmt == "JPEG":
            from PIL import JpegImagePlugin

            sampling = {0: "4:4:4", 1: "4:2:2", 2: "4:2:0"}.get(JpegImagePlugin.get_sampling(im))
    q = calibrate.jpeg_quality(item.path)
    details = {"format": fmt, "width": w, "height": h, "jpeg_quality": q, "chroma_subsampling": sampling}
    if fmt != "JPEG":
        return [_signal("Compression history", Category.VISUAL_NOISE, "NOT_JPEG",
                        f"{fmt} file, {w}x{h}: no JPEG re-compression, so pixel traces are intact.", details=details)]
    compressed = calibrate.is_compressed(item.path)
    details["chat_forward_like"] = compressed
    if compressed:
        return [_signal("Compression history", Category.VISUAL_NOISE, "HEAVY_RECOMPRESSION",
                        f"JPEG quality about {q} at {max(w, h)} px, like a forwarded chat image. Our whole-image "
                        "detector is less reliable here (held-out test: misses rose from 14% to 54%).",
                        flagged=True, details=details)]
    return [_signal("Compression history", Category.VISUAL_NOISE, "LIGHT_COMPRESSION",
                    f"JPEG quality about {q}, {w}x{h}, chroma {sampling}: light compression, detectors work normally.",
                    details=details)]


# ---------------------------------------------------------------- error level analysis


def error_level(item: Item, quality: int = 90) -> list[Signal]:
    """Error level analysis: re-save at a known JPEG quality and map where the picture changes most.

    A pasted or retouched region often re-compresses differently from the rest. Weak on its own (textures and edges
    also light up), so it is shown as a map for a person to read, never as a score.
    """
    import io

    import numpy as np
    from PIL import Image

    with Image.open(item.path) as im:
        img = im.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    diff = np.abs(np.asarray(img, dtype=np.int16) - np.asarray(Image.open(buf).convert("RGB"), dtype=np.int16))
    err = diff.max(axis=2).astype(np.float32)
    scale = 255.0 / max(float(np.percentile(err, 99.5)), 1.0)
    heat = np.clip(err * scale, 0, 255).astype(np.uint8)
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    name = f"{item.sha256[:16]}_ela.png"
    Image.fromarray(heat).convert("L").save(ARTIFACTS / name)
    # Block-level contrast: does one region carry far more error than the image as a whole?
    h, w = err.shape
    bh, bw = max(h // 8, 1), max(w // 8, 1)
    blocks = [float(err[y:y + bh, x:x + bw].mean()) for y in range(0, h - bh + 1, bh) for x in range(0, w - bw + 1, bw)]
    mean = float(err.mean()) or 1.0
    ratio = max(blocks) / mean if blocks else 1.0
    flagged = ratio > 3.0
    evidence = (f"One region re-compresses {ratio:.1f}x more than the image average; worth a look on the map "
                "(edges and fine texture can also do this)." if flagged else
                f"Re-compression error is spread fairly evenly (peak region {ratio:.1f}x the average); no pasted "
                "region stands out.")
    return [_signal("Error level analysis", Category.VISUAL_NOISE, "ELA_HOTSPOT" if flagged else "ELA_EVEN",
                    evidence, flagged=flagged,
                    details={"artifact": f"/api/studio/artifacts/{name}", "peak_ratio": round(ratio, 2)})]


# ---------------------------------------------------------------- hidden data / decoders


_ZERO_WIDTH = re.compile("[\\u200b\\u200c\\u200d\\u2060\\ufeff]")
_B64 = re.compile(r"[A-Za-z0-9+/]{24,}={0,2}")
_URL = re.compile(r"https?://[^\s)>\]\"']+")


def _trailing_bytes(path: Path) -> int:
    raw = path.read_bytes()
    if raw[:2] == b"\xff\xd8":
        end = raw.rfind(b"\xff\xd9")
        return len(raw) - end - 2 if end >= 0 else 0
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        end = raw.rfind(b"IEND")
        return len(raw) - end - 8 if end >= 0 else 0
    return 0


def hidden_data(item: Item) -> list[Signal]:
    """Decoders: QR codes and appended bytes in images; zero-width characters, base64 blobs and links in text."""
    details: dict[str, Any] = {}
    notes: list[str] = []
    if item.media_type is MediaType.IMAGE:
        import cv2

        img = cv2.imread(str(item.path), cv2.IMREAD_COLOR)
        if img is not None:
            payload, points, _ = cv2.QRCodeDetector().detectAndDecode(img)
            if points is not None and payload:
                details["qr_payload"] = payload[:500]
                notes.append("a QR code (payload shown on the page only)")
        extra = _trailing_bytes(item.path)
        if extra > 16:
            details["appended_bytes"] = extra
            notes.append(f"{extra:,} bytes appended after the end of the image (a common hiding place)")
    elif item.media_type is MediaType.TEXT:
        text = item.path.read_text(errors="replace")[:200_000]
        zw = len(_ZERO_WIDTH.findall(text))
        if zw:
            details["zero_width_chars"] = zw
            notes.append(f"{zw} invisible zero-width characters (used to watermark or fingerprint text)")
        decoded = []
        for blob in _B64.findall(text)[:20]:
            try:
                s = base64.b64decode(blob, validate=True).decode("utf-8")
            except (binascii.Error, UnicodeDecodeError, ValueError):
                continue
            if s.isprintable():
                decoded.append(s[:200])
        if decoded:
            details["base64_decoded"] = decoded
            notes.append(f"{len(decoded)} base64-encoded text blob(s)")
        urls = _URL.findall(text)
        if urls:
            details["urls"] = urls[:20]
            notes.append(f"{len(urls)} link(s)")
    else:
        return [_signal("Hidden data", Category.PROVENANCE, "NOT_APPLICABLE",
                        "Hidden-data decoders run on images and text.")]
    if not notes:
        return [_signal("Hidden data", Category.PROVENANCE, "NOTHING_HIDDEN",
                        "No QR codes, appended data or encoded text found.", details=details)]
    return [_signal("Hidden data", Category.PROVENANCE, "HIDDEN_DATA_FOUND", "Found " + "; ".join(notes) + ".",
                    flagged=True, details=details)]


# ---------------------------------------------------------------- what-if


def whatif_whatsapp(item: Item) -> list[Signal]:
    """Would the verdict survive a WhatsApp forward? Re-compress a copy (720 px, JPEG q80 then q70) and re-score it."""
    from corncam.detect import detect
    from corncam.forger import launder_image

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "forwarded.jpg"
        launder_image(item.path, out, "whatsapp")
        v = detect(out)
    smaug = next((s.score for s in v.signals if s.name.startswith("Smaug") and s.score is not None), None)
    evidence = (f"After a simulated WhatsApp forward our Detective would say {v.label.upper()} "
                f"({round(v.p_fake * 100)}% fake)" + (f"; whole-image detector {round(smaug * 100)}%." if smaug is not None
                                                     else "."))
    return [_signal("What-if: WhatsApp forward", Category.GENERATIVE_AI, "WHATIF_FORWARD", evidence,
                    flagged=v.label == "real", details={"p_fake_after": v.p_fake, "label_after": v.label,
                                                        "smaug_after": smaug})]


TOOLS: dict[str, Any] = {
    "origin_metadata": origin_metadata,
    "jpeg_forensics": jpeg_forensics,
    "error_level": error_level,
    "hidden_data": hidden_data,
    "whatif_whatsapp": whatif_whatsapp,
}
APPLIES: dict[str, set[MediaType]] = {
    "origin_metadata": {MediaType.IMAGE, MediaType.VIDEO, MediaType.AUDIO},
    "jpeg_forensics": {MediaType.IMAGE},
    "error_level": {MediaType.IMAGE},
    "hidden_data": {MediaType.IMAGE, MediaType.TEXT},
    "whatif_whatsapp": {MediaType.IMAGE},
}
