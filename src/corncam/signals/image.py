"""Learned image detectors.

Smaug-AI-Image-Detector (Abacus.AI, Oct 2026, Apache-2.0): EmbeddingGemma-2 image encoder + linear head,
trained on current generators (GPT-Image 2, Nano Banana Pro, FLUX.2, Sora 2 / Veo 3 frames, ...).
Vendor-reported: 0.973 AUC on real-world Reddit images, 3.0% of real photos flagged. See docs/RESEARCH_V4.

The repo ships its own loader (`smaug_image_detect.py`), which we import from a pinned revision so the
executed code cannot change under us.
"""

from __future__ import annotations

import sys
import time
from functools import lru_cache

from corncam.ingest import Item
from corncam.schema import Category, Policy, Rank, Signal

SMAUG_REPO = "abacusai/Smaug-AI-Image-Detector"
SMAUG_REVISION = "c7c95951e04a87b884a4ad479401b1128c3903bd"  # pinned 2026-10-27

# Rank thresholds (TrueMedia defaults); tune per detector once we have a labelled calibration set.
LOW_MAX, HIGH_MIN = 0.33, 0.5


def rank_for(score: float, low_max: float = LOW_MAX, high_min: float = HIGH_MIN) -> Rank:
    if score > high_min:
        return Rank.HIGH
    if score > low_max:
        return Rank.UNCERTAIN
    return Rank.LOW


@lru_cache(maxsize=1)
def _smaug():
    from huggingface_hub import snapshot_download

    path = snapshot_download(SMAUG_REPO, revision=SMAUG_REVISION)
    if path not in sys.path:
        sys.path.insert(0, path)
    from smaug_image_detect import SmaugImageDetect  # type: ignore[import-not-found]

    return SmaugImageDetect.from_pretrained(path)


def smaug(item: Item, crops: int = 3) -> Signal:
    t0 = time.perf_counter()
    p = float(_smaug()(str(item.path), crops=crops))
    dt = time.perf_counter() - t0
    rank = rank_for(p)
    shown = ">=99%" if p > 0.99 else "<1%" if p < 0.01 else f"{p:.0%}"  # never claim certainty
    evidence = {
        Rank.HIGH: f"AI-image detector (Smaug) finds generator traces: {shown} likely AI-generated.",
        Rank.UNCERTAIN: f"AI-image detector (Smaug) is unsure: {shown} likely AI-generated.",
        Rank.LOW: f"AI-image detector (Smaug) finds no generator traces: {shown} likely AI-generated.",
    }[rank]
    return Signal("Smaug AI-image detector", Category.GENERATIVE_AI, p, rank,
                  "DIFFUSION_ARTIFACT" if rank is Rank.HIGH else "NO_STRONG_SIGNAL", evidence,
                  Policy.TRUST, details={"model": SMAUG_REPO, "revision": SMAUG_REVISION, "crops": crops}, seconds=dt)


def run(item: Item) -> list[Signal]:
    return [smaug(item)]
