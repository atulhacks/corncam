"""Ingest: identify the item (content hash) and its media type. Originals are never modified."""

from __future__ import annotations

import hashlib
import mimetypes
from dataclasses import dataclass
from pathlib import Path

from corncam.schema import MediaType

_EXT = {
    MediaType.IMAGE: {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".gif"},
    MediaType.VIDEO: {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"},
    MediaType.AUDIO: {".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus", ".aac"},
    MediaType.TEXT: {".txt", ".md", ".json"},
}


@dataclass(frozen=True)
class Item:
    path: Path
    sha256: str
    media_type: MediaType
    size_bytes: int


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(chunk):
            h.update(block)
    return h.hexdigest()


def detect_media_type(path: Path) -> MediaType:
    ext = path.suffix.lower()
    for media_type, exts in _EXT.items():
        if ext in exts:
            return media_type
    guessed, _ = mimetypes.guess_type(path.name)
    if guessed:
        major = guessed.split("/", 1)[0]
        return {"image": MediaType.IMAGE, "video": MediaType.VIDEO, "audio": MediaType.AUDIO, "text": MediaType.TEXT}.get(
            major, MediaType.UNKNOWN
        )
    return MediaType.UNKNOWN


def load_item(path: str | Path) -> Item:
    p = Path(path).expanduser().resolve()
    if not p.is_file():
        raise FileNotFoundError(p)
    return Item(path=p, sha256=sha256_file(p), media_type=detect_media_type(p), size_bytes=p.stat().st_size)
