# B-Free evaluation (28 Oct 2026)

**Question:** can a compression-robust detector fix our measured blind spot (WhatsApp-style forwards: misses 14% -> 54%)?

**Candidate (research protocol):** B-Free, GRIP / University of Naples, CVPR 2025, repo `grip-unina/B-Free` updated
2026-01-14 (inside the 12-month window). Bias-free training (fakes regenerated from the same real images with SD 2.1
inpainting) plus heavy augmentation including JPEG. DINOv2-registers ViT, five 504 px crops. Licence: nonprofit use
only (fine for the hackathon; must be replaced before commercial use). Read the actual code (`main_bfree_single.py`,
`networks/wrapper5crops.py`, `utils/normalization.py`).

**Correctness check:** weights verified by the published MD5; our loader reproduces the authors' demo logits exactly
(img0000 -5.937, img0001 -4.442, img0002 4.431, img0003 3.850). `torch.load(weights_only=True)`.

**Held-out results (same 100 OpenFake Reddit images as our Detective; logit > 0 = fake):**

| | AUC | False alarms | Misses | Points |
|---|---|---|---|---|
| B-Free alone, clean | 0.662 | 36% | 46% | +72 |
| B-Free alone, WhatsApp forward | 0.696 | 8% | 66% | +104 |
| Our Detective (Smaug + calibration), clean | 0.974 | 4% | 14% | +328 |
| Our Detective, WhatsApp forward | 0.788 | 2% | 54% | +176 |
| Smaug + B-Free logistic combo (fitted on 87 tuning forwards), WhatsApp, threshold capped at <=3% tuning false alarms | 0.849 | 4% | 46% | +200 |

Self-play: B-Free scores our laundered FLUX fake <1% and our Nano Banana fake 29% (both misses).

**Decision:** not in the verdict. Alone it does not generalise to modern generators; the combination's gain on forwards
(+4 catches, +1 false alarm out of 50/50, threshold picked from only 38 tuning reals) is within noise and costs ~2 s per
image. Shipped as a Studio advisory node (`bfree_scan`: shown, never votes) with a caution in its evidence line.
The real fix for forwards remains a detector trained on compressed modern fakes (self-play data from our Forger).
Raw logits: `data/eval/bfree_heldout_logits.json` (local).
