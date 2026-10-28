# Deepfake Arena — Research v5: how reputable detectors work, and our own model

> Question from the team: *do we need to create our own model?* and *what methods do the reputable, actively maintained projects use?*
> Researched 27 Oct 2026: repo reputation via `gh` (stars, forks, last push), methods read from each repo's code/README,
> DeepfakeBench and DINOv3 via **Context7**. Follows the recency rule in `CLAUDE.md`.

---

## 1. Does the problem statement require us to build a model?

**No — but building one is how we stand out.** The brief asks for:
- *Detective:* "an AI system that tells real from fake and explains why" that outputs verdict, confidence and reason.
- *Forger:* "a pipeline to generate synthetic media from the provided personas".
- Deliverables: "Working Forger and Detective prototypes".

Nothing says "train a model from scratch". A system built on pretrained models is fully valid.
Training a large detector from scratch is also **not feasible** on a base M4 in 24 h, and would lose to existing models.

**What is feasible, and what the best projects actually do (§3):** keep a big pretrained encoder **frozen** and train a **small head** on its features. That trains in minutes on a Mac, on data our own Forger produces. It lets us honestly say *"we trained our own detection model"* and adapt it to things public detectors miss (Hindi/Indic TTS, our personas, current generators, laundering).

---

## 2. Reputable, actively maintained projects (stars / forks / last push)

| Repo | ★ | Forks | Last push | Domain | Method family |
|---|---:|---:|---|---|---|
| `SCLBD/DeepfakeBench` | 1,135 | 196 | Aug 2025 (edge of window) | Face deepfake | Benchmark of 36 detectors (28 image, 8 video) |
| `zhipeixu/FakeShield` (ICLR 2025) | 628 | 40 | Feb 2026 | Image forgery | **MLLM explanation + localisation** |
| `laiyingxin2/DADF` | 463 | 3 | Jan 2026 | Face forgery | SAM adapter for localisation |
| `Ekko-zn/AIGCDetectBenchmark` | 436 | 36 | Mar 2026 | AI images | Benchmark of AIGC image detectors |
| `WisconsinAIVision/UniversalFakeDetect` (CVPR 2023) | 379 | 60 | Aug 2026 | AI images | **Frozen CLIP + linear probe** |
| `YZY-stack/Effort-AIGI-Detection` (ICML 2025 Oral) | 240 | 29 | Jul 2025 | AI images / faces | **Frozen CLIP + tiny SVD-residual tuning** |
| `shilinyan99/AIDE` | 344 | 25 | Jun 2025 | AI images | **Semantic + low-level frequency experts** |
| `scu-zjz/ForensicHub` (NeurIPS 2025) | 231 | 28 | Sep 2026 | All image forensics | Unified codebase + cross-domain leaderboard |
| `liamdugan/raid` (ACL 2024) | 224 | 105 | Oct 2026 | AI text | Largest text-detection benchmark |
| `chenhaoxing/DeMamba` | 196 | 12 | Sep 2026 | AI video | Spatio-temporal Mamba on GenVideo (1M videos) |
| `bcmi/SSP-AI-Generated-Image-Detection` | 160 | 15 | Mar 2026 | AI images | **Single simplest patch noise** |
| Foundation encoders: `facebookresearch/dinov3` | 11,636 | 983 | Jul 2026 | — | Frozen features used by detectors |
| `mlfoundations/open_clip` | 14,225 | 1,325 | Oct 2026 | — | CLIP backbones used by UnivFD/AIDE/Effort |

Plus the strongest 2026 single models from v4: Smaug (image), pellav2 (audio), ReStraV (video).

---

## 3. The methods, explained as concepts

### 3.1 Frozen foundation model + linear probe — UnivFD (CVPR 2023), still the reference baseline
- Pass the image through **CLIP ViT-L/14 with the backbone frozen** (`--fix_backbone`: "only the linear layer's parameters will be trained").
- CLIP's feature space was never trained for real-vs-fake, which is exactly why it **generalises to unseen generators**: the classifier can't overfit to one generator's artifacts.
- Smaug (Oct 2026, current #1 open image detector) is the same idea: **EmbeddingGemma-2 encoder + a linear classifier**, plus robustness augmentation and hard-negative real photos.

### 3.2 Parameter-efficient tuning in an "orthogonal subspace" — Effort (ICML 2025 Oral)
- Take each weight matrix of a ViT (e.g. CLIP), run **SVD**: `U, S, Vh = svd(W)`.
- **Freeze the top-r singular components** (the pretrained knowledge) and **train only the small residual components**.
- Why it matters: full fine-tuning collapses the feature space onto the training generators (overfitting); training only the residual keeps the general knowledge and adds just the fake-specific directions. Plug-and-play on any ViT.

### 3.3 Two kinds of evidence, fused — AIDE (hybrid experts)
- **Semantic expert:** CLIP features catch content/semantic errors (wrong hands, impossible lighting).
- **Low-level expert:** pick image patches by **DCT frequency content** (highest/lowest frequency patches) and classify their noise pattern with a ResNet.
- Built after finding that 9 off-the-shelf detectors called nearly all hard AI images ("Chameleon" dataset) **real**.
- SSP is the extreme version: classify only the **single simplest patch**'s noise fingerprint, since generators leave consistent noise in flat regions.

### 3.4 Temporal geometry for video — ReStraV (NeurIPS 2025), DeMamba
- ReStraV: embed ~24 frames with frozen **DINOv2**; real footage moves along "straighter" trajectories in feature space; a 21-number curvature/distance vector + small classifier separates them.
- DeMamba: a spatio-temporal Mamba model over frame zones, trained on the million-video GenVideo set (too heavy for us; concept = look at **local zones over time**).

### 3.5 Explanation + localisation with an MLLM — FakeShield (ICLR 2025), Veritas (ICLR 2026)
- FakeShield: an MLLM produces a **tampered-region mask + human-readable explanation** of pixel-level artifacts and semantic inconsistencies; **"domain tags"** tell it which manipulation family to look for (copy-move, splicing, DeepFake, AI-generated). Dataset built by having GPT-4o write descriptions for image-mask pairs.
- Veritas: staged reasoning (fast judgement → reasoning → planning → self-reflection).
- Concept for us: give Claude our detectors' evidence plus a **domain tag** (which forgery family we suspect) and ask for staged reasoning → better, method-specific "reason" text.

### 3.6 The engineering pattern — DeepfakeBench / ForensicHub
DeepfakeBench (via Context7) defines every detector with the same interface:
`build_backbone` → `features(x)` → `classifier(features)` → `forward` returns `{cls, prob, feat}`, with `get_losses` and `get_train_metrics` (AUC, EER, ACC, AP).
Categories: naive CNNs, **spatial** (incl. `clip`, `effort`), **frequency** (`f3net`, `spsl`, `srm`), **video** (`xclip`, `videomae`, `altfreezing`, …).
→ We copy this interface so every signal (ours and third-party) plugs into the same fusion and UI.

**The common thread:** the best generalising detectors **do not train big networks**. They use a strong frozen encoder, add a small trainable part, and combine **semantic** and **low-level** evidence.

---

## 4. Our own model — "Arena Detective" (feasible on M4 in 24 h)

```
                   ┌──────────── frozen encoders (no training) ────────────┐
image / frames ──► │ CLIP ViT-L/14 (open_clip)  · DINOv3 ViT-S/B  · Smaug  │──► embeddings + Smaug score
                   │ low-level: simplest-patch SRM/DCT noise stats (numpy) │──► noise features
video frames   ──► │ DINOv2/v3 trajectory → ReStraV 21-D curvature         │──► temporal features
audio          ──► │ w2v-BERT-2.0 (pellav2 backbone) embeddings + pellav2  │──► audio features
text           ──► │ text detector score + Claude semantic/persona check   │──► text features
provenance     ──► │ aicheck (C2PA / SEI / EXIF / WAV signature)           │──► hard evidence flags
                   └────────────────────────────────────────────────────────┘
                                    │
                    OUR TRAINED PARTS (minutes on M4, scikit-learn / tiny torch)
                    1. Linear probes per modality on frozen embeddings (UnivFD idea)
                    2. Low-level noise head (AIDE/SSP idea)
                    3. Calibrated fusion meta-model, Platt scaling (v2 §3)
                                    │
                    Explainable layer: TrueMedia-style votes + evidence cards
                    Claude: domain-tag + staged reasoning (FakeShield/Veritas idea) → reason text
```

**Why train our own heads (not just use Smaug/pellav2):**
1. **Domain shift we know about:** public audio detectors drop to ~26% on unseen languages (v2 §2). Our Forger makes Hindi/Indic TTS (`rumik-oss-1`) — a head trained on *that* closes the gap.
2. **Current generators + laundering:** our self-play loop (v3 §4.4) produces labelled fakes from today's tools, before and after JPEG/re-record laundering.
3. **Persona-specific:** the game uses fixed synthetic personas; a probe trained on persona media learns what *their* fakes look like.

**Training data (self-generated, all synthetic or our own real captures):**
- Fakes: everything the Forger generates during the self-play loop (several per persona per modality, plus laundered variants).
- Reals: team-captured phone photos/videos/voice notes of objects, rooms and scenery (no other people), plus public-domain/CC0 samples. Real items in the game are likely phone media, so this is the right "real" class.
- Target size: ~150–300 items per class per modality. Linear probes on frozen features work with this; cache embeddings once, train in seconds.
- Split by **generator/persona**, not randomly, so validation measures generalisation (the DFDC lesson).

**Stretch (only if time):** Effort-style SVD-residual fine-tune of CLIP on MPS — the strongest research method we could reproduce, but risky in 24 h.

**Pitch line:** "Our Detective is our own trained model: frozen foundation encoders with heads we trained on media our own Forger produced — the same recipe as UnivFD, Effort and Smaug, adapted to Indian languages and to the arena's personas — fused with provenance checks and explained by Claude."

---

## 4b. Newest face-deepfake models and codebases (late 2025 – 2026)

| Project | When | What it is | Usable by us? |
|---|---|---|---|
| **GenD** — `yermandy/GenD` (★70, ⑂12), WACV 2026, arXiv 2508.06248 | weights Nov 2025, code Apr 2026 | Fine-tunes **only LayerNorm parameters (0.03%)** of a foundation encoder, L2-normalised (hyperspherical) features + metric learning. SOTA average cross-dataset AUROC over **14 benchmarks (2019–2025)**. | **Yes — top pick for faces.** HF weights `yermandy/GenD_CLIP_L_14` (2.6k dl), `GenD_PE_L`, `GenD_DINOv3_L`; inference needs only `torch` + `transformers` (`GenD.from_pretrained(...)`); expects **face crops** (repo has `detector.py`). Gradio app included. Training data on HF (`yermandy/GenD`). |
| **Veritas / Veritas++ / VideoVeritas** — `EricTan7` | ICLR 2026 Oral; Jul 2026; ICML 2026 | MLLM pattern-aware reasoning detectors (faces → images → video). | Too heavy to run locally; borrow reasoning structure (§3.5). |
| **NTIRE 2026 Robust Deepfake Detection** (CVPR 2026 workshop, arXiv 2604.24163) | Apr 2026 | 337 participants, 57 final entries; tested under common + uncommon degradations; private re-scoring against overfitting. Winners: **large foundation models + ensembles + degradation training**. 2nd place (LOGER): two branches with different granularity/backbone so errors decorrelate. | Method lesson. |
| **NTIRE 2026 Robust AI-Generated Image Detection in the Wild** — `msu-video-group/NTIRE-2026-DeepFake-Detection` | Jan–Apr 2026 | ~**277k labelled train images** (20 generators, 12 transforms) on HF `deepfakesMSU/NTIRE-RobustAIGenDetection-train` (6 shards of 50k); distortion pipeline script released; tests on Nano Banana Pro, GPT Image 1.5, Seedream 5, FLUX-2. Metric: robust ROC AUC (after transforms) + clean AUC. 4th place (HEDGE): **DINOv3 + MetaCLIP2 branches, logit-space fusion**. | **Yes — training data** for our heads (one 50k shard is plenty) + their distortion list as our laundering/augmentation recipe. |
| **Omni-Fake** (CVPR 2026) | 2026 | Benchmark for unified multimodal social-media deepfake detection. | Reference for the pitch. |
| **HAVIC** (CVPR'26 Findings), **X-AVDT** (CVPR 2026) | 2026 | Audio-visual coherence / cross-attention for talking-head deepfakes. | Too heavy; concept = check lip/voice coherence. |
| **Forger side: `Alissonerdx/BFS-Best-Face-Swap`** | Nov 2025, updated Sep 2026, MIT | Most-downloaded new face/head-swap LoRAs on HF (284k dl) for Qwen-Image 2.1 / Qwen-Image-Edit-2511 / FLUX.2-klein / Krea 2, ComfyUI workflows. | Red teams will likely use this class of tool → GenD + Smaug must cover it. Use only with synthetic personas; base models are large (hosted run, or skip). |

**Updated "our own model" recipe (replaces the plain linear probe in §4 for faces/images):**
- Start from **GenD** (LayerNorm-only fine-tuning, 0.03% of params) instead of a pure linear probe — still tiny enough to fine-tune on MPS, and it is the current best-generalising face method.
- Fine-tune on **paired real/fake from the same source** (GenD's key finding): e.g. persona photo → its laundered/edited fake; our own phone shot → the same scene regenerated.
- Add **NTIRE-style degradation augmentation** (JPEG, multi-compression, blur, noise, crop, downscale) — the common factor of the NTIRE winners and our main laundering threat.
- Fuse **two decorrelated branches** (e.g. GenD-CLIP face branch + Smaug/DINOv3 whole-image branch) in logit space, as LOGER/HEDGE did.

## 5. Concrete code references (from Context7 / repos)

- DINOv3 features (Context7 `/facebookresearch/dinov3`): `AutoImageProcessor` + `AutoModel.from_pretrained("facebook/dinov3-…")` → `outputs.pooler_output`; needs `transformers >= 4.56`. Also `pipeline(task="image-feature-extraction", model=…)`. **Gated under the DINOv3 License** — accept it on Hugging Face before the hackathon; fall back to DINOv2 or CLIP if access is slow.
- UnivFD training rule: freeze backbone, train only the final linear layer.
- Effort core (from its README): `U, S, Vh = torch.linalg.svd(W)`; keep `U[:, :r]…` frozen, train `U[:, r:], S[r:], Vh[r:, :]`.
- DeepfakeBench detector interface: `features → classifier → {cls, prob, feat}`; metrics AUC, EER, ACC, AP.

## Sources
- DeepfakeBench (Context7 `/sclbd/deepfakebench`) — https://github.com/SCLBD/DeepfakeBench
- UniversalFakeDetect — https://github.com/WisconsinAIVision/UniversalFakeDetect
- Effort — https://github.com/YZY-stack/Effort-AIGI-Detection (paper https://arxiv.org/abs/2411.15633)
- AIDE — https://github.com/shilinyan99/AIDE ; SSP — https://github.com/bcmi/SSP-AI-Generated-Image-Detection (https://arxiv.org/pdf/2402.01123.pdf)
- FakeShield — https://github.com/zhipeixu/FakeShield (https://arxiv.org/abs/2410.02761)
- ForensicHub — https://github.com/scu-zjz/ForensicHub ; AIGCDetectBenchmark — https://github.com/Ekko-zn/AIGCDetectBenchmark
- DeMamba — https://github.com/chenhaoxing/DeMamba ; DADF — https://github.com/laiyingxin2/DADF ; RAID — https://github.com/liamdugan/raid
- GenD — https://github.com/yermandy/GenD (paper https://arxiv.org/abs/2508.06248 ; weights https://huggingface.co/collections/yermandy/gend)
- NTIRE 2026 Robust Deepfake Detection report — https://arxiv.org/pdf/2604.24163 ; NTIRE 2026 AIGI-in-the-wild — https://github.com/msu-video-group/NTIRE-2026-DeepFake-Detection
- Omni-Fake (CVPR 2026) — https://openaccess.thecvf.com/content/CVPR2026/html/Li_Omni-Fake_Benchmarking_Unified_Multimodal_Social_Media_Deepfake_Detection_CVPR_2026_paper.html
- BFS face swap — https://huggingface.co/Alissonerdx/BFS-Best-Face-Swap
- DINOv3 (Context7 `/facebookresearch/dinov3`) — https://github.com/facebookresearch/dinov3 ; open_clip — https://github.com/mlfoundations/open_clip
