import json

import pytest

from corncam import ai

VERDICT = {
    "filename": "team7_secret_persona.png", "item_id": "ab" * 32, "media_type": "image", "label": "fake",
    "tier": "high", "p_fake": 0.91, "p_raw": 0.88, "reason_code": "FACE_MANIPULATION", "experimental": False,
    "signals": [{"name": "GenD face-forgery detector", "category": "faces", "score": 0.97, "rank": "high",
                 "policy": "trust", "evidence": "manipulation traces on a face"}],
}


def test_evidence_summary_never_contains_file_names_or_ids():
    sent = json.dumps(ai.evidence_summary(VERDICT))
    assert "team7_secret_persona" not in sent and VERDICT["item_id"] not in sent
    assert "0.97" in sent and "2 votes" in sent


def test_explain_uses_cache_and_never_resends(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "CACHE", tmp_path)
    calls = []

    def fake_chat(messages, **kw):
        calls.append(messages)
        return json.dumps({"headline": "A face looks edited", "explanation": "x", "triggers": [], "check_yourself": [],
                           "caveat": "y"})

    monkeypatch.setattr(ai, "chat", fake_chat)
    first = ai.explain(VERDICT)
    second = ai.explain(VERDICT)
    assert first["headline"] == "A face looks edited" and not first["cached"] and second["cached"]
    assert len(calls) == 1
    assert "team7_secret_persona" not in json.dumps(calls[0])


def test_not_configured_is_a_clear_error(monkeypatch, tmp_path):
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.setattr(ai, "ROOT", tmp_path)  # no .env here
    with pytest.raises(ai.AIError, match="not configured"):
        ai.chat([{"role": "user", "content": "hi"}])


def test_report_narrative_anonymises_items(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "CACHE", tmp_path)
    seen = []
    monkeypatch.setattr(ai, "chat", lambda m, **kw: seen.append(m) or json.dumps(
        {"summary": "s", "slipped_through": [], "improvements": []}))
    report = {"points": 5, "rows": [{"filename": "secret.jpg", "media_type": "image", "truth": "fake", "call": "fake",
                                     "confidence": 0.9, "reason_code": "X", "outcome": "caught", "points": 5,
                                     "why": ""}]}
    ai.report_narrative(report)
    assert "secret.jpg" not in json.dumps(seen) and "item 1" in json.dumps(seen)


def test_summary_states_when_calibration_flipped_the_verdict():
    v = {**VERDICT, "p_fake": 0.71, "p_raw": 0.31}
    assert "flipped the verdict" in ai.evidence_summary(v)["what_decided"]
    assert "flipped" not in ai.evidence_summary(VERDICT)["what_decided"]


def test_gemini_is_the_fallback_when_deepseek_fails(monkeypatch):
    monkeypatch.setattr(ai, "_key", lambda: "ds")
    monkeypatch.setattr(ai, "gemini_key", lambda: "gm")

    def down(*a, **k):
        raise ai.AIError("HTTP 503")

    monkeypatch.setattr(ai, "_deepseek_chat", down)
    seen = []
    monkeypatch.setattr(ai, "gemini_post", lambda model, body, timeout=60: seen.append(body) or
                        {"candidates": [{"content": {"parts": [{"text": "hello"}]}, "finishReason": "STOP"}]})
    assert ai.chat([{"role": "system", "content": "rules"}, {"role": "user", "content": "hi"}]) == "hello"
    assert seen[0]["systemInstruction"]["parts"][0]["text"] == "rules"
    assert seen[0]["contents"] == [{"role": "user", "parts": [{"text": "hi"}]}]
