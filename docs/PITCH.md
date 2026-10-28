# Corncam: 5-minute pitch and demo runbook

All numbers below are measured on held-out data or in our own self-play (see `CLAUDE.md` and the Benchmark page).
Never quote a number that is not on this page.

## Numbers to quote

| Claim | Value | Where it is shown |
|---|---|---|
| Image Detective, 100 held-out OpenFake images | AUC 0.974, accuracy 91%, false alarms 4%, misses 14%, +328 arena points | Overview stat strip, Benchmark |
| Audio Detective | 80 of 80 correct | Benchmark |
| Nano Banana (Gemini image) fakes | caught at 99%, also after laundering | Forger Studio |
| Our blind spot (WhatsApp-style forward, same 100 images) | misses rise 14% to 54%; false alarms stay at 2% | Benchmark, "stress" run |
| Why we did not "fix" it with a threshold | compressed calibration: misses 32% but false alarms 18% (worse unless the pool is >42% fake) | this page |

## Script (5:00)

**0:00 Hook (30 s).** "In the arena a false alarm costs 5 points and a miss costs 3. So the hard part of deepfake
detection is not catching fakes, it is not accusing real people. Corncam is built around that."

**0:30 Detective (60 s). Page: Detective.** Drop a real photo, then a fake.
- Verdict, calibrated confidence, the evidence card and the *innocent explanation to rule out*.
- "The verdict comes from detectors plus calibration. The AI never decides real or fake; it explains."
- Point at the call-line bar: 50% is the line, and our probabilities are calibrated on held-out data.

**1:30 Studio (75 s). Page: Studio.** Drop `b0093f14a95e.jpg` (our own laundered fake). Click the suggestion
"Where did this come from?", add the *Error level analysis* node, press *Investigate with AI*.
- Nodes appear as DeepSeek plans: "AI added" vs "You added"; dashed "shown only" edges = advisory, never votes.
- The AI reads the compression history ("looks like a forwarded chat image") and rescans by itself.
- Click the ELA node: the map. Click Origin metadata: what survived.
- "DeepSeek never sees the file: only scores and our findings. Decoded data stays on the page."

**2:45 Red team (45 s). Page: Forger Studio.** "We built the Forger and attacked our own Detective."
- Nano Banana fakes: caught at 99% even after laundering.
- Local FLUX + a WhatsApp-style forward: our Detective called it real. One Launder click makes a phone copy and a
  WhatsApp copy; self-play keeps the one that slips through. That is how we pick our 5 fakes.

**3:30 Honesty (45 s). Page: Benchmark.** Show the "stress" row.
- "We measured our own blind spot: on forwarded images misses go from 14% to 54%, while false alarms stay at 2%."
- "We tried a quick fix, a separate calibration: it catches more but false alarms jump to 18%. With −5 per false
  alarm we kept it off. The real fix is a detector trained on compressed fakes; that is next."

**4:15 Close (45 s).** Explanation view for non-experts, post-game report, AI on top of measured detectors.
"Next: Studio goes online (fact-checks, reverse image search for users' own media, AI-written scans in a managed
sandbox) and to the cloud." Thank you.

## Demo runbook

Before the round:
1. `make api` and `make web`; open `http://localhost:5173`. Sidebar footer must say "API online".
2. Warm the models: analyse one image on Detective (first run loads models, ~15 s; later runs ~2-6 s).
3. Studio needs DeepSeek: Overview or Pipeline shows the AI status. If DeepSeek fails, Gemini Flash Lite takes over
   automatically; if both fail, Studio still runs the checks in a fixed order (say so, do not hide it).

Files (all synthetic or dataset images, no real people from the arena):

| Purpose | File | Expected |
|---|---|---|
| Real photo | `data/eval/test-00000-of-00001/00001_real.jpg` | REAL ~98% |
| Our Nano Banana fake (fictional test persona) | `data/forger/candidates/c68f9ea402b9.png` | FAKE 99% |
| Our laundered fake (Studio demo) | `data/forger/candidates/b0093f14a95e.jpg` | REAL ~63% (the blind spot) |

Fallbacks: if a page errors, reload; if the API is down, `make api` again (models reload in ~15 s). Screens to use
if the network fails: Overview (numbers), Benchmark (stress row), Forger (candidates and scores) need no AI.

## Likely judge questions

- **"Does the AI decide?"** No. Detectors plus Platt calibration decide; tests enforce it. The AI plans checks and
  explains them.
- **"What do you send to DeepSeek/Gemini?"** Derived text only: scores, reason codes, our findings, persona cards. No
  media, no file names. Gemini also generates Forger images from prompts and organiser persona photos.
- **"Why trust 91%?"** Held-out images never used for tuning; calibration fitted on a separate seed; leakage removed.
- **"What breaks it?"** Heavy re-compression (measured above) and modern face swaps (InSwapper) on the trusted face
  model. Video is marked experimental: it is not benchmarked, so its calls are capped at the "uncertain" tier and the
  explanation says so.
- **"Why not use the compressed calibration?"** It only pays if more than ~42% of the pool is fake, and it makes
  false alarms 9x more common.
