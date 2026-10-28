# Deepfake Arena — Research v3: how the real world does it, and how we go beyond the brief

> Builds on `RESEARCH_V2_VERIFIED.md` (tools + 24h plan). This file is about **design**: what real
> platforms, enterprises and past challenges learned, and which of those ideas we steal.
> Researched 27 Oct 2026: source code read via `gh api`, docs via **Context7**, papers/reports via web search.

---

## 1. Real-world systems we studied

### 1.1 TrueMedia.org — nonprofit election deepfake checker (open-sourced its whole stack)

TrueMedia ran deepfake checks for journalists during the 2024 elections, shut down, and published
`truemediaorg/deepfake-app` (Next.js app + scheduler) and `truemediaorg/ml-models` (MIT; weights gated by email).
Their data later became Deepfake-Eval-2024. **This is the closest real system to our Detective.** We read the code.

**Ensemble by voting, not averaging** (`apps/detect/app/data/verdict.ts`):
- Every model's score is mapped to a **rank**: `low` (≤ 0.33) / `uncertain` / `high` (> 0.5) / `n/a`. Thresholds are tuned **per model**.
- Each `high` model = 1 fake vote; **trusted** models get 2 votes; `ignore` models are hidden.
- Verdict: **≥2 votes → high**, 1 vote → uncertain, 0 → low. **≥3 votes** overrides everything.
- Special rule: if it *just* reaches 2 votes and **all votes come from "visual noise" models**, demote to uncertain — noise detectors false-alarm on compressed real media.
- **"Experimental" flag**: if the item is outside what the ensemble was tuned for (image with 0 or ≥5 faces, >20% text overlay, artwork; video with no faces) → stays `uncertain` unless ≥3 votes. This is their false-alarm brake.
- Human analyst labels override the models; "trusted sources" default to `low`.
- They also prototyped a **logistic-regression ensemble** (per-modality weights + intercept, low/high cutoffs 0.2/0.6) — same idea as our calibration step.
- Claim: "by continuously tuning the ensemble, we achieved over 90% accuracy".

**Explanation UI = model cards grouped by category:** Faces · Generative AI · Visual Noise · Voices · Semantic · Other. Each card shows name, description, score, rank.

**Semantic (transcript) detector** (`ml-models/transcript`, `gpt-util/transcriptAnalysis.ts`, `transcriptPrompt.ts`):
Whisper transcript → LLM labels `Real` / `Fake` / `Unknown` with a rationale, judging "language construction, narrative coherence, and factual alignment" (too polished/theatrical vs. natural speech). Prompt is few-shot and was **optimized with DSPy (MIPROv2)** on labelled data — they report "use of a trained prompt is essential". Extra guards: first ask "is this song lyrics?" (skip), strip emojis from transcripts.
→ We can rebuild this with `mlx-audio` Whisper + Claude, and make it stronger by adding **persona-bible consistency** (see §3).

### 1.2 Reality Defender — enterprise API (Context7: `/reality-defender/realitydefender-sdk-typescript`)
Result object: overall `status` (`MANIPULATED` / `AUTHENTIC` / …), overall `score` 0–1 (ensemble final score), per-model `{name, status, score}`, and **per-model heatmap PNGs for images**. Same pattern as TrueMedia: ensemble verdict + per-detector evidence + visual localisation.

### 1.3 India — Deepfakes Analysis Unit (DAU), Misinformation Combat Alliance + Meta
WhatsApp tipline (launched 2024): the public forwards audio/video; a bot guides them in **English, Hindi, Tamil, Telugu**. Analysts run several tools; **if ≥3 tools indicate AI manipulation, escalate** to forensic partners and labs for expert analysis. Again: multi-tool agreement + human escalation. Very relevant to the Indian judges' context.

### 1.4 Other enterprise approaches (secondary sources — treat as provisional)
- **Intel FakeCatcher** — physiological signal: real faces show tiny pulse-driven colour changes (photoplethysmography); synthetic faces don't. Intel claims 96%. Idea is cheap to approximate but noisy on compressed video.
- **Pindrop Pulse** — voice deepfakes in call centres; combines acoustic scoring with call/behaviour metadata. Lesson: **context signals + acoustic signals**, never acoustic alone.
- **Hive** — API-first moderation-stack detector used inside content pipelines.

### 1.5 Provenance and watermarks (the "smoking gun" layer)
- **C2PA Content Credentials** (Context7: `/websites/spec_c2pa_specifications_specifications_2_3`): an AI-generated asset carries a `c2pa.created` action with `digitalSourceType = http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia` (or `compositeWithTrainedAlgorithmicMedia`). Major generators embed this. **If a Red team forgets to strip it, it is a near-certain catch.** Absence proves nothing.
- **SynthID** (Google, in Gemini images) — invisible spectral watermark. `aloshdenny/reverse-synthid` (Context7) shows it is detectable by FFT phase analysis (~90%) **and removable** (resolution-dependent carriers, 75% carrier-energy drop). Lesson: watermarks are a bonus signal, not a defence.
- **Meta AudioSeal** (`facebookresearch/audioseal`, 801★) — localized audio watermark detector; only catches audio from tools that embed it.

---

## 2. What past challenges taught

| Challenge | Lesson for us |
|---|---|
| **Kaggle DFDC (Meta, 2020)** | Winner scored **65%** on the hidden black-box set; **all top-5 public-leaderboard teams fell** (to 37th, 6th, 10th, 17th). Meta's conclusion: generalisation is everything, and look beyond pixels to **context and provenance**. Winning recipe: 32 frames → face crop → ensemble of 7 EfficientNet-B7, with augmentation that hides face parts. |
| **NIST GenAI (2024 text, 2025 image pilots)** | **Same format as our game**: generator teams vs. discriminator teams. Scored with **AUC and Brier score** (Brier = calibration quality). → Report our Brier score in the post-game report. |
| **DARPA SemaFor / AI FORCE** | Generators make **semantic errors** (facts, context, physics) that pixel detectors miss. Three tasks: **detect, attribute** (which generator/team), **characterize** (intent). Evaluation across 111 tasks: analytics must be **explainable and context-aware**. |
| **Deepfake-Eval-2024** | Open detectors lose ~45–50% AUC in the wild (see v2 §2). |
| **ACM MM 2026 Explainable Deepfake Challenge (XPlainVerse)** | Verdict + detailed and simple explanation, graded on whether the explanation points at the right region. |

---

## 3. Humans and games

- **People are near chance at spotting deepfakes.** Meta-analysis (Diel et al. 2024, as cited): **55.5%** average across 56 studies / 86k participants. Audio is worst (one 2026 vishing study: 37.5%). iProov (vendor, Feb 2025): only **0.1%** of 2,000 people got every item right, and **60%+ were confident anyway**.
- **Playing the attacker builds resistance.** Cambridge's *Bad News* and *Harmony Square* make players act as disinformers; studies show players rate manipulative content as less reliable and are less willing to share it (Harmony Square: ~21% lower susceptibility). Played over a million times, 19 languages.
→ **Our Red-vs-Blue arena is itself an inoculation game.** That is the social-impact pitch.

---

## 4. How we go beyond the brief (creative differentiators)

Ordered by value per hour for a solo dev in 24h.

### MUST (core, ~cheap, directly scores points)
1. **TrueMedia-style voting verdict with an "uncertain" band + Experimental flag.**
   Per-detector rank buckets, trusted detectors get 2 votes, "noise-only" votes get demoted, out-of-domain items stay uncertain. The game still needs a binary call, so: show 3 states in the UI, and convert to fake/real with the calibrated EV rule (v2 §5). Directly attacks the −5 false-alarm penalty.
2. **Evidence cards by category** (Generative AI · Visual Noise · Faces · Voice · Semantic · Provenance) — copy of the TrueMedia/Reality Defender UX, each card with score, rank, and a one-line plain-language reason. This *is* the "explanation view".
3. **Provenance smoking-gun check** — C2PA `digitalSourceType`, EXIF/XMP software tags, encoder strings (`ffprobe`), generator filename patterns. Seconds to run; decisive when Red forgets to strip; also feeds the "correct reason" point ("C2PA manifest declares trainedAlgorithmicMedia").
4. **Self-play red-teaming (adversarial selection).** Run our Detective on every candidate fake our Forger makes, including laundered variants. **Submit the 5 our own Detective misses or is least sure about** — they are the most likely to fool other teams (+10 each). The same loop produces our post-game report data and shows judges a real red/blue feedback loop, like DFDC/NIST.

### SHOULD (strong story, moderate effort)
5. **Semantic detective (SemaFor + TrueMedia transcript idea, upgraded).** Whisper transcript / text post / image description → Claude judges narrative coherence, "too-polished/theatrical", and **consistency with the persona bible** (does the persona's age, city, job, speech style, Hinglish usage match?). Few-shot it with our own labelled items (cheap stand-in for DSPy).
6. **Cross-item persona consistency.** When several pool items depict the same persona, compare them (CLIP image embeddings, voice embeddings or simple pitch stats). Items that drift from the persona's reference assets are suspicious — the "persona fingerprint" Red's QC checklist warns about, used offensively.
7. **Calibration honesty in the post-game report:** Brier score + reliability chart (NIST-style), list of slipped fakes with the detector that was fooled and why, and "how to improve" per miss.

### COULD (wow factor for demo / pitch / video)
8. **Human vs. AI round.** Before the Detective's verdict is revealed, the audience or judges guess. Show human accuracy vs. Detective accuracy live. Cites the 55.5% human baseline; makes a great content-video hook.
9. **Tipline-style intake (India DAU pattern).** A "forward it to the bot" flow (e.g. Telegram/WhatsApp-style chat) that returns the verdict card in Hindi/English/one regional language. Demo only with synthetic items; nothing leaves the local machine.
10. **Attribution ("which forger made this?")** — SemaFor's second task. Cluster pool items by generator fingerprint (FFT spectrum signature, encoder tags, TTS voice). Even rough clustering is a memorable demo and helps post-game analysis.

---

## 5. Changes this implies for the v2 plan

- Fusion = **TrueMedia-style votes + rank buckets** as the explainable layer, with the logistic-regression calibrated probability for the final binary call (both already in v2's spirit; now with a proven precedent).
- Add a **provenance module** (C2PA reader via `c2pa-python`, `exiftool`, `ffprobe`) back into the MVP — v2 dropped C2PA, but as a *positive-evidence-only* check it is cheap and high-precision.
- Add a **semantic/transcript detector** to the audio and text paths.
- Reorder Forger work: generate more candidates than 5, launder, then **select by self-play**.
- Post-game report includes Brier score and attribution clusters.

---

## Sources

Code and docs read directly:
- TrueMedia app — https://github.com/truemediaorg/deepfake-app (`apps/detect/README.md`, `app/data/verdict.ts`, `app/api/starters/gpt-util/transcriptAnalysis.ts`, `transcriptPrompt.ts`)
- TrueMedia models — https://github.com/truemediaorg/ml-models (`README.md`, `transcript/README.md`)
- Reality Defender SDK — Context7 `/reality-defender/realitydefender-sdk-typescript`
- C2PA 2.3 spec — Context7 `/websites/spec_c2pa_specifications_specifications_2_3` — https://spec.c2pa.org/specifications/specifications/2.3/specs/C2PA_Specification
- reverse-synthid — Context7 `/aloshdenny/reverse-synthid`
- AudioSeal — https://github.com/facebookresearch/audioseal ; DFDC winner code — https://github.com/selimsef/dfdc_deepfake_challenge

Reports and papers:
- India DAU tipline — https://about.fb.com/news/2024/02/mcas-whatsapp-helpline-curbing-the-spread-of-ai-generated-misinformation/ ; https://weforum.org/stories/2024/08/deepfakes-india-tackling-ai-generated-misinformation-elections
- DFDC results — https://ai.meta.com/blog/deepfake-detection-challenge-results-an-open-initiative-to-advance-ai/ ; dataset paper https://arxiv.org/pdf/2006.07397
- NIST GenAI — https://ai-challenges.nist.gov/t2i ; NIST AI 700-1 https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.700-1.pdf
- DARPA SemaFor — https://www.darpa.mil/program/semantic-forensics ; AI FORCE https://www.semanticforensics.com/ai-force/challenge-1
- Intel FakeCatcher — https://www.intel.com/content/www/us/en/research/trusted-media-deepfake-detection.html ; enterprise tool roundup https://fast.io/resources/best-deepfake-detectors-2026/
- Human detection — iProov study coverage https://thenextweb.com/news/can-you-detect-deepfakes ; stats roundup https://morphed.app/stats/ai-image-detection-statistics
- Inoculation games — https://www.cambridgenetwork.co.uk/news/game-combats-political-misinformation-letting-players-undermine-democracy ; https://behavioralscientist.org/a-new-way-to-inoculate-people-against-misinformation/
