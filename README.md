# Corncam

**Deepfake Arena (X AI Tech Ideathon, problem statement 3): a Forger (Red) and a Detective (Blue) for image, video, audio and text.**
Corncam's Detective tells real from fake, shows **why**, and states how sure it is. It runs **fully offline on a laptop**
(Apple M4, 16 GB): no media ever leaves the machine, which matches the arena rule that fakes never leave the hackathon.

## Results so far (measured on our machine)

OpenFake Reddit test set: real-world Reddit images plus fakes from current generators. 100 items (50 real / 50 fake), seed 1:

| Version | AUC | Accuracy | False alarms on reals | Missed fakes | Brier | Game points* | Speed |
|---|---|---|---|---|---|---|---|
| v1: provenance + Smaug | 0.952 | 89% | 4% | 18% | 0.076 | +312 | 2.6 s/img |
| v2: heuristic watermark signals demoted | 0.968 | 89% | 0% | 22% | 0.092 | +312 | 2.7 s/img |
| **v3: + Platt calibration** (fit on a separate seed-2 sample, no overlap) | **0.968** | **90%** | 4% | **16%** | **0.065** | **+320** | 2.7 s/img |

Calibration makes the stated confidence trustworthy (Brier 0.092 → 0.065). It assumes the tuning set's fake share. Set `CORNCAM_FAKE_PRIOR` to the arena pool's real fake share once the organizers announce it.

\*Arena scoring applied to the sample: +5 catch, +3 real cleared, −5 false alarm, −3 miss.

**Audio (pellav2, multi-window).** Tested on the garystafford deepfake-audio sample v4: 80 clips, 40 fake across 6 TTS/clone sources (dataset codes el, hg, hu, lv, po, sp) and 40 real. Every source scored 100%.

| AUC | Accuracy | False alarms | Missed | Brier | Game points | Speed |
|---|---|---|---|---|---|---|
| 1.000 | 100% | 0% | 0% | 0.0001 | +320 | 1.6 s/clip |

Read this as an upper bound. A perfect score on a public sample may mean overlap with pellav2's training data. Our own Forger's voices (rumik/Indic TTS, Kokoro) are the real test.
Both v1 false alarms came from a pixel-heuristic watermark check. v2 keeps such checks as weak evidence that can never decide a verdict alone.

## How it works

```
file ─► ingest (sha256, media type; originals never modified)
     ─► signals
          provenance   C2PA "trainedAlgorithmicMedia" markers, AI-tool names in EXIF/XMP/PNG/container tags,
                       camera EXIF, aicheck CLI (incl. Kling/Sora/Runway video markers)
          image        Smaug-AI-Image-Detector (Oct 2026, trained on GPT-Image 2, FLUX.2, Nano Banana Pro, Sora 2/Veo 3 frames)
          (next)       faces: GenD (WACV 2026) · audio: pellav2 (95.8% on an independent benchmark) · video · text
     ─► fusion
          explainable tier   TrueMedia.org-style voting: detectors vote, trusted ones twice; "uncertain" band;
                             noise-only or out-of-scope evidence is demoted (false-alarm brake)
          binary call        fused P(fake), call "fake" at ≥ 0.5 (expected-value break-even under arena scoring)
     ─► explanation  plain language from computed signals only: what was found, why it is unusual,
                      the innocent explanation to rule out, and how sure we are
```

Design choices are backed by research in `docs/`. See `RESEARCH_V4_LATEST_2026.md` for the tools and `RESEARCH_V3_REAL_WORLD.md` for how TrueMedia.org, Reality Defender and India's Deepfakes Analysis Unit work.

## Run it

```bash
uv sync                         # Python 3.12, torch with Apple Metal (MPS)
cargo install aicheck           # optional provenance CLI
make models                     # pre-download pinned detector weights

uv run corncam detect photo.jpg            # verdict card in the terminal (--json for machine output)

# Web dashboard (React 19 + shadcn/ui + Magic UI, liquid-glass design)
#   Overview · Detective · Evidence Pool (import → analyse all → export submission CSV/JSON)
#   · Benchmark · Forger / Scoreboard / Report (next). ⌘K jumps between pages.
make api                                   # terminal 1: FastAPI on 127.0.0.1:8000
cd web && pnpm install && cd ..
make web                                   # terminal 2: open http://localhost:5173

uv run corncam serve                       # fallback Gradio UI at http://127.0.0.1:7860
uv run corncam eval <labelled.parquet> -n 50 --seed 1   # metrics report → data/eval/
make test lint
```

## Rules we enforce in code

- Synthetic personas only; generated fakes never leave the machine. A Claude Code hook blocks media uploads, and `.gitignore` excludes all media and `data/`.
- Every verdict carries a verdict, a confidence and a reason grounded in computed signals. No invented evidence.
- Confidence is clamped to 1–99%: no detector is certain.
