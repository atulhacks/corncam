"""B-Free whole-image detector (GRIP, University of Naples; CVPR 2025, code updated 2026-01-14).

Why: our Smaug-based Detective misses most fakes after a chat-app forward (held-out stress run: misses 14% -> 54%).
B-Free is trained bias-free (fakes regenerated from the same real images by Stable Diffusion inpainting) with heavy
augmentation including JPEG compression, blurring and scaling, and reports better robustness to social-network
re-compression. DINOv2-with-registers ViT; averages five 504 px crops; outputs one logit (> 0 = AI-generated).

Licence: GRIP-UNINA, nonprofit and informational use only, with attribution. Fine for the hackathon; it must be replaced
or licensed before any commercial use. The code is cloned (not vendored) into models/bfree/repo at a pinned commit.
Set up with `make bfree` (clone + weights with an MD5 check).

Measured on our held-out OpenFake Reddit 100 (28 Oct 2026; docs/BFREE_EVAL.md): alone it does NOT generalise to modern
generators (AUC 0.66 clean with 36% false alarms; 0.70 on WhatsApp-forwarded copies). Combined with Smaug on forwarded
images it lifts held-out AUC 0.788 -> 0.849, but at a false-alarm-capped threshold the gain (+4 catches, +1 false alarm
out of 50/50) is within noise. So it is a Studio advisory node only: shown, never votes, never fused.
"""

from __future__ import annotations

import importlib.util
import math
import time
from functools import lru_cache
from pathlib import Path

from corncam.ingest import Item
from corncam.schema import Category, Policy, Rank, Signal

ROOT = Path(__file__).resolve().parents[2]
BFREE_DIR = ROOT / "models" / "bfree"
REPO_COMMIT = "c6a9f89"  # grip-unina/B-Free, 2026-01-14
WEIGHTS_MD5 = "f3f53fa647848b16cf81c913f148a198"
MODEL = "BFREE_dino2reg4"

_NORM = {
    "resnet": ([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    "clip": ([0.48145466, 0.4578275, 0.40821073], [0.26862954, 0.26130258, 0.27577711]),
    "xception": ([0.5, 0.5, 0.5], [0.5, 0.5, 0.5]),
    "none": None,
}


def available() -> bool:
    return (BFREE_DIR / "weights" / MODEL / "config.yaml").is_file() and (
        BFREE_DIR / "repo" / "code" / "networks" / "wrapper5crops.py").is_file()


def _device() -> str:
    import torch

    return "mps" if torch.backends.mps.is_available() else "cpu"


@lru_cache(maxsize=1)
def _model():
    """Build the network exactly as the authors' get_network/load_weights do, without putting their generic package
    names (`networks`, `utils`) on sys.path."""
    import timm
    import torch
    import yaml

    cfg = yaml.safe_load((BFREE_DIR / "weights" / MODEL / "config.yaml").read_text())
    arch = cfg["arch"]
    if not arch.startswith("timm_c5i504_"):
        raise RuntimeError(f"unexpected B-Free arch {arch}")
    spec = importlib.util.spec_from_file_location(
        "bfree_wrapper5crops", BFREE_DIR / "repo" / "code" / "networks" / "wrapper5crops.py")
    module = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    net = module.Wrapper5crops(timm.create_model(arch[12:], num_classes=1, pretrained=False), 504)
    # weights_only: tensors and plain containers only, so a tampered checkpoint cannot run code when unpickled
    state = torch.load(BFREE_DIR / "weights" / MODEL / cfg["weights_file"], map_location="cpu", weights_only=True)
    net.load_state_dict(state["model"])
    device = _device()
    return net.to(device).eval(), cfg["norm_type"], device


def logit(path: str | Path) -> float:
    """The authors' raw score for one image: > 0 means AI-generated."""
    import torch
    import torchvision.transforms as T
    from PIL import Image

    net, norm, device = _model()
    steps: list = [T.ToTensor()]
    if _NORM.get(norm):
        mean, std = _NORM[norm]
        steps.append(T.Normalize(mean=mean, std=std))
    with Image.open(path) as im:
        x = T.Compose(steps)(im.convert("RGB")).unsqueeze(0).to(device)
    with torch.no_grad():
        out = net(x).float().cpu().numpy()
    return float(out[0, 0] if out.shape[1] == 1 else out[0, 1] - out[0, 0])


def bfree(item: Item) -> Signal:
    if not available():
        return Signal("B-Free AI-image detector", Category.GENERATIVE_AI, None, Rank.NA, "NOT_INSTALLED",
                      "B-Free is not installed on this machine (run make bfree).", Policy.IGNORE)
    t0 = time.perf_counter()
    z = logit(item.path)
    p = 1 / (1 + math.exp(-max(min(z, 30.0), -30.0)))
    dt = time.perf_counter() - t0
    rank = Rank.HIGH if p > 0.5 else Rank.UNCERTAIN if p > 0.33 else Rank.LOW
    shown = ">=99%" if p > 0.99 else "<1%" if p < 0.01 else f"{p:.0%}"
    evidence = {
        Rank.HIGH: f"Compression-robust detector (B-Free) finds generator traces: {shown} likely AI-generated.",
        Rank.UNCERTAIN: f"Compression-robust detector (B-Free) is unsure: {shown} likely AI-generated.",
        Rank.LOW: f"Compression-robust detector (B-Free) finds no generator traces ({shown} likely AI-generated). "
                  "Caution: in our tests it missed most modern generators, so a low score here does not clear the "
                  "image.",
    }[rank]
    # IGNORE until measured: shown as evidence, never votes, until a held-out run says otherwise.
    return Signal("B-Free AI-image detector", Category.GENERATIVE_AI, p, rank,
                  "DIFFUSION_ARTIFACT" if rank is Rank.HIGH else "NO_STRONG_SIGNAL", evidence, Policy.IGNORE,
                  details={"model": MODEL, "commit": REPO_COMMIT, "logit": round(z, 3)}, seconds=dt)
