"""Video frames: the visual half of video detection (the audio track is judged by signals.audio).

Pattern from Hive / Resemble (`face_only` video mode) and rustyneuron01's GenD-style video branch: pick frames, run
the image detectors on each, then aggregate over time. Frames are chosen, not just spaced: 24 candidates are scored
for sharpness and face size, and the best ones that stay spread across the clip are kept (select_frames).
  - Whole frame (Smaug, trained on Sora 2 / Veo 3 frames): median over frames. A fully generated video is
    synthetic in every frame, so one odd frame must not decide.
  - Faces (GenD): mean of the top-3 frames. A swap or lip-sync edit may show only when the face turns or talks.

Both vote with 1 weight (Policy.INCLUDE), not 2, and video stays "experimental" in detect.COVERED, until the
video branch is measured on held-out data.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

from corncam.fusion import OPERATING_POINT
from corncam.ingest import Item
from corncam.schema import Category, MediaType, Policy, Rank, Signal
from corncam.signals import face, image

N_FRAMES = 8
TOP_K_FACES = 3


def duration(path: Path) -> float | None:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, check=False,
    )
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError):
        return None


def extract_frames(path: Path, out_dir: Path, n: int = N_FRAMES) -> list[tuple[float, Path]]:
    """n frames at evenly spaced timestamps (centre of each segment), as PNG (lossless, no extra JPEG traces)."""
    dur = duration(path)
    if not dur or dur <= 0:
        return []
    frames = []
    for i in range(n):
        t = (i + 0.5) * dur / n
        out = out_dir / f"frame_{i:02d}.png"
        subprocess.run(
            ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-y", str(out)],
            capture_output=True, check=False,
        )
        if out.is_file() and out.stat().st_size > 0:
            frames.append((t, out))
    return frames


CANDIDATES = 24


def frame_quality(img_bgr: np.ndarray) -> dict[str, float]:
    """Sharpness (variance of the Laplacian), brightness, and the largest face's share of the frame."""
    import cv2

    h, w = img_bgr.shape[:2]
    small = cv2.resize(img_bgr, (640, max(1, round(640 * h / w)))) if w > 640 else img_bgr
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    faces = face.detect_faces(img_bgr)
    largest = max((float(b[2] * b[3]) for b, _, _ in faces), default=0.0) / float(w * h)
    return {"sharpness": float(cv2.Laplacian(gray, cv2.CV_64F).var()), "brightness": float(gray.mean()),
            "faces": float(len(faces)), "face_area": largest}


def select_frames(path: Path, out_dir: Path, n: int = N_FRAMES,
                  candidates: int = CANDIDATES) -> list[tuple[float, Path, dict[str, float]]]:
    """The n most useful frames, spread across the clip.

    Evenly sampled candidates are scored: sharp frames and frames with large faces first (face models need a clear
    face; whole-frame models need detail); near-black, blown-out or blurred frames last. A minimum time gap keeps the
    picks spread out, so a short edited segment is not over-sampled and the rest of the clip is not ignored.
    """
    import cv2

    cands = extract_frames(path, out_dir, n=max(candidates, n))
    dur = duration(path) or 0.0
    scored = []
    for t, p in cands:
        img = cv2.imread(str(p), cv2.IMREAD_COLOR)
        if img is None:
            continue
        q = frame_quality(img)
        usable = 12 < q["brightness"] < 243 and q["sharpness"] > 15
        score = (np.log1p(q["sharpness"]) + (2.0 if q["faces"] else 0.0) + 8.0 * min(q["face_area"], 0.25)
                 - (10.0 if not usable else 0.0))
        scored.append((score, t, p, q))
    gap = dur / (2 * n) if dur else 0.0
    picked: list[tuple[float, Path, dict[str, float]]] = []
    for _, t, p, q in sorted(scored, key=lambda x: -x[0]):
        if all(abs(t - pt) >= gap for pt, _, _ in picked):
            picked.append((t, p, q))
        if len(picked) == n:
            break
    return sorted(picked, key=lambda x: x[0])


def _frame_item(p: Path) -> Item:
    return Item(path=p, sha256="", media_type=MediaType.IMAGE, size_bytes=p.stat().st_size)


def _shown(p: float) -> str:
    return ">=99%" if p > 0.99 else "<1%" if p < 0.01 else f"{p:.0%}"


def run(item: Item, n: int = N_FRAMES) -> list[Signal]:
    t0 = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="corncam_frames_") as tmp:
        frames = [(t, p) for t, p, _ in select_frames(item.path, Path(tmp), n=n)]
        if not frames:
            return [Signal("Video frames", Category.GENERATIVE_AI, None, Rank.NA, "NO_FRAMES",
                           "No video frames could be decoded.", Policy.INCLUDE, seconds=time.perf_counter() - t0)]
        whole, faces = [], []
        for t, p in frames:
            fi = _frame_item(p)
            whole.append((t, float(image.smaug(fi, crops=1).score)))
            g = face.gend_faces(fi)
            if g.score is not None:
                faces.append((t, float(g.score)))

    n = len(frames)
    scores = np.array([s for _, s in whole])
    p_whole = float(np.median(scores))
    worst_t = whole[int(np.argmax(scores))][0]
    rank = image.rank_for(p_whole)
    verb = {Rank.HIGH: "finds generator traces", Rank.UNCERTAIN: "is unsure",
            Rank.LOW: "finds no generator traces"}[rank]
    out = [Signal(
        "Smaug on video frames", Category.GENERATIVE_AI, p_whole, rank,
        "AI_GENERATED_VIDEO" if rank is Rank.HIGH else "NO_STRONG_SIGNAL",
        f"AI-image detector (Smaug) {verb} across {n} sampled frames: median {_shown(p_whole)} likely AI-generated"
        f" (most suspicious frame at {worst_t:.1f}s).",
        Policy.INCLUDE,
        details={"frames": [{"t": round(t, 2), "p_fake": round(s, 4)} for t, s in whole]},
        seconds=time.perf_counter() - t0,
    )]

    if not faces:
        out.append(Signal("GenD on video faces", Category.FACES, None, Rank.NA, "NO_FACE",
                          "No clear face in the sampled frames, so face-swap analysis does not apply.", Policy.INCLUDE))
        return out
    top = sorted((s for _, s in faces), reverse=True)[:TOP_K_FACES]
    p_face = float(np.mean(top))
    rank = image.rank_for(p_face, low_max=0.5, high_min=OPERATING_POINT["GenD on video faces"])
    worst_t = max(faces, key=lambda ts: ts[1])[0]
    verb = {Rank.HIGH: "finds face-manipulation traces", Rank.UNCERTAIN: "is unsure about the face",
            Rank.LOW: "finds no face manipulation"}[rank]
    out.append(Signal(
        "GenD on video faces", Category.FACES, p_face, rank,
        "FACE_MANIPULATION" if rank is Rank.HIGH else "NO_STRONG_SIGNAL",
        f"Face-forgery detector (GenD) {verb} in {len(faces)} of {n} frames with a face: "
        f"{_shown(p_face)} likely fake (strongest at {worst_t:.1f}s).",
        Policy.INCLUDE,
        details={"frames": [{"t": round(t, 2), "p_fake": round(s, 4)} for t, s in faces]},
        seconds=time.perf_counter() - t0,
    ))
    return out
