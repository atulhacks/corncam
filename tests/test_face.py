import numpy as np

from corncam.ingest import load_item
from corncam.schema import Rank
from corncam.signals import face


def test_align_face_maps_landmarks_to_template():
    import cv2

    img = np.zeros((400, 400, 3), np.uint8)
    lms = np.array([[150, 180], [250, 180], [200, 240], [160, 300], [240, 300]], np.float32)
    for x, y in lms.astype(int):
        cv2.circle(img, (x, y), 3, (255, 255, 255), -1)
    out = face.align_face(img, lms)
    assert out.shape == (256, 256, 3)
    # GenD template: left eye (0.34, 0.46) with 1.3x context → ((t*256 + 38.4) * 256/332.8) ≈ (96.5, 120.1)
    assert out[116:125, 92:101, 0].max() > 128


def test_image_without_face_is_not_judged(tmp_path):
    from PIL import Image

    p = tmp_path / "flat.png"
    Image.new("RGB", (320, 240), (40, 120, 200)).save(p)
    s = face.gend_faces(load_item(p))  # returns before the model is loaded
    assert s.rank is Rank.NA and s.reason_code == "NO_FACE"
