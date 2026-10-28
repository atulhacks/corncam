import json

import pytest
from PIL import Image

from corncam import ai, investigate
from corncam.ingest import load_item
from corncam.schema import Category, Policy, Rank, Signal


@pytest.fixture
def img(tmp_path):
    p = tmp_path / "x.png"
    Image.new("RGB", (64, 64), (90, 90, 90)).save(p)
    return load_item(p)


@pytest.fixture
def fake_tools(monkeypatch):
    calls = []

    def run_tool(item, name, args):
        calls.append((name, args))
        cat = {"check_provenance": Category.PROVENANCE, "scan_whole_image": Category.GENERATIVE_AI,
               "check_faces": Category.FACES}[name]
        return [Signal(f"{name} detector", cat, 0.2, Rank.LOW, "NO_STRONG_SIGNAL", "nothing found", Policy.TRUST)]

    monkeypatch.setattr(investigate, "run_tool", run_tool)
    return calls


def _types(events):
    return [e["type"] for e in events]


def test_without_ai_all_core_checks_run_and_a_verdict_is_fused(img, fake_tools, monkeypatch):
    monkeypatch.setattr(ai, "configured", lambda: False)
    events = list(investigate.investigate(img))
    assert _types(events)[0] == "start" and _types(events)[-1] == "done"
    assert [c[0] for c in fake_tools] == ["check_provenance", "scan_whole_image", "check_faces"]
    verdict = next(e for e in events if e["type"] == "verdict")["verdict"]
    assert verdict["label"] in ("fake", "real")


def test_ai_adds_depth_but_cannot_skip_core_or_use_wrong_tools(img, fake_tools, monkeypatch):
    monkeypatch.setattr(ai, "configured", lambda: True)
    monkeypatch.setattr(ai, "explain", lambda v: {"headline": "h", "explanation": "e"})
    script = iter([
        {"role": "assistant", "content": "Borderline; rescan with more crops.", "tool_calls": [
            {"id": "1", "type": "function", "function": {"name": "scan_whole_image", "arguments": '{"crops": 5}'}},
            {"id": "2", "type": "function", "function": {"name": "check_voice", "arguments": "{}"}}]},
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "3", "type": "function", "function": {"name": "finish", "arguments": "{}"}}]},
    ])
    sent = []
    monkeypatch.setattr(ai, "chat_tools", lambda messages, tools: sent.append(json.dumps(messages)) or next(script))
    events = list(investigate.investigate(img))
    names = [c[0] for c in fake_tools]
    assert names[0] == "scan_whole_image" and fake_tools[0][1] == {"crops": 5}  # the AI's choice ran first
    assert "check_voice" not in names  # not applicable to images, refused
    assert {"check_provenance", "check_faces"} <= set(names)  # coverage guarantee
    assert any(e["type"] == "thought" and "rescan" in e["text"] for e in events)
    assert "x.png" not in "".join(sent)  # file names never go to the AI
