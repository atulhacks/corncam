"""Detective pipeline: item -> signals -> fused verdict -> explanation."""

from __future__ import annotations

from pathlib import Path

from corncam import calibrate, fusion
from corncam import explain as explain_mod
from corncam.ingest import Item, load_item
from corncam.schema import MediaType, Signal, Verdict
from corncam.signals import audio, face, image, provenance, video

# Media types whose learned detectors are wired in. Others still get provenance, but are flagged
# "experimental" so the tier stays cautious (TrueMedia's false-alarm brake).
COVERED = {MediaType.IMAGE, MediaType.AUDIO}
# Calibration is fitted per media type; a type without its own fit uses the detectors' probabilities as-is.
CALIBRATED = {MediaType.IMAGE}
_CALIBRATION = calibrate.load()  # None until `corncam calibrate` has been run


def collect_signals(item) -> list[Signal]:
    signals = provenance.run(item)
    if item.media_type is MediaType.IMAGE:
        signals += image.run(item)  # whole image: fully AI-generated?
        signals += face.run(item)  # each face: swapped or AI-modified?
    elif item.media_type is MediaType.AUDIO:
        signals += audio.run(item)
    elif item.media_type is MediaType.VIDEO:
        signals += video.run(item)  # sampled frames: whole-frame AI + faces
        signals += audio.run(item)  # the soundtrack: synthetic voice / splicing
    return signals


def detect(path: str | Path) -> Verdict:
    item = load_item(path)
    return fuse(item, collect_signals(item))


def fuse(item: Item, signals: list[Signal]) -> Verdict:
    """Signals -> calibrated verdict. Shared by detect() and the AI investigator, so both decide identically."""
    experimental = item.media_type not in COVERED
    p_raw = min(max(fusion.p_fake(signals), 0.01), 0.99)
    # Decisive provenance is hard evidence, not a score: it is not re-calibrated.
    use_cal = item.media_type in CALIBRATED and not any(s.decisive for s in signals)
    p = calibrate.apply(p_raw, _CALIBRATION, calibrate.pool_prior()) if use_cal else p_raw
    p = min(max(p, 0.01), 0.99)  # never claim certainty
    # Strictly above: an item with no usable evidence (p = 0.5 exactly) is called real. A false alarm costs -5,
    # a miss -3, so the tie goes to "real". Found when music-only real clips were called fake.
    label = "fake" if p > fusion.THRESHOLD else "real"
    vote_tier = fusion.tier(signals, experimental)
    tier = fusion.reconcile(vote_tier, label, signals)
    top = fusion.strongest(signals, label)
    return Verdict(
        item_id=item.sha256,
        filename=item.path.name,
        media_type=item.media_type,
        label=label,
        tier=tier,
        p_fake=round(p, 4),
        p_raw=round(p_raw, 4),
        confidence=round(max(p, 1 - p), 4),
        reason_code=top.reason_code if top else "NO_STRONG_SIGNAL",
        reason_text=explain_mod.explain(label, tier, p, top, signals, experimental,
                                        calibration_driven=tier is not vote_tier),
        votes=fusion.count_votes(signals),
        experimental=experimental,
        signals=signals,
    )
