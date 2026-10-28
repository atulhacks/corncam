import pytest
from PIL import Image

from corncam import forger


@pytest.fixture
def tmp_forge(tmp_path, monkeypatch):
    monkeypatch.setattr(forger, "PERSONAS", tmp_path / "personas")
    return tmp_path


def test_real_people_are_refused(tmp_forge):
    with pytest.raises(forger.ForgerError):
        forger.save_persona("Someone Real", "", "", "", "", synthetic=False)


def test_persona_roundtrip_and_ids_are_safe(tmp_forge):
    p = forger.save_persona("Aanya Rao (test)", "fictional", "woman, 28", "warm", "fictional test persona", True)
    assert p.id == "aanya-rao-test" and p.synthetic
    assert [x.id for x in forger.list_personas()] == ["aanya-rao-test"]
    with pytest.raises(forger.ForgerError):
        forger.load_persona("../etc")


def test_launder_strips_metadata_and_resizes(tmp_path):
    src = tmp_path / "gen.png"
    img = Image.new("RGB", (2048, 1536), (120, 80, 60))
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("parameters", "a photo, Steps: 4, Sampler: flux")  # generator metadata a careless forger leaves
    img.save(src, pnginfo=info)
    dst = tmp_path / "out.jpg"
    steps = forger.launder_image(src, dst)
    out = Image.open(dst)
    assert max(out.size) == 1080 and out.format == "JPEG"
    assert "parameters" not in out.info and "metadata stripped" in steps


def test_whatsapp_preset_is_a_smaller_double_compressed_forward(tmp_path):
    src = tmp_path / "gen.png"
    Image.new("RGB", (2048, 1536), (120, 80, 60)).save(src)
    steps = forger.launder_image(src, tmp_path / "w.jpg", "whatsapp")
    assert max(Image.open(tmp_path / "w.jpg").size) == 720
    assert "JPEG q80 then JPEG q70" in steps
    with pytest.raises(forger.ForgerError):
        forger.launder_image(src, tmp_path / "x.jpg", "instagram")


def test_prompt_keeps_identity_when_editing_from_reference():
    p = forger.Persona(id="x", name="X", bio="b", synthetic=True, appearance="a woman in her 30s")
    assert "same person" in forger.image_prompt(p, "at a market", edit=True)
    assert "a woman in her 30s" in forger.image_prompt(p, "at a market", edit=False)


def test_nano_banana_saves_the_returned_image_and_explains_billing(tmp_path, monkeypatch):
    import base64
    import io

    from corncam import ai

    p = forger.Persona(id="x", name="X", bio="b", synthetic=True, appearance="a woman in her 30s")
    buf = io.BytesIO()
    Image.new("RGB", (30, 40), (10, 20, 30)).save(buf, "JPEG")
    reply = {"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/jpeg",
                                                                   "data": base64.b64encode(buf.getvalue()).decode()}}]}}]}
    sent = []
    monkeypatch.setattr(ai, "gemini_post", lambda model, body, timeout=90: sent.append(body) or reply)
    out = tmp_path / "c.png"
    meta = forger.generate_image_gemini(p, "at a market", 1, out)
    assert Image.open(out).size == (30, 40) and "nano-banana" in meta["model"]
    assert sent[0]["generationConfig"]["responseModalities"] == ["IMAGE"]

    def no_billing(*a, **k):
        raise ai.AIError("Gemini request failed: HTTP 429 quota exceeded for free tier")

    monkeypatch.setattr(ai, "gemini_post", no_billing)
    with pytest.raises(forger.ForgerError, match="billing"):
        forger.generate_image_gemini(p, "at a market", 1, out)
