# Deepfake Arena — Research v4: latest (2025–2026) tools only

> **Recency rule (team decision):** only base build choices on repos/models **pushed or released within the last ~12 months**
> (after Oct 2025) and on current docs. Older work may be cited for history or a lesson, never as a dependency.
> This file **overrides the model picks in `RESEARCH_V2_VERIFIED.md` §3**. Researched 27 Oct 2026 via `gh` (code read
> directly), Hugging Face API, **Context7** (Resemble AI, TruthScan, Claude API, transformers, Gradio, mlx-audio, fal,
> scikit-learn, librosa, C2PA spec), and web search.

---

## 1. Stale-source audit of v1–v3

| Item cited earlier | Age | Status now |
|---|---|---|
| `selimsef/dfdc_deepfake_challenge`, `yuezunli/deepfake-o-meter`, DFDC dataset | 2020 | **History/lesson only** (v3 §2). Not a dependency. |
| `clovaai/aasist`, `TakHemlata/SSL_Anti-spoofing` | 2023 | **Drop.** AASIST scores 48% on the Oct 2026 audio benchmark (below chance). |
| HF audio detectors in v2 (`Gustking/...xlsr`, `garystafford/...`, `MelodyMachine/...`, `mo-thecreator/...`) | 2024–25 | **Drop.** 53–63% accuracy on the independent Oct 2026 benchmark (§3.3). |
| `buildborderless/CommunityForensics-DeepfakeDet-ViT` (v2 primary image detector) | model 2025, card Aug 2026 | **Demote to backup.** CommFor-384 scores only 0.744 AUC on real-world Reddit images (§3.2). |
| `haywoodsloan/ai-image-detector-deploy` | Aug 2026 | Backup only; 9.5% false alarms on real Reddit photos. |
| `Organika/sdxl-detector`, `umm-maybe/AI-image-detector` | 2024 | **Drop.** 0.65–0.72 AUC, 14–44% false alarms. |
| `OpenTalker/SadTalker`, `Rudrabha/Wav2Lip`, `coqui-ai/TTS` | 2024–25 | **Drop** for the Forger; use 2026 tools (v2 §4 hosted avatars, `rumik-oss-1`). |
| TrueMedia.org (`deepfake-app`, `ml-models`) | Jan 2025, org closed | **Design lessons only** (voting, Experimental flag, evidence cards — v3 §1.1). Not a dependency. |
| `joonson/syncnet_python`, `GenImage`, `ltnghia/openforensics`, `NPR-DeepfakeDetection`, `ClipBased-SyntheticImageDetection` | 2022–25 | Not used. |
| Deepfake-Eval-2024, Community Forensics (CVPR 2025), AIGIBench, RAID | papers 2024–25 | Still valid **findings**; newer evidence below agrees with them. |

---

## 2. Where the current work lives (indexes to keep checking)

- **`ant-research/Awesome-AIGC-Image-Video-Detection`** (created Mar 2026, pushed Oct 2026, 483★) — the most current curated index for image + video detection.
- **`podonos/audio-dfd-benchmark`** (updated monthly, Oct 2026) — independent audio leaderboard with private gold labels.
- **Smaug model card** (Oct 2026) — a same-test-set comparison of 11 open image detectors on 26,070 images.
- GitHub search pattern that found these: `gh search repos "<topic> created:>2025-03-01" --sort stars`, filtered to `pushedAt > 2026-03`.

---

## 3. Updated Detective stack (all Mac-runnable)

### 3.1 Provenance first — `MatrixA/aicheck` (Mar 2026, Rust, offline, no API key)
Read its README in full. 11 methods, 62 AI tools, 16 formats, 3 confidence levels:
- **HIGH:** C2PA `digitalSourceType = trainedAlgorithmicMedia`, `claim_generator` matching an AI tool (incl. ElevenLabs audio).
- **MEDIUM:** XMP/IPTC (`AISystemUsed`, `DigitalSourceType`, `CreatorTool`), **MP4 container + H.264 SEI watermark markers for Kling, Sora, Runway, Pika, Luma, Hailuo, Pixverse, Vidu, Genmo, Haiper**, Chinese AIGC labels, ID3 (Suno), WAV RIFF info.
- **LOW:** EXIF heuristics (AI `Software` tag + missing camera Make/Model/GPS), PNG text chunks (ComfyUI/A1111 `parameters`/`prompt`), filename patterns (`ElevenLabs_YYYY-...`), **WAV TTS signature (mono + 16/22.05/24 kHz)**, FFT spectral cut-off, DWT-DCT invisible-watermark heuristics, visible corner-label detection.
- Install: `cargo install aicheck` → `aic check file` (Rust is already installed on the dev Mac).
- Use: run on every pool item first; any HIGH hit is a near-certain fake **with a ready-made, correct reason**. Absence of signals proves nothing (Red teams can strip metadata).

### 3.2 Image — `abacusai/Smaug-AI-Image-Detector` (released 16 Oct 2026, Apache-2.0)
- EmbeddingGemma-2 image encoder + linear head, 439M params, **~1 GB, runs on Apple Silicon (Metal) or CPU**. Scores three 528×528 native-resolution crops. Trained with resize/recompress/blur robustness and hard-negative professional photos.
- Trained on **current generators**: GPT-Image 2, Nano Banana Pro, Midjourney 7, Seedream 5, FLUX.2, Z-Image, Recraft, Ideogram, ERNIE-Image, **Sora 2 and Veo 3 frames**, DALL·E 3, Firefly 3.
- Same-test-set comparison (26,070 images, from the model card — **vendor-reported, verify on our own set**):

| Detector | AUC Reddit (real-world) | AUC OpenFake Core | AUC CommunityForensics | Real photos flagged (Reddit / Core / CF) |
|---|---|---|---|---|
| **Smaug** | **0.973** | **0.991** | 0.981 | 3.0% / 1.4% / 0.4% |
| OpenFake-SwinV2 | 0.947 | 0.989 | 0.951 | 2.9% / 2.1% / 3.0% |
| `s-gehring/detectra-openfake` | 0.936 | 0.972 | 0.954 | 2.7% / 1.2% / 2.0% |
| CommFor-384 (our old v2 pick's family) | 0.744 | 0.921 | 0.968 | 2.0% / 0.3% / 4.0% |
| `haywoodsloan` SwinV2 | 0.897 | 0.953 | 0.901 | 9.5% / 1.1% / 10.6% |

- Usage (model card): `snapshot_download("abacusai/Smaug-AI-Image-Detector")`, `from smaug_image_detect import SmaugImageDetect`, `detector("photo.jpg") → probability AI`. Note: it **executes code shipped in the repo** — pin the revision.
- Ensemble partner for voting: **`s-gehring/detectra-openfake`** or OpenFake-SwinV2 (low false-alarm rates, different architecture).
- Lesson from `lynote-ai/ai-image-detector` (May 2026, read in full): their best lever without training was **post-hoc threshold calibration** (balanced-accuracy objective) per detector; on their own smoke test, several popular detectors **false-alarmed on a real photo**. Their strongest setup is an ensemble (`ultra` = UnivFD + Nonescape + Sentry-ConvNeXt).

### 3.3 Audio — `Sadanie/pellav2-audio-deepfake-detector` (Jul 2026, updated Oct 2026, MIT)
- Independent benchmark (`podonos/audio-dfd-benchmark`, Oct 2026, 4,524 clips, gold labels private): **95.82% accuracy, F1 0.959** — the only open-weights model above 95%. The next open model is 70.5%.
  (Caveat: Podonos scored the labels but did not run Pella itself; the vendor confirmed the public checkpoint produced them.)
- Code read: `facebook/w2v-bert-2.0` backbone + head, 16 kHz, loudness normalisation (`pyloudnorm`) and band-pass pre-filter; script **auto-selects `mps`** on Apple Silicon. Weights ~4.6 GB. Deps: `torch torchaudio transformers soundfile numpy scipy pyloudnorm`.
- Benchmark context worth quoting in the pitch: commercial leaders reach 99.9%, but **Reality Defender false-flagged 53.7% of real audio** and Hive missed 30.5% of fakes — pick detectors by which error you can afford. For us that is false alarms (−5).
- Keep the **semantic transcript check** (v3 §4.5) as a second, independent audio signal.

### 3.4 Video — frames + temporal geometry
- **Frames → Smaug** (it was trained on Sora 2 / Veo 3 frames) at 1–2 fps; aggregate mean/max/variance.
- **Temporal signal, cheap and explainable — ReStraV idea** (`ChristianInterno/ReStraV`, NeurIPS 2025, pushed Oct 2026): encode ~24 frames (~2 s) with frozen **DINOv2 ViT-S/14**; real videos trace "straighter" paths in embedding space. A **21-D feature** (7 step distances, 6 turning angles, mean/min/max/var of each) feeds a small classifier. **No released weights** → fit a logistic regression on our own ~30 labelled clips, or use the curvature stats directly as a vote with a calibrated threshold. Reason text: "motion trajectory is unusually curved / jittery for real camera footage".
- **Alternative, training-free — D3** (`Zig-HS/D3`, ICCV 2025, pushed Jun 2026): second-order temporal features on a frozen **XCLIP-16** encoder.
- Watch list (too heavy for a 16 GB Mac / 24 h, but cite in the pitch): **Skyra** (CVPR 2026, grounded artifact reasoning), **VideoVeritas** (ICML 2026), **HAVIC** (CVPR'26 Findings, audio-visual coherence), **X-AVDT** (CVPR 2026, audio-visual cross-attention).

### 3.5 Explanation — borrow Veritas's reasoning structure, run it with Claude
- **Veritas** (`EricTan7/Veritas`, **ICLR 2026 Oral**; extended to images as Veritas++ Jul 2026 and to video as VideoVeritas Feb 2026): an MLLM trained for *pattern-aware reasoning* — fast judgement → reasoning → planning → self-reflection — giving transparent, human-aligned decisions. Its weights need a GPU (Qwen-class MLLM).
- **What we take:** the reasoning *stages* as the structure of our Claude explanation prompt, fed with our detector evidence (Claude stays explainer, not classifier).

### 3.6 Enterprise output schema to copy — Resemble AI Detect (Context7 `/websites/resemble_ai`)
Current enterprise API (`POST /api/v2/detect`), worth mirroring in our verdict JSON:
- `label` + **per-chunk scores** (default 2 s windows) + **`consistency` across chunks** + `aggregated_score`.
- Separate **`score` and `certainty`** per node.
- **Hierarchical video tree:** `VideoResult → ImageResult (timestamp) → Segment` — a natural "timeline + flagged frames" UI.
- `c2pa_manifest` validation, **`audio_source_tracing`** (which platform made the fake voice — our "attribution"), **`intelligence`** (MLLM description of speaker/emotion/context — our Claude layer), **`use_ood_detector`** (out-of-distribution flag ≈ TrueMedia's "Experimental"), `zero_retention_mode`.
- They also ship **`resemble-ai/detect-skill`** (Apr 2026), an agent skill for Claude Code and others — shows the current industry pattern: detection exposed as an agent tool.

---

## 4. Net changes to the build plan

| Area | v2 pick | **v4 pick (latest)** |
|---|---|---|
| Provenance | C2PA skipped / `c2pa-python` | **`aicheck`** (Rust CLI, run first) |
| Image | CommunityForensics ViT | **Smaug** + `detectra-openfake` (vote), CommunityForensics as backup |
| Audio | wav2vec2 HF models | **pellav2** + semantic transcript check |
| Video temporal | frame-score variance only | + **ReStraV-style DINOv2 curvature** (or D3) |
| Explanation prompt | free-form | **Veritas-style staged reasoning** over our evidence |
| Verdict JSON | flat | **Resemble-style:** chunk scores, consistency, certainty, hierarchy, OOD flag |
| Calibration | Platt on fused score | + **per-detector threshold calibration** (lynote lesson) |

Memory check (16 GB): Smaug ~1 GB + detectra (~0.4 GB) + pellav2 (~4.6 GB on disk; w2v-bert-2.0 is ~0.6B params) + DINOv2 ViT-S (~0.1 GB) + Whisper turbo → fits if loaded per modality, not all at once.

## 5. Still to research with the same recency rule
1. **Text** — latest AI-text detectors (2026) and a benchmark like podonos for text; `desklib` (Feb 2025) is at the edge of the window.
2. **Forger** — current 2026 generators (image edit for persona consistency, talking-avatar, Indic TTS) and which ones embed watermarks/C2PA (so we know what to strip and what other teams will forget).
3. Verify Smaug's numbers on our own small real/fake set before trusting them.

## Sources (all read this session)
- Smaug-AI-Image-Detector — https://huggingface.co/abacusai/Smaug-AI-Image-Detector
- pellav2 — https://huggingface.co/Sadanie/pellav2-audio-deepfake-detector ; audio benchmark — https://github.com/podonos/audio-dfd-benchmark
- aicheck — https://github.com/MatrixA/aicheck
- lynote ai-image-detector — https://github.com/lynote-ai/ai-image-detector
- ReStraV — https://github.com/ChristianInterno/ReStraV ; D3 — https://github.com/Zig-HS/D3
- Veritas — https://github.com/EricTan7/Veritas (paper https://arxiv.org/pdf/2508.21048)
- Resemble Detect API — Context7 `/websites/resemble_ai` (https://docs.resemble.ai/api-reference/deepfake-detection/create-detection) ; detect-skill — https://github.com/resemble-ai/detect-skill
- Index — https://github.com/ant-research/Awesome-AIGC-Image-Video-Detection
- Other 2026 repos noted: OmniAID (ICML 2026), GenShield (ICML 2026), MIRROR, GenD (WACV 2026), Skyra (CVPR 2026), VideoVeritas (ICML 2026), HAVIC, X-AVDT (CVPR 2026), DeepFense (audio framework, Oct 2026)
