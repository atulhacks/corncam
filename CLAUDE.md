# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Project name: Corncam.** It is a deepfake Forger + Detective covering all four modalities the brief allows: **image, video, audio and text**. The repo folder is named `croncam`.

This is a hackathon project (X AI Tech Ideathon), **problem statement 3: "Deepfake Arena: Red Team vs Blue Team"**. Git repo on branch `main`, pushed to the private GitHub repo `atulhacks/corncam` (remote `origin`; an older copy is on `harshit-vashisht/corncam`, remote `harshit`) (commit/push only when the user says so; `web/` is part of the main repo, its scaffold `.git` was removed).

Commands (see `Makefile`):
- Setup and weights: `make models`. The DF40 checkpoint is downloaded separately with gdown into `models/df40/`.
- Python checks: `make test` (pytest), `make lint` (ruff).
- Detect: `uv run corncam detect <files>`. Also `corncam api`, `corncam eval`, `corncam eval-folder`, `corncam calibrate`.
- Web UI: `make api` (FastAPI :8000) plus `make web` (Vite :5173). Check with `make web-check`.

Detector status, measured: image AUC 0.974 held-out (v5: category-max fusion + refit Platt; 91% accuracy, 4% false alarms, 14% misses); audio 80/80 (pellav2); GenD face branch trusted. DF40 is `Policy.IGNORE`: it is shown but never votes, because it scored a known-real face 0.997. Video runs smart-selected frames (Smaug + GenD) plus the audio track; there is no text detector.

**Known weakness: chat-forward re-compression** (measured 28 Oct 2026). Re-scoring the same 100 held-out images after a WhatsApp-style forward (720 px, JPEG q80 then q70; `forger.LAUNDER_PRESETS["whatsapp"]`): AUC 0.974 -> 0.788, misses 14% -> 54%, false alarms 4% -> 2% (`data/eval/reddit_100_v5_whatsapp_stress.json`, role "stress" on the Benchmark page). A separate Platt fit for compressed images (gate `calibrate.is_compressed`: JPEG q<=80 and long side <=1024) was tried, fitted on 87 tuning images and checked on the held-out stress set: misses 54% -> 32% but false alarms 2% -> 18%; it only pays if the pool is >~42% fake, so it is **off** (no `calibration_compressed.json`). Fixing this needs a detector trained on compressed fakes, not a threshold shift.

**B-Free tried and rejected for the verdict (docs/BFREE_EVAL.md):** AUC 0.66 clean (36% false alarms), 0.70 on forwards; combined with Smaug on forwards the gain is within noise. It is a Studio advisory node only (`bfree_scan`, `make bfree` to install, nonprofit licence).

**Red-team finding:** Nano Banana (`gemini-nano-banana-2.1`) fakes stay at P(fake) 0.99 on our Detective under every laundering we tried; a local FLUX.2 klein fake laundered with the WhatsApp preset drops to 0.37 (called real). The Forger's Launder button makes both a phone and a WhatsApp copy so self-play can keep the one that slips through.

**Studio (`#/studio`, `src/corncam/forensics.py`, `web/src/features/studio/`):** the person asks a question and/or places nodes; DeepSeek builds the rest of the investigation live on a React Flow canvas (`investigate.investigate(item, goal=..., requested=[...])`, endpoint `/api/studio/investigate`). Advisory forensic nodes, grouped in the node creator by the question they answer (`investigate.CATALOG`/`CATEGORIES`, each with a one-line purpose and media chips): image: origin metadata, compression history, error level analysis map, hidden-data decoders, what-if WhatsApp forward, B-Free second opinion; video: technical profile, scanned-frames contact sheet, spectrogram; audio: technical profile, spectrogram (speech seconds, bandwidth); text: writing-style statistics, hidden-data decoders. Maps are served from `data/studio/`. API JSON responses are `Cache-Control: no-store` (a cached node list once hid new nodes after a restart). Rules, enforced by tests: forensic results are `Policy.IGNORE` and kept out of `fuse()`; nodes the person adds always run if they apply; plain (non-Studio) investigations cannot use forensic tools; decoded payloads live in `details` (page only), never in `evidence` (what the AI reads). Smaug accepts only 1 or 3 crops (it asserts); the tool schema and `run_tool` enforce that (a "5 crops" option used to crash AI investigations).

**Evidence cache (`src/corncam/cache.py`):** detector signals are stored in `data/cache/` by file SHA-256 (full detections and each investigator/Studio tool call with its arguments), so a file is never re-scanned (measured: 16.3 s first run, under 10 ms after). Verdicts are not cached: fusion and calibration re-run each time. **Bump `cache.SIGNALS_VERSION` whenever a detector, its model revision, thresholds or evidence wording changes.** `CORNCAM_NO_CACHE=1` disables it; `corncam eval` always bypasses it so benchmarks measure current code.

**Online and cloud direction (user decision, 28 Oct 2026):** Corncam is an AI-integrated product, not an offline tool; cloud deployment (Azure/AWS) and online data are in scope. Two modes are planned: *Arena mode* (during the event: pull data in, send derived text to APIs, but never upload evidence items, per the brief's "fakes never leave the hackathon") and *Product mode* (users' own media with consent: reverse image search, second-opinion detector APIs, Gemini vision). Whether a private cloud deployment counts as "leaving the hackathon" is to be confirmed with the organisers. A planned AI-written-scan sandbox must run in a managed, isolated sandbox (no secrets, network allowlist, resource limits) in addition to task prompts; prompts alone do not stop prompt injection.

Files:
- `problemstatement/Problem Statements X AI Tech Ideathon.pdf`: the official brief, with 6 problem statements; #3 is on page 3. Poppler/`pdftotext` is not installed and the system Python has no PDF library. To read it, install `pypdf` into a venv in the scratchpad and extract the text there.
- `docs/DEEPFAKE_ARENA_RESEARCH.md`: a first-pass research dossier generated with DeepSeek. Treat it as unverified (see below).

## Claude Code setup in this repo

- `.claude/settings.json` (committed) holds the permissions:
  - Allowed: read-only `gh`, `uv run`, `ffprobe`, `aic check`, Context7.
  - Denied: reading `.env` and `secrets/`, plus upload commands.
- **Hook `.claude/hooks/block_media_upload.sh`:** a PreToolUse Bash hook that denies any command uploading media files or `data/` off the machine (curl -F/-T, scp, rsync to a remote host, `hf upload`, `gh release upload`, `fal_client.upload*`, transfer.sh). It enforces the rule that fakes never leave the hackathon. Do not work around it. If a hosted-generation upload is truly needed, a human runs it outside Claude Code.
- **Skill `/latest-research <topic>`:** the team's research protocol. It covers the recency rule, stars, forks and recent pushes, Context7 first, reading real code, and writing findings to `docs/`.
- **Agent `rules-auditor`:** a read-only compliance check against the hackathon rules. Run it before submitting fakes, the demo, or the content video.
- `.gitignore` excludes all media, `data/`, model weights and `.env`, so generated fakes can never be committed. `.env` is reserved for any future secret. None are needed today.
- Personal overrides go in `.claude/settings.local.json`, which is gitignored.

## What we are building (from the brief)

Every team builds both:
- **Forger (Red):** a pipeline that makes synthetic media (image, short video, audio or text) using **only the provided synthetic personas**. Each team submits 5 fakes.
- **Detective (Blue):** for each item in an unlabeled Evidence Pool (all teams' fakes mixed with verified real items), outputs a **verdict, confidence and human-readable reason**.

Also required: an explanation view that highlights what triggered suspicion, written for non-experts; a post-game report (which fakes slipped through, why, and how to improve); a 45–90 s vertical (9:16) content video made with AI tools; and a 5-minute pitch.

Scoring: a fake fools another team **+10 per team**; catching a fake **+5**; correctly calling a real item real **+3**; correct reason **+3**; false alarm on a real item **−5**; missed fake **−3**. False alarms are the most costly mistake, so Detective work should favour calibrated probabilities over raw model scores.

Hard rules that constrain any code or assets:
- Synthetic personas only. No real people, including politicians, celebrities, officials or classmates.
- Generated fakes never leave the hackathon. Never upload them, post them, or send them through messaging apps or public URLs.
- The content video must label AI-generated parts and must not use anyone's likeness without consent.
- This statement only goes ahead if at least 2 teams pick it, so a fallback problem may be needed.

## Constraints and the verified plan

**AI layer: DeepSeek (team decision, 27 Oct 2026).** The team has a DeepSeek API key (`DEEPSEEK_API_KEY` in the gitignored `.env`; never read, print or commit it). `src/corncam/ai.py` uses `deepseek-v4-flash` for:
- AI explanations and "Ask the Detective" Q&A on a verdict.
- The post-game report narrative.
- Forger scene ideas and persona text posts.

Its rules:
- **The AI never decides real or fake.**
- **Only derived text is sent:** detector scores, reason codes, our evidence lines, persona cards. Never media, file names or evidence-item content.
- Calls are cached in `data/ai_cache/`, with a budget guard of 300 calls per hour.

**Gemini (`GEMINI_API_KEY` in `.env`)** has two roles:
- **Fallback writer** (`gemini-flash-lite-latest`; full Flash timed out for our key) when DeepSeek is missing or fails, using the same text-only payloads.
- **Forger's Nano Banana 2.1 image engine** (`gemini-nano-banana-2.1`, paid tier only). Only the prompt and the organisers' persona photo are sent.

**Never send evidence items to Gemini:** on the free tier Google may use inputs to improve its products.

Everything else runs locally (no Anthropic key, no fal.ai):
- Explanations and reports: a local LLM via MLX (`mlx-lm`) plus templated text built from the signals.
- Transcripts: Whisper via `mlx-audio`.
- Generation: MLX and local tools.

Where the docs mention "Claude" as the explainer or fal/ElevenLabs for generation, read it as this local equivalent.

**Credentials:** none in the repo. The `hf` CLI is logged in (user `atulsaitm`) and `huggingface_hub` picks up the cached token automatically, so no `.env` or `HF_TOKEN` is needed. As of 27 Oct 2026:
- Smaug, GenD, pellav2 and rumik-oss-1 are downloadable.
- **DINOv3 returns 403.** Accept the Meta license on the model page first, or use DINOv2/CLIP instead.

**Disk:** about 31 GB free. Budget roughly 12–15 GB for model weights.

24-hour hackathon, **one developer** (3 people total), building on a **base M4 MacBook (16 GB, no NVIDIA GPU)**. No CUDA-only repos; detectors must be small enough for CPU/MPS; heavy generation uses hosted APIs. System Python is 3.14, so use `uv` with Python 3.11 for the project venv.

**`docs/RESEARCH_V2_VERIFIED.md` is the source of truth** for tool choices, the Mac-runnable detector stack, game strategy and the 24-hour plan. It supersedes v1 wherever they disagree.

**`docs/RESEARCH_V3_REAL_WORLD.md`** covers design: how TrueMedia.org, Reality Defender, India's Deepfakes Analysis Unit, and past challenges (DFDC, NIST GenAI, DARPA SemaFor) work, plus our prioritised differentiators. Its main design decisions:
- TrueMedia-style per-detector rank buckets and voting, with an "uncertain" band.
- An Experimental (out-of-domain) flag to brake false alarms.
- Evidence cards by category.
- A provenance smoking-gun check (C2PA `trainedAlgorithmicMedia`).
- Self-play selection of our 5 fakes.
- A semantic/transcript detector that checks consistency with the persona bible.

**`docs/RESEARCH_V4_LATEST_2026.md` overrides v2's model picks.** Current choices:
- Provenance: `aicheck`.
- Image: Smaug-AI-Image-Detector plus detectra-openfake.
- Audio: pellav2.
- Video: Smaug frames plus ReStraV-style DINOv2 curvature.
- Output: a Resemble-style verdict schema.

v4 §1 also lists which earlier sources are stale.

**`docs/RESEARCH_V5_METHODS_AND_OUR_MODEL.md`** explains how the reputable detectors work (UnivFD, Effort, AIDE/SSP, ReStraV, FakeShield/Veritas, DeepfakeBench) and designs our own model. Frozen foundation encoders (CLIP, DINOv3, Smaug, w2v-BERT) feed small heads we train on our Forger's self-play data, followed by calibrated fusion and Claude explanations. The brief does not require training a model, but this is our differentiator.

**`docs/DETECTION_MASTER_PLAN.md` is the current priority (user requirement: detection accuracy first).** It maps every forgery type to a signal and gives the execution order. Nothing counts as done until it is measured on held-out data.

**Research steps for every task (user requirement):** before building anything, run all of these and write findings to `docs/`:
1. **Enterprise practice via Context7:** how production services handle the problem (e.g. Hive, Sightengine, Resemble, Reality Defender docs).
2. **Reputable GitHub repos:** high stars, high forks and pushed within ~12 months. Read their actual code (`gh api`), not just READMEs.
3. **Chinese lab and company projects:** CUHK-Shenzhen (DeepfakeBench/DF40/Effort), Sichuan Univ (IMDLBenCo/ForensicHub), PKU (FakeShield), ModelScope. Search by lab or repo name; Chinese-keyword GitHub search is spam-polluted.
4. **Benchmarks and challenges:** NTIRE, podonos and other independent leaderboards; prefer held-out or private-label results over vendor claims.
5. **Verify on our data:** download, check correctness (e.g. label order on the model's own samples), then measure on held-out sets before trusting.

**Recency rule (user requirement):** research and build only on repos, models and docs pushed or released in the last ~12 months, using current docs via Context7. Read the actual code of other projects, not just their READMEs. Older work (e.g. the 2020 DFDC repos, TrueMedia, 2023 AASIST) may be cited only as history or a lesson, never as a dependency.

## Working with the research dossier (v1)

`docs/DEEPFAKE_ARENA_RESEARCH.md` is useful as a map but has known issues:
- Most repo paths, star counts and the `output_config.format` API usage checked out. The known errors (GenImage, OpenForensics, Coqui TTS, mflux paths) are listed in v2 §1. Anything else in v1 is still unverified.
- The section references in its §0 table are off: the content video is §10 and the rules are §11.
- It is over-scoped for a hackathon (10 subagents, a custom MCP server, C2PA signing, worktrees). Scope down to an MVP before building.
- It does not cover: the fake/real ratio in the pool (affects the decision threshold), false alarms on compressed real footage, Red-side post-processing to hide detector traces, what counts as a "real" text item, or Hindi/Indian-English audio.

The design direction worth keeping: Claude cannot ingest audio or video directly. Convert media into frames, transcripts and forensic signal JSON. Dedicated detectors and classical forensics produce the scores, and a calibration step fuses them. The local LLM only writes the explanation and report. The LLM must never be the sole real/fake classifier.
