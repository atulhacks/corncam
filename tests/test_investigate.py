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


@pytest.fixture
def studio_tools(monkeypatch):
    calls = []

    def run_tool(item, name, args):
        calls.append(name)
        if name in investigate.FORENSIC:
            return [Signal(f"{name} advisory", Category.PROVENANCE, None, Rank.UNCERTAIN, "X", "found", Policy.IGNORE)]
        cat = {"check_provenance": Category.PROVENANCE, "scan_whole_image": Category.GENERATIVE_AI,
               "check_faces": Category.FACES}[name]
        return [Signal(f"{name} detector", cat, 0.2, Rank.LOW, "NO_STRONG_SIGNAL", "nothing", Policy.TRUST)]

    monkeypatch.setattr(investigate, "run_tool", run_tool)
    return calls


def test_studio_requested_nodes_run_but_never_reach_the_verdict(img, studio_tools, monkeypatch):
    monkeypatch.setattr(ai, "configured", lambda: False)
    events = list(investigate.investigate(img, goal="", requested=["error_level", "check_voice"]))
    assert "error_level" in studio_tools and "check_voice" not in studio_tools  # voice does not apply to images
    verdict = next(e for e in events if e["type"] == "verdict")["verdict"]
    assert not any("advisory" in s["name"] for s in verdict["signals"])  # forensics are shown, never fused
    assert any(e["type"] == "tool_result" and e["tool"] == "error_level" for e in events)


def test_plain_investigation_cannot_use_studio_tools(img, studio_tools, monkeypatch):
    monkeypatch.setattr(ai, "configured", lambda: True)
    monkeypatch.setattr(ai, "explain", lambda v: {"headline": "h", "explanation": "e"})
    seen_tools, sent = [], []
    script = iter([
        {"role": "assistant", "content": "", "tool_calls": [
            {"id": "1", "type": "function", "function": {"name": "error_level", "arguments": "{}"}},
            {"id": "2", "type": "function", "function": {"name": "finish", "arguments": "{}"}}]},
    ])

    def chat_tools(messages, tools):
        seen_tools.append({t["function"]["name"] for t in tools})
        sent.append(json.dumps(messages))
        return next(script)

    monkeypatch.setattr(ai, "chat_tools", chat_tools)
    list(investigate.investigate(img))
    assert "error_level" not in studio_tools and "error_level" not in seen_tools[0]

    studio_tools.clear()
    script = iter([{"role": "assistant", "content": "Checking origin.", "tool_calls": [
        {"id": "1", "type": "function", "function": {"name": "origin_metadata", "arguments": "{}"}},
        {"id": "2", "type": "function", "function": {"name": "finish", "arguments": "{}"}}]}])
    list(investigate.investigate(img, goal="Where was this photo taken from?"))
    assert "origin_metadata" in studio_tools
    assert "Where was this photo taken from?" in sent[-1] and "x.png" not in sent[-1]


def test_whole_image_crops_are_clamped_to_what_smaug_accepts(img, monkeypatch):
    from corncam.signals import image as image_signals

    seen = []
    monkeypatch.setattr(image_signals, "smaug", lambda item, crops: seen.append(crops) or "s")
    for asked in (5, 4, 3, 2, 1, 0):
        investigate.run_tool(img, "scan_whole_image", {"crops": asked})
    assert set(seen) <= {1, 3} and seen == [3, 3, 3, 3, 1, 3]  # Smaug asserts crops in (1, 3)
