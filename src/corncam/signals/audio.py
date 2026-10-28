"""Synthetic-voice detection with pellav2 (Pella Research, MIT).

Independent benchmark (podonos/audio-dfd-benchmark, Oct 2026, 4,524 clips, private gold labels):
95.82% accuracy — the only open-weights detector above 95%; the next is 70.5%. See docs/RESEARCH_V4.

Model: facebook/w2v-bert-2.0 encoder + learned layer weights + linear head; sigmoid(logit) = P(fake).
Preprocessing reproduces the reference `pellav2_infer.py` (pinned revision) exactly, per 4-second window:
16 kHz mono → DC removal → 20 Hz high-pass → loudness-normalise to -23 LUFS → pad to 4 s.

Our change to the reference: it scores only the centre 4 s of a clip. We score up to MAX_WINDOWS evenly
spaced 4 s windows across the whole clip (a partly synthetic clip can't hide outside the centre), and report
per-window scores plus their consistency, like production APIs (Resemble Detect: chunk scores + consistency).
Decoding goes through ffmpeg, so every audio format and the audio track of a video are handled the same way.
"""

from __future__ import annotations

import math
import shutil
import subprocess
import sys
import time
from functools import lru_cache

import numpy as np

from corncam.ingest import Item
from corncam.schema import Category, Policy, Rank, Signal
from corncam.signals.image import rank_for

PELLA_REPO = "Sadanie/pellav2-audio-deepfake-detector"
PELLA_REVISION = "29daea8b04acf2d3f11d1d0da6b01c17fc8a1e4b"  # pinned 2026-10-27
SR = 16_000
WINDOW = 4 * SR  # the model's training crop
MAX_WINDOWS = 6
TARGET_LUFS = -23.0
MIN_SPEECH_RMS = 1e-3  # below this the clip is effectively silent
MAX_SECONDS = 120
MIN_SPEECH_SECONDS = 1.0  # Silero VAD speech needed before a voice verdict is given


@lru_cache(maxsize=1)
def _vad():
    from silero_vad import (
        load_silero_vad,  # snakers4/silero-vad, MIT; weights ship inside the package
    )

    return load_silero_vad()


def speech_seconds(wav: np.ndarray) -> float:
    """Seconds of speech in a 16 kHz mono clip, per Silero VAD."""
    import torch
    from silero_vad import get_speech_timestamps

    ts = get_speech_timestamps(torch.from_numpy(np.ascontiguousarray(wav, dtype=np.float32)), _vad(),
                               sampling_rate=SR)
    return sum(t["end"] - t["start"] for t in ts) / SR


class NoAudioError(RuntimeError):
    """The file has no decodable audio stream."""


def decode(path: str) -> np.ndarray:
    """Any audio/video file → float32 mono 16 kHz (first MAX_SECONDS) via ffmpeg."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required for audio analysis")
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-t", str(MAX_SECONDS), "-vn", "-ac", "1",
         "-ar", str(SR), "-f", "f32le", "-"],
        capture_output=True, timeout=120, check=False,
    )
    if proc.returncode != 0 or not proc.stdout:
        raise NoAudioError(proc.stderr.decode("utf-8", "ignore")[-300:] or "no audio stream")
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def _loudness(x: np.ndarray) -> float:
    """Integrated loudness (LUFS); RMS fallback for very short input — as in the reference script."""
    try:
        import pyloudnorm as pyln

        if len(x) >= int(0.4 * SR):
            v = pyln.Meter(SR).integrated_loudness(x.astype(np.float64))
            if np.isfinite(v):
                return float(v)
    except (ValueError, ImportError):
        pass
    return float(20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-9) - 0.691)


def _prepare_window(w: np.ndarray) -> np.ndarray:
    from scipy.signal import butter, sosfiltfilt

    w = w - w.mean()
    if len(w) > 3 * SR // 100:
        w = sosfiltfilt(butter(2, 20.0, btype="highpass", fs=SR, output="sos"), w)
    w = w.astype(np.float32)
    if len(w):
        gain = float(np.clip(TARGET_LUFS - _loudness(w), -40.0, 40.0))
        w = np.clip(w * 10 ** (gain / 20), -1.0, 1.0).astype(np.float32)
    if len(w) < WINDOW:
        w = np.concatenate([w, np.zeros(WINDOW - len(w), np.float32)])
    return w


def windows(wav: np.ndarray) -> list[tuple[float, np.ndarray]]:
    """Evenly spaced 4 s windows covering the clip: [(start_seconds, samples)]."""
    if len(wav) <= WINDOW:
        return [(0.0, wav)]
    n = min(MAX_WINDOWS, math.ceil(len(wav) / WINDOW))
    starts = np.linspace(0, len(wav) - WINDOW, n).astype(int)
    return [(s / SR, wav[s : s + WINDOW]) for s in starts]


@lru_cache(maxsize=1)
def _pella():
    import torch
    from huggingface_hub import hf_hub_download, snapshot_download

    path = snapshot_download(PELLA_REPO, revision=PELLA_REVISION, allow_patterns=["*.py", "*.json"])
    if path not in sys.path:
        sys.path.insert(0, path)
    from pellav2_infer import Detector  # type: ignore[import-not-found]

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    weights = hf_hub_download(PELLA_REPO, "pellav2_detector.pt", revision=PELLA_REVISION)
    model = Detector()
    # weights_only: the checkpoint is a plain state dict; never unpickle arbitrary objects.
    model.load_state_dict(torch.load(weights, map_location="cpu", weights_only=True))
    return model.to(device).eval(), device


def pellav2(item: Item) -> Signal:
    import torch

    t0 = time.perf_counter()
    try:
        wav = decode(str(item.path))
    except NoAudioError:
        return Signal("pellav2 synthetic-voice detector", Category.VOICE, None, Rank.NA, "NO_AUDIO",
                      "No audio track to analyse.", Policy.TRUST, seconds=time.perf_counter() - t0)

    duration = len(wav) / SR
    if float(np.sqrt(np.mean(wav**2))) < MIN_SPEECH_RMS:
        return Signal("pellav2 synthetic-voice detector", Category.VOICE, None, Rank.NA, "NO_SPEECH",
                      "The audio is effectively silent, so there is no voice to judge.", Policy.TRUST,
                      details={"duration_s": round(duration, 2)}, seconds=time.perf_counter() - t0)

    speech_s = speech_seconds(wav)
    if speech_s < MIN_SPEECH_SECONDS:
        # Music, tones or ambience: pellav2 judges voices only, and scores non-speech unpredictably
        # (a pure sine tone scored 0.82 "synthetic" before this gate).
        return Signal("pellav2 synthetic-voice detector", Category.VOICE, None, Rank.NA, "NO_SPEECH",
                      "No clear speech found (music, tones or background sound only), so there is no voice to judge.",
                      Policy.TRUST, details={"duration_s": round(duration, 2), "speech_s": round(speech_s, 2)},
                      seconds=time.perf_counter() - t0)

    wins = windows(wav)
    batch = torch.from_numpy(np.stack([_prepare_window(w) for _, w in wins]))
    model, device = _pella()
    with torch.no_grad():
        logits = model(batch.to(device)).float().cpu().numpy()
    probs = 1 / (1 + np.exp(-logits))
    p = float(1 / (1 + math.exp(-float(logits.mean()))))  # average logits, then sigmoid (as Smaug does crops)
    worst = int(np.argmax(probs))
    spread = float(probs.max() - probs.min())
    dt = time.perf_counter() - t0

    rank = rank_for(p)
    shown = ">=99%" if p > 0.99 else "<1%" if p < 0.01 else f"{p:.0%}"
    where = f" Most suspicious at {wins[worst][0]:.0f}–{wins[worst][0] + 4:.0f} s." if len(wins) > 1 else ""
    mixed = len(wins) > 1 and spread > 0.5
    evidence = {
        Rank.HIGH: f"Voice detector (pellav2) hears synthetic-speech traces: {shown} likely AI-generated.{where}",
        Rank.UNCERTAIN: f"Voice detector (pellav2) is unsure: {shown} likely AI-generated.{where}",
        Rank.LOW: f"Voice detector (pellav2) finds no synthetic-speech traces: {shown} likely AI-generated.",
    }[rank]
    if mixed:
        evidence += " Scores differ sharply between parts of the clip — possibly partly synthetic or spliced."
    return Signal(
        "pellav2 synthetic-voice detector", Category.VOICE, p, rank,
        ("SPLICED_AUDIO" if mixed else "TTS_ARTIFACT") if rank is Rank.HIGH else "NO_STRONG_SIGNAL",
        evidence, Policy.TRUST,
        details={"model": PELLA_REPO, "revision": PELLA_REVISION, "duration_s": round(duration, 2),
                 "windows": [{"start_s": round(s, 2), "p_fake": round(float(q), 4)} for (s, _), q in zip(wins, probs, strict=True)],
                 "consistency": round(1 - spread, 4), "device": device},
        seconds=dt,
    )


def run(item: Item) -> list[Signal]:
    return [pellav2(item)]
