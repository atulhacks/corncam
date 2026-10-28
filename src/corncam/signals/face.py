"""Face-forgery branch: the "deepfake" half of the two-model pattern every production system uses.

Hive: "first detecting each face … a classification step on each face … returns the highest confidence score".
Sightengine: deepfake (manipulated faces) and AI-generated (whole image) detection are complementary.
See docs/RESEARCH_V6_FACES_AND_ENSEMBLES.md.

Pipeline (matches GenD's training preprocessing, github.com/yermandy/GenD detector.py, MIT):
  OpenCV YuNet face detector (5 landmarks; replaces RetinaFace, same landmark set)
  → align_face: similarity transform to GenD's 5-point template, 1.3x context, 256x256
  → GenD (WACV 2026) CLIP ViT-L/14, LayerNorm-only tuned → P(fake) per face → max over faces.
"""

from __future__ import annotations

import sys
import time
from functools import lru_cache
from pathlib import Path

import numpy as np

from corncam.fusion import OPERATING_POINT
from corncam.ingest import Item
from corncam.schema import Category, Policy, Rank, Signal
from corncam.signals.image import rank_for

ROOT = Path(__file__).resolve().parents[3]
YUNET = ROOT / "models" / "face_detection_yunet_2026may.onnx"  # opencv_zoo @ 48b10fa, see Makefile `models`
GEND_REPO = "yermandy/GenD_CLIP_L_14"
GEND_REVISION = "891ce014a0308386c4d7d25b3dcf436a22db5504"  # pinned 2026-10-27
MIN_FACE_PX = 48  # smaller faces carry too little detail to judge
MAX_FACES = 8
# YuNet confidence, set by inspecting every detection on the OpenFake Reddit reals (27 Oct 2026): at 0.7 it let
# through tattoos, foliage, food and animals; from 0.85 up nearly all detections are faces (one bear at 0.86).
# 0.9 was too strict (dropped a clear 388 px face at 0.888). A landmark-geometry filter was tried and rejected:
# it passed food and rejected tilted faces. A non-face patch fed to a face-forgery model is a false-alarm risk.
MIN_FACE_SCORE = 0.85
FAKE_INDEX = 1  # GenD logits are [real, fake]

# GenD align_face template (eyes, nose, mouth corners), normalised to a unit square.
_TEMPLATE = np.array([[0.34, 0.46], [0.66, 0.46], [0.5, 0.64], [0.37, 0.82], [0.63, 0.82]], dtype=np.float32)


def align_face(img: np.ndarray, landmarks: np.ndarray, size: int = 256, scale: float = 1.3) -> np.ndarray:
    """Port of GenD's align_face (fixed target size): 5 landmarks → aligned, 1.3x-context crop."""
    import cv2

    dst = _TEMPLATE * size
    margin = size * (scale - 1) / 2.0
    dst = (dst + margin) * (size / (size + 2 * margin))
    m, _ = cv2.estimateAffinePartial2D(landmarks.astype(np.float32), dst.astype(np.float32), method=cv2.LMEDS)
    return cv2.warpAffine(img, m, (size, size), flags=cv2.INTER_LINEAR)


def detect_faces(img_bgr: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, float]]:
    """YuNet → [(box xywh, 5x2 landmarks, score)], largest faces first."""
    import cv2

    h, w = img_bgr.shape[:2]
    det = cv2.FaceDetectorYN.create(str(YUNET), "", (w, h), score_threshold=MIN_FACE_SCORE)
    _, faces = det.detect(img_bgr)
    out = []
    for f in faces if faces is not None else []:
        box, lms, score = f[:4], f[4:14].reshape(5, 2), float(f[14])
        if min(box[2], box[3]) >= MIN_FACE_PX:
            out.append((box, lms, score))
    return sorted(out, key=lambda t: -t[0][2] * t[0][3])[:MAX_FACES]


# Other GenD backbones from the same paper (Tab. 2). DINOv3_L is not listed: its backbone repo is gated for us (403).
GEND_VARIANTS = {
    "clip": (GEND_REPO, GEND_REVISION),
    "pe": ("yermandy/GenD_PE_L", "4fd5a38cf071af2640d314110826ed5cd25cab88"),  # pinned 2026-10-27
}


@lru_cache(maxsize=2)
def _gend(variant: str = "clip"):
    import importlib.util
    from unittest import mock

    import timm
    import torch
    from huggingface_hub import snapshot_download

    repo, revision = GEND_VARIANTS[variant]
    path = snapshot_download(repo, revision=revision)
    # Each variant ships its own modeling_gend.py; load it under a unique module name so variants don't collide.
    spec = importlib.util.spec_from_file_location(f"modeling_gend_{variant}", f"{path}/modeling_gend.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    from safetensors.torch import load_file

    # transformers>=5 builds models on the meta device inside from_pretrained, but GenD's __init__ itself calls
    # CLIPModel.from_pretrained — so construct it directly, then load GenD's own weights and require a full match.
    # The PE variant asks timm for pretrained backbone weights; GenD's file already holds every weight, so skip that
    # second ~1.2 GB download (the strict check below proves nothing was left at random init).
    real_create = timm.create_model
    with mock.patch.object(timm, "create_model", lambda *a, **k: real_create(*a, **{**k, "pretrained": False})):
        model = mod.GenD(mod.GenDConfig.from_pretrained(path))
    missing, unexpected = model.load_state_dict(load_file(f"{path}/model.safetensors"), strict=False)
    if missing or unexpected:
        raise RuntimeError(f"GenD weights mismatch: missing={missing[:5]} unexpected={unexpected[:5]}")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return model.to(device).eval(), device


def gend_faces(item: Item, variant: str = "clip") -> Signal:
    name = "GenD face-forgery detector" + ("" if variant == "clip" else f" ({variant.upper()})")
    import cv2
    import torch
    from PIL import Image

    t0 = time.perf_counter()
    img = cv2.imread(str(item.path), cv2.IMREAD_COLOR)
    if img is None:
        return Signal(name, Category.FACES, None, Rank.NA, "NO_FACE",
                      "Image could not be read for face analysis.", Policy.TRUST, seconds=time.perf_counter() - t0)
    faces = detect_faces(img)
    if not faces:
        return Signal(name, Category.FACES, None, Rank.NA, "NO_FACE",
                      "No clear face found, so face-swap analysis does not apply.", Policy.TRUST,
                      seconds=time.perf_counter() - t0)

    model, device = _gend(variant)
    crops = [Image.fromarray(cv2.cvtColor(align_face(img, lms), cv2.COLOR_BGR2RGB)) for _, lms, _ in faces]
    batch = torch.stack([model.feature_extractor.preprocess(c) for c in crops]).to(device)
    with torch.no_grad():
        probs = model(batch).softmax(dim=-1)[:, FAKE_INDEX].float().cpu().numpy()
    worst = int(np.argmax(probs))
    p = float(probs[worst])  # Hive: the highest face score decides
    op = OPERATING_POINT.get("GenD face-forgery detector", 0.5)
    rank = rank_for(p, low_max=0.5, high_min=op)  # votes only above its measured operating point
    shown = ">=99%" if p > 0.99 else "<1%" if p < 0.01 else f"{p:.0%}"
    n = len(faces)
    which = f" (face {worst + 1} of {n})" if n > 1 else ""
    evidence = {
        Rank.HIGH: f"Face-forgery detector (GenD) finds manipulation traces on a face{which}: {shown} likely fake.",
        Rank.UNCERTAIN: f"Face-forgery detector (GenD) is unsure about a face{which}: {shown} likely fake.",
        Rank.LOW: f"Face-forgery detector (GenD) finds no face manipulation across {n} face{'s' if n > 1 else ''}: {shown} likely fake.",
    }[rank]
    return Signal(
        name, Category.FACES, p, rank,
        "FACE_MANIPULATION" if rank is Rank.HIGH else "NO_STRONG_SIGNAL", evidence, Policy.TRUST,
        details={"model": GEND_VARIANTS[variant][0], "revision": GEND_VARIANTS[variant][1], "faces": [
            {"box": [round(float(v)) for v in b], "detector_score": round(s, 3), "p_fake": round(float(q), 4)}
            for (b, _, s), q in zip(faces, probs, strict=True)]},
        seconds=time.perf_counter() - t0,
    )




# ---------------------------------------------------------------------------------------------------------
# DF40 (CUHK-Shenzhen, NeurIPS 2024): CLIP ViT-L/14 detector trained on all 40 DF40 forgery methods, incl.
# InSwapper (FaceFusion / Deep-Live-Cam / Roop), SimSwap, e4s, FaceDancer, Wav2Lip, SadTalker, HeyGen.
# Architecture = DeepfakeBench CLIPDetector: vision_model.pooler_output → Linear(1024, 2), softmax[:, 1] = P(fake).
# Preprocessing = DeepfakeBench clip.yaml: aligned face crop → 224×224, mean = std = 0.5.
DF40_CKPT = ROOT / "models" / "df40" / "train_on_df40_clip_large.pth"  # Google Drive id 1MzvaQSE-SpH9a5mgCXxan_J_PTZbNaPa


@lru_cache(maxsize=1)
def _df40():
    import torch
    from transformers import CLIPVisionConfig, CLIPVisionModel

    sd = torch.load(DF40_CKPT, map_location="cpu", weights_only=True)
    sd = {k.removeprefix("module."): v for k, v in sd.get("state_dict", sd).items()}
    cfg = CLIPVisionConfig.from_pretrained("openai/clip-vit-large-patch14")
    model = CLIPVisionModel(cfg)
    backbone = getattr(model, "vision_model", model)  # transformers 5 flattened CLIPVisionModel into the transformer
    head = torch.nn.Linear(cfg.hidden_size, 2)
    b_missing, b_unexp = backbone.load_state_dict({k[9:]: v for k, v in sd.items() if k.startswith("backbone.")}, strict=False)
    head.load_state_dict({k[5:]: v for k, v in sd.items() if k.startswith("head.")})
    if b_missing or b_unexp:
        raise RuntimeError(f"DF40 weights mismatch: missing={b_missing[:5]} unexpected={b_unexp[:5]}")
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    return backbone.to(device).eval(), head.to(device).eval(), device


def df40_faces(item: Item) -> Signal:
    import cv2
    import torch

    name = "DF40 face-forgery detector"
    t0 = time.perf_counter()
    if not DF40_CKPT.is_file():
        return Signal(name, Category.FACES, None, Rank.NA, "MODEL_MISSING", "DF40 checkpoint not installed.",
                      Policy.TRUST, seconds=0.0)
    img = cv2.imread(str(item.path), cv2.IMREAD_COLOR)
    faces = detect_faces(img) if img is not None else []
    if not faces:
        return Signal(name, Category.FACES, None, Rank.NA, "NO_FACE",
                      "No clear face found, so face-swap analysis does not apply.", Policy.TRUST,
                      seconds=time.perf_counter() - t0)
    backbone, head, device = _df40()
    crops = [cv2.resize(cv2.cvtColor(align_face(img, lms), cv2.COLOR_BGR2RGB), (224, 224)) for _, lms, _ in faces]
    x = torch.from_numpy(np.stack(crops)).permute(0, 3, 1, 2).float().div(255).sub(0.5).div(0.5).to(device)
    with torch.no_grad():
        probs = torch.softmax(head(backbone(pixel_values=x).pooler_output), dim=1)[:, 1].float().cpu().numpy()
    worst = int(np.argmax(probs))
    p = float(probs[worst])
    rank = rank_for(p)
    shown = ">=99%" if p > 0.99 else "<1%" if p < 0.01 else f"{p:.0%}"
    which = f" (face {worst + 1} of {len(faces)})" if len(faces) > 1 else ""
    evidence = (f"Experimental face-swap detector (DF40, 40 methods) "
                f"{'flags swap/reenactment traces' if rank is Rank.HIGH else 'is unsure' if rank is Rank.UNCERTAIN else 'finds no swap traces'}"
                f"{which}: {shown}. Shown for context only; it does not vote.")
    # Policy.IGNORE: verified 27 Oct 2026, it scored a known-real FF++ face 0.997 fake (false-alarm risk, -5 each).
    # It did catch a modern swap GenD missed (0.998 vs 0.165), so it is displayed but never decides a verdict.
    return Signal(name, Category.FACES, p, rank, "FACE_MANIPULATION" if rank is Rank.HIGH else "NO_STRONG_SIGNAL",
                  evidence, Policy.IGNORE,
                  details={"checkpoint": DF40_CKPT.name, "faces": [round(float(q), 4) for q in probs]},
                  seconds=time.perf_counter() - t0)


def run(item: Item) -> list[Signal]:
    return [gend_faces(item), df40_faces(item)]
