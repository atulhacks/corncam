"""Core data model for Corncam verdicts.

Design borrowed from production systems we studied (docs/RESEARCH_V3, V4):
- TrueMedia.org: every detector's score is mapped to a rank bucket and casts votes;
  "trusted" detectors get 2 votes; "n/a" when a detector cannot analyse the item.
- Resemble AI Detect: overall label + score, per-detector results, evidence for the UI.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class MediaType(StrEnum):
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    TEXT = "text"
    UNKNOWN = "unknown"


class Category(StrEnum):
    """Evidence-card groups shown to non-experts (TrueMedia-style)."""

    PROVENANCE = "provenance"  # C2PA / metadata / watermark markers
    GENERATIVE_AI = "generative_ai"  # learned detectors for AI-generated content
    FACES = "faces"  # face-swap / face-forgery detectors
    VISUAL_NOISE = "visual_noise"  # classical pixel/frequency forensics
    VOICE = "voice"  # synthetic speech detectors
    SEMANTIC = "semantic"  # content / transcript / persona consistency


class Rank(StrEnum):
    LOW = "low"  # little evidence of manipulation
    UNCERTAIN = "uncertain"
    HIGH = "high"  # substantial evidence of manipulation
    NA = "n/a"  # detector could not analyse this item


class Policy(StrEnum):
    INCLUDE = "include"  # 1 vote
    TRUST = "trust"  # 2 votes
    IGNORE = "ignore"  # shown, never votes


@dataclass
class Signal:
    """One detector's opinion about one item."""

    name: str
    category: Category
    score: float | None  # probability the item is fake, 0..1; None when n/a
    rank: Rank
    reason_code: str  # e.g. "DIFFUSION_ARTIFACT", "PROVENANCE_AI_DECLARED"
    evidence: str  # one plain-language line for the evidence card
    policy: Policy = Policy.INCLUDE
    decisive: bool = False  # hard evidence (e.g. signed C2PA "AI-generated") that settles the verdict
    details: dict[str, Any] = field(default_factory=dict)
    seconds: float | None = None


@dataclass
class Verdict:
    item_id: str  # sha256 of the file bytes
    filename: str
    media_type: MediaType
    label: str  # "fake" | "real" — the binary call the game requires
    tier: Rank  # three-state summary for the UI: high / uncertain / low
    p_fake: float  # calibrated probability the item is fake (drives the label)
    p_raw: float  # fused score before calibration (what calibration is fitted on)
    confidence: float  # confidence in `label` (p_fake or 1 - p_fake)
    reason_code: str
    reason_text: str
    votes: int
    experimental: bool  # item is outside what our detectors are validated on
    signals: list[Signal]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
