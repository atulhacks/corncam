"""Plain-language explanations built only from computed signals (no invented evidence).

Every explanation states: what was found, why it is unusual, and an innocent explanation where one
exists. A local LLM can later rewrite this text for fluency, but must not add facts.
"""

from __future__ import annotations

from collections.abc import Sequence

from corncam.schema import Rank, Signal

TIER_SUMMARY = {
    Rank.HIGH: "Substantial evidence this is AI-generated or manipulated",
    Rank.UNCERTAIN: "Uncertain: could be authentic or manipulated",
    Rank.LOW: "Little evidence of manipulation",
}

INNOCENT = {
    "DIFFUSION_ARTIFACT": "Heavy filters, beauty modes or AI upscaling on a real photo can leave similar traces.",
    "PROVENANCE_AI_TOOL": "A real photo edited in an AI-capable app can carry that app's name in its metadata.",
    "PROVENANCE_AI_MARKER": "Some tools tag files even for small AI-assisted edits of real photos.",
    "PROVENANCE_AI_DECLARED": "Content Credentials can also mark partial AI edits; check whether the whole item is synthetic.",
    "NO_STRONG_SIGNAL": "Detectors miss some fakes, especially after compression or re-recording.",
    "FACE_MANIPULATION": "Beauty filters, heavy retouching or low-light phone processing can alter a real face in similar ways.",
    "TTS_ARTIFACT": "Heavy noise suppression, voice-changer apps or low-bitrate calls can make a real voice sound synthetic.",
    "SPLICED_AUDIO": "Editing cuts, music or a change of speaker can also make parts of a real clip score differently.",
    "AI_GENERATED_VIDEO": "Heavy stabilisation, beauty filters or AI upscaling in phone video can leave similar traces.",
    "WATERMARK_HEURISTIC": "Ordinary JPEG compression and camera processing can mimic these pixel patterns.",
}


def confidence_words(p: float) -> str:
    c = max(p, 1 - p)
    if c >= 0.9:
        return "strong evidence"
    if c >= 0.7:
        return "likely"
    return "leaning, not certain"


def explain(label: str, tier: Rank, p_fake: float, top: Signal | None, signals: Sequence[Signal],
            experimental: bool, calibration_driven: bool = False) -> str:
    parts = [f"{TIER_SUMMARY[tier]} ({confidence_words(p_fake)}; {p_fake:.0%} estimated chance of being fake)."]
    if calibration_driven:
        parts.append(
            "No single detector is decisive here; the call comes from calibration on held-out data, where items "
            f"scoring like this one were {'fake' if label == 'fake' else 'real'} {max(p_fake, 1 - p_fake):.0%} of the time."
        )
    if top is not None:
        parts.append(f"Strongest evidence: {top.evidence}")
        if label == "fake" and (innocent := INNOCENT.get(top.reason_code)):
            parts.append(f"Innocent explanation to rule out: {innocent}")
    # The remaining checks are listed signal-by-signal alongside the verdict (CLI table / UI evidence cards).
    if experimental:
        parts.append("Note: this media type is not yet fully covered by our detectors, so treat the result with caution.")
    return " ".join(parts)
