"""Turn detector signals into one verdict.

Two layers, deliberately separate:
1. Explainable tier (TrueMedia.org verdict.ts): HIGH-rank detectors cast votes (trusted = 2);
   >=2 votes -> high, 1 -> uncertain, 0 -> low; demote to uncertain when the only votes come from
   pixel-noise detectors or the item is "experimental" (outside what detectors are validated on),
   unless >=3 votes.
2. Binary call for the game: fused probability p_fake, call "fake" when p_fake >= 0.5. With the game's
   payoffs (+5/-5 on fakes vs +3/-3 on reals, plus +3 for a correct reason on either) the
   expected-value break-even is 0.5. Until we fit a calibrated model on our labelled set, p_fake is a
   weighted mean in logit space (trusted detectors weigh 2x).
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from corncam.schema import Category, Policy, Rank, Signal

THRESHOLD = 0.5
VOTES_HIGH, VOTES_OVERRIDE = 2, 3


def _weight(s: Signal) -> float:
    return {Policy.TRUST: 2.0, Policy.INCLUDE: 1.0, Policy.IGNORE: 0.0}[s.policy]


def count_votes(signals: Sequence[Signal]) -> int:
    return sum(int(_weight(s)) for s in signals if s.rank is Rank.HIGH and s.policy is not Policy.IGNORE)


def tier(signals: Sequence[Signal], experimental: bool) -> Rank:
    if any(s.decisive for s in signals):
        return Rank.HIGH
    votes = count_votes(signals)
    if votes >= VOTES_OVERRIDE:
        return Rank.HIGH
    if votes >= VOTES_HIGH:
        voters = [s for s in signals if s.rank is Rank.HIGH and s.policy is not Policy.IGNORE]
        noise_only = all(s.category is Category.VISUAL_NOISE for s in voters)
        return Rank.UNCERTAIN if (experimental or noise_only) else Rank.HIGH
    return Rank.UNCERTAIN if votes >= 1 else Rank.LOW


def reconcile(tier_: Rank, label: str, signals: Sequence[Signal]) -> Rank:
    """The tier (from detector votes) and the label (from calibrated P(fake)) must never contradict:
    'fake' with little detector evidence, or 'real' with substantial evidence, is shown as uncertain."""
    if any(s.decisive for s in signals):
        return tier_
    if label == "fake" and tier_ is Rank.LOW:
        return Rank.UNCERTAIN
    if label == "real" and tier_ is Rank.HIGH:
        return Rank.UNCERTAIN
    return tier_


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


# Measured operating points: the score where a detector's false-alarm rate on real items is acceptable. Before fusion
# each score is shifted in logit space so its operating point maps to 0.5. GenD-CLIP flags 20.7% of 121 real faces at
# 0.5 but 5.8% at 0.8 (data/face_eval, 27 Oct 2026), close to Smaug's 4% on held-out real images.
OPERATING_POINT = {"GenD face-forgery detector": 0.8, "GenD on video faces": 0.8}

# Evidence categories that answer independent questions (is the whole image generated? is a face swapped? is the voice
# synthetic? does the file declare AI?). A face swap is not a generated image, so averaging the two lets one detector's
# "no" cancel the other's "yes"; the most suspicious category decides instead (Hive / Sightengine run them as separate
# models). Pixel-noise heuristics are weak and may never convict on their own, so they are not in this set.
INDEPENDENT = {Category.PROVENANCE, Category.GENERATIVE_AI, Category.FACES, Category.VOICE, Category.SEMANTIC}


def effective(s: Signal) -> float:
    """The detector's score on the common scale where 0.5 is its operating point."""
    assert s.score is not None
    op = OPERATING_POINT.get(s.name)
    if op is None:
        return s.score
    return 1 / (1 + math.exp(-(_logit(s.score) - _logit(op))))


def _mean(pairs: Sequence[tuple[float, float]]) -> float:
    z = sum(w * _logit(p) for p, w in pairs) / sum(w for _, w in pairs)
    return 1 / (1 + math.exp(-z))


def p_fake(signals: Sequence[Signal]) -> float:
    if any(s.decisive for s in signals):
        return max(s.score or 0.99 for s in signals if s.decisive)
    scored = [s for s in signals if s.score is not None and _weight(s) > 0]
    if not scored:
        return 0.5  # no evidence at all
    by_category: dict[Category, list[tuple[float, float]]] = {}
    for s in scored:
        by_category.setdefault(s.category, []).append((effective(s), _weight(s)))
    independent = [_mean(v) for c, v in by_category.items() if c in INDEPENDENT]
    if independent:
        return max(independent)
    return _mean([pair for v in by_category.values() for pair in v])  # weak evidence only


def strongest(signals: Sequence[Signal], label: str) -> Signal | None:
    """The signal that best supports the chosen label (used for reason code and text)."""
    scored = [s for s in signals if s.score is not None and s.policy is not Policy.IGNORE]
    if not scored:
        return None
    decisive = [s for s in scored if s.decisive]
    if decisive and label == "fake":
        return decisive[0]
    key = (lambda s: s.score * _weight(s)) if label == "fake" else (lambda s: (1 - s.score) * _weight(s))
    return max(scored, key=key)
