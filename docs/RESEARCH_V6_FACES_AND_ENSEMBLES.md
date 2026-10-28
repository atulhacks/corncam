# Research v6 — why two of three test fakes passed, and how production systems avoid it

> Trigger: a manual test (27 Oct 2026). Of four images, three were AI-made; Corncam called only the stylised 3D
> render fake. A **photoreal face** and a **photoreal object scene** both passed as REAL (Smaug < 1%).
> Sources read this round: Hive, Sightengine and Resemble docs via **Context7**; GenD `detector.py`;
> VeridisQuo and rustyneuron01 READMEs via `gh`. Recency rule applies.

## 1. What every production system does: two image models, not one

| Service (Context7) | Whole-image "AI-generated" model | Face "deepfake" model | Extras |
|---|---|---|---|
| **Hive** | generation head (ai_generated / not) + **source head over 100+ generators** (flux2, gptimage1_5, seedream, qwen, zimage, gemini3, sora2, veo3, …) | **detects every face, classifies each, returns the highest face score** | C2PA metadata; "view the response holistically" |
| **Sightengine** | `genai` model (fully generated or AI-edited) | separate **Deepfake Detection** model for swapped/modified faces in otherwise real photos | **Recapture detection** (photo of a screen) — complementary; "combined in a single API call" |
| **Resemble** | image detection | `image_metrics.type = "facial"`; `face_only` mode for video | heatmaps, OOD detector |

**Corncam gap:** we run only the whole-image model (Smaug). No face model, no second whole-image opinion.

## 2. Open-source implementations (2026, active)

- **GenD** (WACV 2026) — `detector.py`: RetinaFace → 5 landmarks → similarity transform to a fixed 5-point
  template with **1.3× context**, 256×256 (`align_face`, MIT). Model: CLIP-L/14 with LayerNorm-only tuning.
- **VeridisQuo** (★67, Jan 2026) — face detection → face extraction → **spatial stream** (EfficientNet-B4) +
  **frequency stream** (FFT 8 radial bands, DCT 8×8 blocks) → fusion MLP.
- **rustyneuron01/AI-Generated-Content-Detection** (★90, ⑂52, Mar 2026) — DINOv3 + LoRA for images; GenD-style
  and ReStraV-style video. Key lesson in its README: *heavy fine-tuning gave strong validation accuracy but poor
  results on unseen real domains*; frozen / LayerNorm-only / LoRA backbones and many generators fixed it.

## 3. What we build (in this order)

1. **Face branch (Hive/Sightengine pattern):** OpenCV **YuNet** (`cv2.FaceDetectorYN`, 5 landmarks, no new
   dependency) → GenD's `align_face` (same template, 1.3×, 256×256) → **GenD CLIP-L** → per-face score →
   **max over faces** → `Category.FACES`, trusted. No face → `n/a`, never a guess.
2. **Second whole-image opinion** (NTIRE 2026: two decorrelated branches; TrueMedia: ensembles) — a different
   architecture from Smaug, chosen from v4's same-test-set table (OpenFake-SwinV2 / detectra-openfake).
3. **Frequency evidence** (VeridisQuo): FFT radial-band energy as an explainable visual-noise signal.
4. Later: **recapture detection** (Sightengine) — screen re-photographs are a cheap laundering trick.

Every new branch is measured on held-out data before it is trusted (Benchmark page), and calibration stays
per media type.

## Sources
- Hive docs — https://docs.thehive.ai/docs/ai-image-and-video-detection (Context7 `/llmstxt/thehive_ai_llms_txt`)
- Sightengine — https://sightengine.com/docs/deepfake-detection (Context7 `/websites/sightengine`)
- Resemble — https://docs.resemble.ai/detect (Context7 `/websites/resemble_ai`)
- GenD — https://github.com/yermandy/GenD (`detector.py`, `align_face`)
- VeridisQuo — https://github.com/VeridisQuo-orga/VeridisQuo
- rustyneuron01 — https://github.com/rustyneuron01/AI-Generated-Content-Detection
