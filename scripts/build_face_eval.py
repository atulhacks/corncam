"""Build the face-swap test set: data/face_eval/{real,fake}/.

real: in-the-wild real photos with a clear face, from the OpenFake Reddit test split (labelled real).
fake: DF40 test-split face swaps for one method (e.g. InSwapper), already face-cropped by the DF40 authors.
Neither half is used for training anything, so the set stays held-out for every face model we try.

Usage: uv run python scripts/build_face_eval.py <df40_method.zip> [--n 100] [--seed 0]
"""

from __future__ import annotations

import argparse
import random
import zipfile
from pathlib import Path

import cv2
import numpy as np
import pyarrow.parquet as pq

from corncam.signals.face import detect_faces

ROOT = Path(__file__).resolve().parents[1]
PARQUET = ROOT / "data" / "openfake_tiny" / "reddit" / "test-00000-of-00001.parquet"
OUT = ROOT / "data" / "face_eval"


JPEG_Q = 85


def _save_normalised(arr: np.ndarray, path: Path) -> None:
    """Every image, real or fake, becomes a 256x256 JPEG at the same quality, so format and compression can't
    reveal the label (otherwise a model could score well by spotting PNG vs JPEG or resolution)."""
    arr = cv2.resize(arr, (256, 256), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path.with_suffix(".jpg")), arr, [cv2.IMWRITE_JPEG_QUALITY, JPEG_Q])


def _crop_like_df40(img: np.ndarray, box: np.ndarray, scale: float = 1.3, size: int = 256) -> np.ndarray | None:
    """Square crop of the face box enlarged 1.3x, resized to 256: the DeepfakeBench/DF40 crop, so real and fake
    faces differ only in manipulation, not in framing (a detector must not win by spotting crop style)."""
    x, y, w, h = (float(v) for v in box)
    cx, cy, side = x + w / 2, y + h / 2, max(w, h) * scale
    x0, y0 = round(cx - side / 2), round(cy - side / 2)
    x1, y1 = round(cx + side / 2), round(cy + side / 2)
    H, W = img.shape[:2]
    if x0 < 0 or y0 < 0 or x1 > W or y1 > H:
        return None  # face too close to the edge for a full-context crop
    return cv2.resize(img[y0:y1, x0:x1], (size, size), interpolation=cv2.INTER_AREA)


def real_faces(n: int, seed: int) -> int:
    out = OUT / "real"
    out.mkdir(parents=True, exist_ok=True)
    labels = pq.read_table(PARQUET, columns=["label"]).column("label").to_pylist()
    idx = [i for i, lab in enumerate(labels) if str(lab).lower() in {"0", "real"}]
    random.Random(seed).shuffle(idx)
    images = pq.read_table(PARQUET, columns=["image"]).column("image")
    kept = 0
    for i in idx:
        img = images[i].as_py()
        raw = img["bytes"] if isinstance(img, dict) else img
        arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        faces = detect_faces(arr) if arr is not None else []
        if not faces:
            continue
        crop = _crop_like_df40(arr, faces[0][0])
        if crop is None:
            continue
        _save_normalised(crop, out / f"reddit_{i:05d}")
        kept += 1
        if kept >= n:
            break
    return kept


def fake_faces(zip_path: Path, n: int, seed: int) -> int:
    method = zip_path.stem
    out = OUT / "fake"
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        names = [m for m in z.namelist() if m.lower().endswith((".png", ".jpg", ".jpeg"))]
        # One frame per video: consecutive frames of one clip are near-duplicates and would inflate the count.
        by_video: dict[str, str] = {}
        for m in sorted(names):
            by_video.setdefault(str(Path(m).parent), m)
        picks = list(by_video.values())
        random.Random(seed).shuffle(picks)
        kept = 0
        for m in picks:
            data = z.read(m)
            arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
            if arr is None:
                continue
            _save_normalised(arr, out / f"{method}_{kept:04d}")
            kept += 1
            if kept >= n:
                break
    return kept


def ffhq_faces(parquet: Path, n: int, seed: int) -> int:
    """Real Flickr portraits (FFHQ, via the 140k real/fake faces set), already face-centred at 256 px."""
    out = OUT / "real"
    out.mkdir(parents=True, exist_ok=True)
    col = pq.read_table(parquet, columns=["image"]).column("image")
    idx = list(range(len(col)))
    random.Random(seed).shuffle(idx)
    kept = 0
    for i in idx:
        img = col[i].as_py()
        raw = img["bytes"] if isinstance(img, dict) else img
        arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
        if arr is None:
            continue
        _save_normalised(arr, out / f"ffhq_{i:06d}")
        kept += 1
        if kept >= n:
            break
    return kept


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("zip", type=Path)
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--ffhq", type=Path, help="parquet of real FFHQ faces to add to the real half")
    a = ap.parse_args()
    print("real faces (reddit):", real_faces(a.n, a.seed))
    if a.ffhq:
        print("real faces (ffhq):", ffhq_faces(a.ffhq, a.n, a.seed))
    print("fake faces:", fake_faces(a.zip, a.n, a.seed))
