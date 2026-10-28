"""What the Detective runs for each media type, described for the UI's Pipeline view.

Detector names match the Signal names the detectors emit, so the UI can overlay a real verdict's trace on this map.
Keep this in step with detect.collect_signals; tests/test_pipeline.py checks that every emitted name is described.
"""

from __future__ import annotations

import shutil
from typing import Any

from corncam import calibrate
from corncam.signals import face

TRUST, INCLUDE, IGNORE = "trust", "include", "ignore"

_PROVENANCE = {
    "category": "provenance", "title": "Provenance",
    "question": "Does the file declare that it was AI-made?",
    "detectors": [
        {"name": "Content Credentials (C2PA)", "model": "built-in C2PA manifest reader", "policy": TRUST,
         "looks_for": "A signed manifest declaring the file AI-generated (decisive: settles the verdict)"},
        {"name": "Metadata scan", "model": "built-in C2PA / EXIF / PNG text / ffprobe scan", "policy": INCLUDE,
         "looks_for": "Content Credentials (trainedAlgorithmicMedia), generator names, prompts left in metadata"},
        {"name": "aicheck metadata", "model": "aicheck CLI", "policy": TRUST,
         "looks_for": "AI markers in embedded metadata; signed C2PA settles the verdict outright"},
        {"name": "aicheck format hint", "model": "aicheck CLI", "policy": IGNORE,
         "looks_for": "File formats typical of AI output (shown for context, never votes)"},
    ],
}
_NOISE = {
    "category": "visual_noise", "title": "Pixel noise",
    "question": "Are there invisible-watermark patterns in the pixels?",
    "detectors": [
        {"name": "aicheck pixel heuristics", "model": "aicheck CLI", "policy": INCLUDE,
         "looks_for": "Watermark-like frequency patterns (weak: can fire on real photos)"},
    ],
}

MEDIA: dict[str, dict[str, Any]] = {
    "image": {
        "summary": "Two decorrelated opinions, as Hive and Sightengine do: is the whole picture generated, "
                   "and has any face been swapped or edited?",
        "lanes": [
            _PROVENANCE,
            {"category": "generative_ai", "title": "Whole image",
             "question": "Was the whole picture made by an AI generator?",
             "detectors": [{"name": "Smaug AI-image detector", "model": "abacusai/Smaug-AI-Image-Detector",
                            "policy": TRUST, "measured": "0.968 AUC on held-out Reddit images",
                            "looks_for": "Traces of current generators (GPT-Image, Nano Banana, FLUX, Seedream)"}]},
            {"category": "faces", "title": "Faces",
             "question": "Was any face swapped or edited? (each face scored, the worst decides)",
             "detectors": [
                 {"name": "GenD face-forgery detector", "model": "yermandy/GenD_CLIP_L_14 (WACV 2026)",
                  "policy": TRUST, "looks_for": "Blending and identity artefacts on the aligned face crop"},
                 {"name": "DF40 face-forgery detector", "model": "DF40 CLIP-L (CUHK-Shenzhen, 40 methods)",
                  "policy": IGNORE, "looks_for": "Modern swap traces (shown only: it called a known-real face fake)"},
             ]},
            _NOISE,
        ],
    },
    "video": {
        "summary": "Eight evenly spaced frames go through the image detectors; the soundtrack goes through the "
                   "voice detector. Video is marked experimental until it is measured on held-out clips.",
        "lanes": [
            _PROVENANCE,
            {"category": "generative_ai", "title": "Frames",
             "question": "Are the frames AI-generated? (median over 8 frames)",
             "detectors": [{"name": "Smaug on video frames", "model": "abacusai/Smaug-AI-Image-Detector",
                            "policy": INCLUDE, "looks_for": "Generator traces in each sampled frame"}]},
            {"category": "faces", "title": "Faces over time",
             "question": "Is a face swapped or lip-synced? (mean of the 3 worst frames)",
             "detectors": [{"name": "GenD on video faces", "model": "yermandy/GenD_CLIP_L_14", "policy": INCLUDE,
                            "looks_for": "Face-manipulation artefacts frame by frame"}]},
            {"category": "voice", "title": "Soundtrack",
             "question": "Is the voice synthetic or spliced?",
             "detectors": [{"name": "pellav2 synthetic-voice detector", "model": "Sadanie/pellav2 (w2v-BERT 2.0)",
                            "policy": TRUST, "looks_for": "TTS and voice-clone traces in up to 6 speech windows"}]},
            _NOISE,
        ],
    },
    "audio": {
        "summary": "Speech is found first (Silero VAD); music or tones are never judged as a voice. Up to six "
                   "4-second windows are scored, and a large spread between windows flags splicing.",
        "lanes": [
            _PROVENANCE,
            {"category": "voice", "title": "Voice",
             "question": "Is the voice synthetic or spliced?",
             "detectors": [{"name": "pellav2 synthetic-voice detector", "model": "Sadanie/pellav2 (w2v-BERT 2.0)",
                            "policy": TRUST, "measured": "80/80 on 6 TTS and voice-clone sources",
                            "looks_for": "TTS and voice-clone traces in each speech window"}]},
        ],
    },
    "text": {"summary": "Text detection is planned; text items get provenance checks only.", "lanes": [_PROVENANCE],
             "planned": True},
}

STEPS = {
    "ingest": "Hash the file (sha256) and identify its type. The original is never modified.",
    "fusion": "High-scoring detectors cast votes (trusted ones count twice); scores are averaged in logit space. "
              "Detectors marked 'shown only' never vote.",
    "calibration": "A Platt fit on a separate tuning set turns the fused score into an honest probability.",
    "verdict": "Fake only if the probability is above 50%; a tie or no evidence is called real, because a false "
               "alarm costs more (-5) than a miss (-3).",
}


def describe() -> dict[str, Any]:
    from corncam.detect import CALIBRATED, COVERED

    covered = {str(m) for m in COVERED}
    calibrated = {str(m) for m in CALIBRATED}
    cal = calibrate.load()
    return {
        "steps": STEPS,
        "media": {
            m: {**spec, "covered": m in covered, "calibrated": m in calibrated and cal is not None}
            for m, spec in MEDIA.items()
        },
        "available": {"aicheck": shutil.which("aic") is not None, "df40": face.DF40_CKPT.is_file()},
    }
