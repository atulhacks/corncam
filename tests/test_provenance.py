from PIL import Image
from PIL.PngImagePlugin import PngInfo

from corncam.ingest import load_item
from corncam.schema import Rank
from corncam.signals.provenance import builtin_scan


def test_png_with_stable_diffusion_params_is_flagged(tmp_path):
    info = PngInfo()
    info.add_text("parameters", "a portrait\nSteps: 30, Sampler: DPM++ 2M, CFG scale: 7")
    p = tmp_path / "gen.png"
    Image.new("RGB", (64, 64)).save(p, pnginfo=info)
    s = builtin_scan(load_item(p))
    assert s.rank is Rank.HIGH and s.reason_code == "PROVENANCE_AI_TOOL"


def test_c2pa_ai_marker_is_decisive(tmp_path):
    p = tmp_path / "c2pa.jpg"
    Image.new("RGB", (64, 64)).save(p)
    p.write_bytes(p.read_bytes() + b"c2pa...digitalSourceType/trainedAlgorithmicMedia")
    s = builtin_scan(load_item(p))
    assert s.decisive and s.reason_code == "PROVENANCE_AI_DECLARED"


def test_camera_exif_is_weak_real_evidence(tmp_path):
    img = Image.new("RGB", (64, 64))
    exif = img.getexif()
    exif[0x010F], exif[0x0110] = "Apple", "iPhone 16"
    p = tmp_path / "photo.jpg"
    img.save(p, exif=exif)
    s = builtin_scan(load_item(p))
    assert s.rank is Rank.LOW and s.score is not None and s.score < 0.5


def test_plain_image_has_no_provenance_opinion(tmp_path):
    p = tmp_path / "plain.jpg"
    Image.new("RGB", (64, 64)).save(p)
    s = builtin_scan(load_item(p))
    assert s.rank is Rank.NA and s.score is None


def test_audio_format_guess_never_votes(tmp_path):
    import shutil

    import numpy as np
    import pytest
    import soundfile as sf

    from corncam.schema import Policy
    from corncam.signals import provenance

    if not shutil.which("aic"):
        pytest.skip("aicheck not installed")
    p = tmp_path / "voice_note.wav"  # mono 16 kHz 16-bit, like a phone voice note
    sf.write(p, np.zeros(16_000, np.float32), 16_000, subtype="PCM_16")
    voting = [s for s in provenance.aicheck_scan(load_item(p)) if s.policy is not Policy.IGNORE and s.score is not None]
    assert voting == []
