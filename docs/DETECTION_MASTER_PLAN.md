# Corncam detection master plan — cover every forgery type, then win on accuracy

> Source of truth for detector work (27 Oct 2026). Builds on research v4–v6. Rule: nothing is "done" until it is
> **measured on held-out data** and shown on the Benchmark page.

## 1. What other teams will submit (forgery taxonomy) → what catches it

| # | Forgery type | Likely tool used by teams | Corncam signal | Status |
|---|---|---|---|---|
| 1 | Fully AI-generated photo (persona portrait, scene) | Nano Banana / GPT-Image / FLUX / Seedream / Qwen-Image | **Smaug** (whole image) | ✅ 0.968 AUC held-out (OpenFake Reddit) |
| 2 | Same, laundered (JPEG, resize, screenshot, re-photo) | any + re-save | Smaug (robust-trained) + **2nd whole-image model** (decorrelated) + **recapture check** | ⚠️ single model; your object photo slipped |
| 3 | Face swap on a photo | BFS-Best-Face-Swap (Qwen-Image-Edit / FLUX.2), FaceFusion, Deep-Live-Cam | **GenD face branch** (YuNet → aligned crop → GenD, max over faces) + **DF40 CLIP-L** (trained on 40 methods incl. InSwapper/e4s/BlendFace/UniFace) | ⚠️ GenD verified but misses modern swaps (0.17–0.29 on user swaps); DF40 being verified |
| 4 | Face/attribute edit (expression, age, inpainting) | Qwen-Image-Edit, Nano Banana edit | GenD (FF++ includes Face2Face/NeuralTextures expression manipulation) + Smaug (AI-edited) | 🔧 |
| 5 | Talking-head video from one photo | Kling Avatar, OmniHuman, Hallo, LivePortrait | frames → Smaug + GenD; **temporal**: ReStraV curvature; **lip-sync**: mouth-open (MediaPipe jawOpen) × audio envelope cross-correlation; **blink / expression jitter** from blendshapes | ❌ next |
| 6 | Lip-sync dub of a real video | LatentSync, Wav2Lip | **lip-sync mismatch** (above) — the brief's own example reason | ❌ next |
| 7 | Fully generated video | Veo 3, Sora 2, Kling | Smaug on frames (trained on Sora 2/Veo 3 frames) + ReStraV + aicheck SEI markers | ❌ next |
| 8 | Synthetic voice (TTS / clone) | ElevenLabs, rumik/Indic TTS, Kokoro | **pellav2** (95.8% independent) multi-window | ✅ 80/80 on garystafford v4 (6 sources); treat as an upper bound, still to test on our own Forger voices |
| 9 | Partly synthetic / spliced audio | edit + TTS insert | pellav2 per-window spread → SPLICED_AUDIO | 🔧 built |
| 10 | AI-written text post | Claude / GPT / Gemini, human-edited | text detector (2026 pick pending) + persona-consistency check | ❌ |
| any | Unstripped provenance | C2PA, XMP, SEI, ElevenLabs filenames | **aicheck** + built-in scan | ✅ decisive when present |

## 2. How we beat the other teams

1. **Train on the arena's own distribution (self-play).** Every team uses the same handful of popular tools
   (row "Likely tool"). Our Forger generates hundreds of persona fakes with *those exact tools*, plus laundered
   variants; we fine-tune small heads on frozen encoders (GenD LayerNorm-only recipe; NTIRE/rustyneuron lesson:
   light tuning generalises, heavy tuning overfits). Public detectors are trained on yesterday's generators; ours
   learns this arena's.
2. **Two decorrelated branches per modality** (NTIRE 2026 2nd place; Hive/Sightengine): whole-image + face for
   images; frames + temporal + lip-sync + voice for video. Fuse with per-type calibrated logistic regression.
3. **Provenance first** — free, decisive catches when a team forgets to strip metadata.
4. **Correct reasons (+3 each).** Reason codes map to the *method* (FACE_MANIPULATION, LIPSYNC_MISMATCH,
   TTS_ARTIFACT, DIFFUSION_ARTIFACT), which is what "correct reason" is judged on.
5. **Few false alarms (−5).** Experimental/out-of-scope demotion, calibrated threshold, prior set to the pool's
   real fake share (`CORNCAM_FAKE_PRIOR`).

## 3. Execution order (accuracy per hour)

1. Finish & **verify GenD** (label order on GenD's own samples) → re-run the user's 4 test images.
2. **Audio held-out eval** (80 clips, 6 generators) → audio calibration.
3. **2nd whole-image model** (OpenFake-SwinV2 or detectra-openfake) + fusion → re-measure images.
4. **Video**: frames (Smaug+GenD) + MediaPipe lip-sync + blink/jitter + ReStraV → eval on current-gen video.
5. **Self-play fine-tuning** once the Forger produces arena-style fakes.
6. Text detector (2026 pick) + persona consistency.
7. Explanations: Grad-CAM (pytorch-grad-cam, EigenGradCAM/HiResCAM) on face crops, on demand.

## Research notes
- Audio-visual 2026 detectors (HAVIC CVPR'26 Findings, X-AVDT CVPR'26, ICS-AV ICCV'25) need gated datasets
  (LRS2, FakeAVCeleb, VoxCeleb2) or Hallo feature extraction and ship no ready weights → not feasible in 24 h on
  an M4. We implement their core idea (audio-visual coherence) directly with landmarks + audio envelope.
