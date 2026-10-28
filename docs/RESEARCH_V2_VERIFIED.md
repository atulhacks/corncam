# Deepfake Arena — Research v2 (verified, scoped to our constraints)

> Companion to `DEEPFAKE_ARENA_RESEARCH.md` (v1, DeepSeek). v1 is a broad tool map; this file is what we
> **checked** and what we **actually plan to use**.
> Verified 27 Oct 2026 via GitHub API (`gh api`), Hugging Face API, Context7 and web/arXiv search.

## 0. Our constraints (drive every choice below)

| Constraint | Consequence |
|---|---|
| **24-hour** hackathon | Only off-the-shelf pretrained models. No training except a tiny calibration fit. |
| **1 developer**, 3 people total | Dev builds the Detective + a thin Forger script + UI. The two non-devs own fakes (via hosted tools), test-set labelling, content video, pitch. |
| **MacBook M4 base, 16 GB, no NVIDIA GPU** | No CUDA-only repos. Detectors must be small (≤ ~450M params) and run on CPU/MPS. Heavy generation goes to hosted APIs; local MLX only as fallback. |
| System Python is 3.14 | Too new for most ML wheels. Use `uv` with **Python 3.11** for the project venv. (`ffmpeg`, `uv`, `node`, `gh` are installed.) |

## 1. Corrections to v1

v1 was more accurate than expected — most star counts and repo paths check out. Actual errors:

| v1 says | Reality |
|---|---|
| `Andrew-Zhu/GenImage` | Small 37★ copy. Official: **`GenImage-Dataset/GenImage`** (589★) |
| `sunnytqin/OpenForensics` | Does not exist. Official: **`ltnghia/openforensics`** |
| `coqui-ai/TTS` | Unmaintained since Aug 2024. Maintained fork: **`idiap/coqui-ai-TTS`** |
| `filipstrand/mflux` | Moved to **`mflux-community/mflux`** |
| `KwaiVGI/LivePortrait` / `KlingAIResearch/LivePortrait` | Same repo (renamed); either URL works |
| §0 table section refs | Content video is §10, rules §11 (not §11/§12/§13) |
| `output_config.format` json_schema | **Correct** — confirmed in current Claude API docs via Context7 (`/websites/platform_claude_en`). Response is JSON in the first text block. |

Not usable for us despite being in v1:
- **`TakHemlata/SSL_Anti-spoofing`, `clovaai/aasist`** — need Python 3.7, CUDA 11.1, pinned fairseq. Not viable on a Mac in 24h.
- **`iperov/DeepFaceLab`, DeepfakeBench training** — GPU training stacks.
- **`joonson/syncnet_python`** — old, CUDA-oriented; lip-sync scoring is a stretch goal at best.
- **Next.js + FastAPI + queue + MCP server + 10 subagents** — far too much for one dev. Use one Python app (Gradio or Streamlit).

## 2. What the evidence says (this changes strategy)

1. **Off-the-shelf detectors collapse on real-world media.** Deepfake-Eval-2024 (in-the-wild 2024 fakes, 52 languages): open-source models lose ~**50% AUC on video, 48% audio, 45% image** vs. their original benchmarks. → Never trust one detector's raw score. ([arXiv 2503.02857](https://arxiv.org/html/2503.02857v2))
2. **Our fakes will be fully synthetic, not face swaps.** Personas are synthetic, so Red teams will use text-to-image, image-to-video/talking-avatar, and TTS. Face-swap detectors trained on FaceForensics++ are the wrong tool. Prioritise **generated-image** detectors.
3. **Generator diversity is what makes image detectors generalise.** Community Forensics (CVPR 2025) trained on 2.7M images from **4,803 generators**; more and more diverse generators → better generalisation. ([CVF](https://openaccess.thecvf.com/content/CVPR2025/html/Park_Community_Forensics_Using_Thousands_of_Generators_to_Train_Fake_Image_CVPR_2025_paper.html))
4. **JPEG/resize/noise "laundering" hurts most detectors badly** (AIGIBench: "catastrophic" drops for many; CLIP-based detectors are more robust per arXiv 2410.01574). → This is Red's cheapest weapon and Blue's biggest blind spot. ([2505.12335](https://arxiv.org/pdf/2505.12335), [2410.01574](https://arxiv.org/pdf/2410.01574))
5. **Multimodal LLMs alone are not reliable detectors.** Zero-shot GPT-4o/Claude/Gemini: useful for interpretability and context, unreliable as standalone; Claude "moderate on synthetic images, struggled with faceswap/reenactment"; reasoning modes did not help. ([2506.10474](https://arxiv.org/html/2506.10474v1), [2503.20084](https://arxiv.org/abs/2503.20084v2)) → Claude = one feature + the explainer, never the sole classifier.
6. **Audio detectors generalise poorly to unseen TTS and languages.** In-the-wild EERs range ~5–18% across papers; AUDDT finds near-chance on some in-the-wild sets and **26% accuracy on an unseen language**. Hindi TTS from a new model is exactly that case. ([2509.21597](https://arxiv.org/pdf/2509.21597), [2203.16263](https://arxiv.org/pdf/2203.16263))
7. **AI-text detectors are easily fooled** by paraphrasing, sampling changes and unseen models (RAID, 6M generations, 12 detectors). Short social posts are the hardest case. ([2405.07940](https://arxiv.org/pdf/2405.07940))

## 3. Detective (Blue) — recommended stack (all Mac-runnable)

Verified with the Hugging Face API (params, license, last update).

| Modality | Primary signal | Backup / extra signals |
|---|---|---|
| **Image** | **`buildborderless/CommunityForensics-DeepfakeDet-ViT`** — ViT-S, 22M params, MIT, CVPR 2025. Single logit → `sigmoid` = p(fake). Needs `transformers >= 5.4.0`; re-download (weights fixed 22 Jul 2026); avoid the INT8/Q4 ONNX variants (diverge 10–70 pts). | `haywoodsloan/ai-image-detector-deploy` (195M, Apache-2.0, updated Aug 2026) as a second opinion; classical FFT spectrum + ELA (OpenCV/NumPy) for explainable heatmaps; EXIF/`exiftool`; Claude vision for semantic tells (hands, text, lighting, ears). |
| **Video** | `ffmpeg` sample 1–2 fps → image detector per frame → mean/max/variance timeline. Audio track → audio path. | Claude vision on 4–6 key frames + transcript (cross-modal check); `ffprobe` encoder tags. MediaPipe blink/landmark jitter only if time allows. |
| **Audio** | `transformers` `audio-classification` pipeline: **`Gustking/wav2vec2-large-xlsr-deepfake-audio-classification`** (315M, XLS-R = multilingual backbone, Apache-2.0) + `mo-thecreator/Deepfake-audio-detection` (95M). Treat both as weak. | Whisper transcript (`mlx-whisper` or `faster-whisper` on CPU); spectrogram image → Claude; simple prosody stats (pitch variance, pause/breath distribution via `librosa`). |
| **Text** | **`desklib/ai-text-detector-v1.01`** (434M, MIT, trained on RAID). | `fakespot-ai/roberta-base-ai-text-detection-v1` (125M); Claude rubric judge; consistency against the persona bible (facts/style). |
| **All** | **Fusion:** logistic regression on per-signal scores, fit on our own mini labelled set (our fakes + public real samples), with **sigmoid (Platt)** calibration — scikit-learn docs: isotonic overfits when samples ≪ 1000 (we will have ~60). Fallback if no time: hand-weighted average with conservative threshold. | **Claude** (`output_config.format` json_schema) gets the signal JSON + key images → verdict text, reason code, plain-language explanation, "innocent explanation" and "what would change my mind". |

Skip at MVP: C2PA (Red teams won't sign anything; absence proves nothing), SyncNet, Grad-CAM (FFT/ELA heatmaps are cheaper and explain just as well to non-experts).

**Robustness trick (cheap, high value):** score each image at original + one JPEG-recompressed + one downscaled copy and use the max/mean — partially counters laundering.

## 4. Forger (Red) — recommended stack

Local generation on a 16 GB M4 is slow (LivePortrait README: Apple Silicon "maybe 20x slower than RTX 4090"; FLUX.1-schnell is 12B params). **Use hosted APIs for quality, local for fallback.**

| Item | Hosted (primary) | Local fallback (Mac) |
|---|---|---|
| Persona still image | fal.ai / Replicate FLUX (image-edit models keep a persona consistent across shots) | `mflux-community/mflux` (MLX FLUX) or SDXL-Turbo |
| Talking-head video | fal.ai **Kling AI Avatar v2** — image + audio → lip-synced video, **~$0.056/s** (std) / $0.115/s (pro); **OmniHuman** $0.14/s, max 30 s. 10 s clip ≈ $0.56–1.40. | LivePortrait (`PYTORCH_ENABLE_MPS_FALLBACK=1`, slow) |
| Voice / audio | ElevenLabs *voice design* (designed voice, not a clone of a real person) | **`rumik-ai/rumik-oss-1-mlx-4bit`** via `mlx-audio` — 1.9 GB, 22 Indic languages + EN, voices Ira/Aisha/Siya/Zoya, accent/tone/pace via `instruct`, `<laugh>`/`<sigh>` tags (CC-BY-NC-4.0 — fine for a hackathon). Fallbacks: `mlx-community/VoxCPM2-4bit` (2.3 GB, Apache-2.0, voice design/cloning), Kokoro-82M (0.4 GB, Hindi voices rated "C"), `ai4bharat/indic-parler-tts`. **Not** Voxtral TTS: 19.5 GB bf16, too big for 16 GB. |
| Text post | Claude, written in persona voice, then **human-edited** | — |

**⚠️ Rule risk with hosted generation:** fal.ai CDN files (uploads *and* outputs) are **public by default** — anyone with the URL can download them. The rules say fakes must never be posted online or at public URLs. Mitigations: set File ACLs / `X-Fal-Object-Lifecycle-Preference` for short expiry and `X-Fal-Store-IO: 0`; generate the 5 *submitted* fakes locally where possible; and ask organizers whether hosted generation counts as "posting". Same question applies to ElevenLabs.

**Laundering post-process (Red's highest-ROI step, per §2.4):**
- Image: downscale → JPEG q≈75–85 → light grain; or literally photograph the screen with a phone (adds real sensor noise + real EXIF).
- Audio: play through a speaker and re-record on a phone (room tone, mic colouration); add light background noise.
- Video: re-encode with phone-like H.264 settings; optionally screen re-capture.
- Text: human paraphrase of AI draft, add typos/colloquial Hinglish.

**Portfolio of 5:** 1 laundered still, 1 talking-head video (Hindi or Hinglish), 1 audio clip (re-recorded), 1 human-edited text post, 1 cross-modal item. Different methods so one detector gap can't catch all five.

## 5. Game strategy

- **Threshold:** with the +3 reason bonus applied on both sides, calling fake is +EV when calibrated p(fake) > **0.5** (0.42 if the bonus is only on fakes, 0.58 if only on reals). Keep v1's math — it is correct.
- **False alarms (−5) are the most expensive error.** Organizers' "verified real" items will likely be phone photos/videos — exactly what detectors over-flag. Include real phone media in our calibration set.
- **Base rate matters.** If the pool is mostly fakes (teams × 5 vs. few reals), posteriors shift toward fake. Ask organizers the fake/real ratio, or estimate it from the pool size.
- **Our own 5 fakes** are known to us (hash lookup). Ask whether they are excluded or score normally.
- **Reason codes should name the method** (diffusion still, talking avatar, TTS, AI text, cross-modal conflict), since "correct reason" is likely judged against what Red actually did.

## 6. 24-hour plan (solo dev + 2 non-devs)

**Before the clock starts (if allowed):** create `uv` Python 3.11 venv; download all detector weights; smoke-test each on MPS/CPU; get fal.ai + Anthropic API keys; collect ~30 public real images/audio/text + generate ~30 fakes for calibration.

| Hours | Dev | Teammates |
|---|---|---|
| 0–2 | Repo skeleton, ingest (hash, type detect, ffmpeg frame/audio extraction) | Persona bible; start generating fakes on hosted UIs |
| 2–8 | Image + text detectors, FFT/ELA maps, Claude verdict call with schema | Fakes + laundering; collect real samples; label calibration set |
| 8–13 | Audio + video paths (frames → image detector, audio → audio detector + Whisper) | Finish 5 submission fakes (QC checklist from v1 §4.4); BTS footage |
| 13–17 | Fusion + calibration on labelled set; Gradio UI: pool view, verdict card, heatmaps, timeline | Content video script + AI voiceover + captions |
| 17–20 | Post-game report generator (Claude over verdicts + reveal) | Edit 9:16 reel, "made with AI" labels |
| 20–24 | Full dry run on mixed pool; buffer; pitch demo | Pitch deck + rehearsal |

## 7. Still-open questions for organizers

1. Persona pack contents (faces? voices? bios?) and whether "real" items also depict personas.
2. Fake/real ratio in the pool; whether our own fakes are in our pool.
3. How "correct reason" is judged (method vs. artifact vs. free text).
4. Are hosted generation APIs (fal, ElevenLabs) and the Claude API allowed? Internet on-site?
5. Max file size/duration/format for pool items; what counts as a "text" item and what a "real" text item is.
6. Does generating on a hosted service (fal.ai, ElevenLabs — files sit on their CDN) count as "posting online"?

## 8. Other projects worth reading (code ideas, not dependencies)

| Repo | Why |
|---|---|
| `Abhijeet8901/XPlainVerse-ACMChallenge` | ACM MM 2026 explainable-deepfake challenge: label + detailed and simple explanations, graded on localisation — closest public spec to our "reason" scoring ([arXiv 2607.21007](https://arxiv.org/pdf/2607.21007)) |
| `YZY-stack/DF40` (353★) | Next-gen deepfake dataset, 40 forgery methods — taxonomy for reason codes |
| `nuriachandra/Deepfake-Eval-2024` | In-the-wild eval set; realistic test items |
| `laiyingxin2/Agent4FaceForgery` (MIT) | Multi-agent LLM forgery orchestration ideas for the Forger |
| `Blaizzy/mlx-audio`, `mflux-community/mflux` | Apple-Silicon-native TTS and FLUX |
| `Daisy-Zhang/Awesome-Deepfakes-Detection` (1.8k★) | Index of papers and code |

## 9. Context7-verified API notes (build reference)

Each snippet below was checked against current docs via Context7 (library ID in brackets).

**Image detector via pipeline** (`/llmstxt/huggingface_co_transformers_v5_2_0_llms_txt`) — `device="mps"` is the documented Apple Silicon path; for a single-label model `function_to_apply="default"` already applies sigmoid, so CommunityForensics needs no custom code:
```python
from transformers import pipeline
img_det = pipeline("image-classification", model="buildborderless/CommunityForensics-DeepfakeDet-ViT", device="mps")
img_det(["frame1.jpg", "frame2.jpg"])   # list in -> list of results out
```
Audio: `pipeline("audio-classification", model=..., device="mps")` accepts a file path (decoded via ffmpeg, resampled automatically) or `{"sampling_rate": sr, "array": y}`; default `function_to_apply="softmax"`.

**Claude call** (`/anthropics/anthropic-sdk-python`, `/websites/platform_claude_en`) — images as `{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":...}}` alongside text blocks; verdict schema via `output_config={"format":{"type":"json_schema","schema":...}}`; cache the long system prompt (rules + reason taxonomy + persona bible) with `cache_control={"type":"ephemeral","ttl":"1h"}` on the system block since every pool item reuses it. SDK caps each image at **5 MiB base64** (≈3.75 MB raw) — downscale frames/heatmaps before sending. Client retries 408/409/429/5xx automatically.

**Calibration** (`/websites/scikit-learn_stable`) — `CalibratedClassifierCV(LogisticRegression(), method="sigmoid", cv=...)`; `method="temperature"` exists since 1.8; check with `calibration_curve` / `CalibrationDisplay`. Do not use isotonic on our small set.

**UI** (`/websites/gradio_app`) — `gr.Label` takes `{"fake": p, "real": 1-p}` for the verdict badge; **`gr.ImageSlider`** (built in) takes a `(original, heatmap)` tuple — ideal for the non-expert explanation view; `gr.Gallery` takes `(image, caption)` tuples for flagged frames; `gr.LinePlot(df, x=..., y=...)` for the per-frame score timeline.

**Local TTS + STT** (`/blaizzy/mlx-audio`) — one library covers both:
```python
from mlx_audio.tts.utils import load_model
tts = load_model("rumik-ai/rumik-oss-1-mlx-4bit")
for r in tts.generate(text="नमस्ते...", voice="Ira", instruct="professional, Hindi accent, steady pace"):
    audio = r.audio  # mx.array, 24 kHz
```
Whisper STT in the same library supports `model.generate("audio.wav", word_timestamps=True)` → `result.segments[i]["words"]` with start/end/probability (useful for the audio explanation view).

**Prosody features** (`/websites/librosa_doc`) — `librosa.pyin(y, sr=sr, fmin=65, fmax=400)` → f0 + voiced flags (pitch std, voiced ratio); `librosa.effects.split(y, top_db=...)` → non-silent intervals (pause count/length distribution).

**Hosted talking head** (`/websites/fal_ai`):
```python
import fal_client
url_img = fal_client.upload_file("persona.png"); url_aud = fal_client.upload_file("line.wav")
res = fal_client.subscribe("fal-ai/kling-video/ai-avatar/v2/standard",
                           arguments={"image_url": url_img, "audio_url": url_aud}, with_logs=True)
```
(See the public-CDN rule risk in §4.)

**Memory budget on 16 GB:** load models lazily and one modality at a time — image ViT (~0.1 GB) + text detector (~0.9 GB) + audio wav2vec2-large (~1.3 GB) + Whisper turbo (~1.6 GB weights) fit together; TTS/generation models should run in a separate process from the Detective.

## Sources

- Deepfake-Eval-2024 — https://arxiv.org/html/2503.02857v2
- Community Forensics (CVPR 2025) — https://openaccess.thecvf.com/content/CVPR2025/html/Park_Community_Forensics_Using_Thousands_of_Generators_to_Train_Fake_Image_CVPR_2025_paper.html ; model card https://huggingface.co/buildborderless/CommunityForensics-DeepfakeDet-ViT
- AIGIBench — https://arxiv.org/pdf/2505.12335 ; Adversarial robustness of AIGI detectors — https://arxiv.org/pdf/2410.01574 ; Fake or JPEG? — https://arxiv.org/html/2403.17608v1
- LLMs not yet ready for deepfake detection — https://arxiv.org/html/2506.10474v1 ; Multimodal LLMs as detectors — https://arxiv.org/abs/2503.20084v2
- Audio generalisation — https://arxiv.org/pdf/2203.16263 ; AUDDT — https://arxiv.org/pdf/2509.21597
- RAID text benchmark — https://arxiv.org/pdf/2405.07940 ; DAMAGE — https://arxiv.org/pdf/2501.03437
- Explainable Deepfake Detection Challenge — https://arxiv.org/pdf/2607.21007
- fal.ai Kling Avatar v2 — https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard ; OmniHuman — https://fal.ai/models/fal-ai/bytedance/omnihuman
- Claude structured outputs (Context7 `/websites/platform_claude_en`) — https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- SSL_Anti-spoofing — https://github.com/TakHemlata/SSL_Anti-spoofing
