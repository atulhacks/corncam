from PIL import Image

from corncam import forensics
from corncam.ingest import load_item
from corncam.schema import Policy


def test_forensics_are_advisory_and_keep_payloads_out_of_evidence(tmp_path):
    t = tmp_path / "post.txt"
    t.write_text("Hello\u200b world aGVsbG8gZnJvbSBhIGhpZGRlbiBtZXNzYWdl https://example.org/a")
    s = forensics.hidden_data(load_item(t))[0]
    assert s.policy is Policy.IGNORE and s.score is None
    assert s.details["base64_decoded"] == ["hello from a hidden message"]
    assert "hidden message" not in s.evidence and "example.org" not in s.evidence  # the AI reads evidence only


def test_appended_bytes_and_chat_forward_are_found(tmp_path, monkeypatch):
    monkeypatch.setattr(forensics, "ARTIFACTS", tmp_path / "studio")
    p = tmp_path / "a.jpg"
    Image.new("RGB", (720, 540), (90, 100, 110)).save(p, quality=70)
    p.write_bytes(p.read_bytes() + b"SECRET" * 10)
    item = load_item(p)
    assert forensics.hidden_data(item)[0].details["appended_bytes"] == 60
    assert forensics.jpeg_forensics(item)[0].reason_code == "HEAVY_RECOMPRESSION"
    ela = forensics.error_level(item)[0]
    assert ela.details["artifact"].startswith("/api/studio/artifacts/") and ela.policy is Policy.IGNORE
