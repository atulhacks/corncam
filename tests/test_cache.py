from PIL import Image

from corncam import cache, detect, investigate
from corncam.ingest import load_item
from corncam.schema import Category, Policy, Rank, Signal


def _sig(score=0.2):
    return Signal("Smaug AI-image detector", Category.GENERATIVE_AI, score, Rank.LOW, "NO_STRONG_SIGNAL", "nothing",
                  Policy.TRUST, details={"crops": 3}, seconds=1.5)


def _img(tmp_path):
    p = tmp_path / "x.png"
    Image.new("RGB", (32, 32), (5, 6, 7)).save(p)
    return p


def test_same_file_is_scanned_once_and_the_verdict_is_fused_again(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(detect, "collect_signals", lambda item: calls.append(1) or [_sig()])
    p = _img(tmp_path)
    v1, v2 = detect.detect(p), detect.detect(p)
    assert len(calls) == 1 and v1.p_fake == v2.p_fake
    assert v2.signals[0].category is Category.GENERATIVE_AI and v2.signals[0].policy is Policy.TRUST  # enums restored


def test_version_bump_and_evaluation_bypass_the_cache(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(detect, "collect_signals", lambda item: calls.append(1) or [_sig()])
    p = _img(tmp_path)
    detect.detect(p)
    detect.detect(p, use_cache=False)  # evaluation path
    monkeypatch.setattr(cache, "SIGNALS_VERSION", "next")
    detect.detect(p)
    assert len(calls) == 3


def test_investigator_reuses_tool_results_and_says_so(tmp_path, monkeypatch):
    from corncam import ai

    monkeypatch.setattr(ai, "configured", lambda: False)
    runs = []
    monkeypatch.setattr(investigate, "run_tool", lambda item, name, args: runs.append(name) or [_sig()])
    item = load_item(_img(tmp_path))
    first = [e for e in investigate.investigate(item) if e["type"] == "tool_result"]
    second = [e for e in investigate.investigate(item) if e["type"] == "tool_result"]
    assert runs and len(runs) == len(first)  # second run executed nothing
    assert not any(e["cached"] for e in first) and all(e["cached"] for e in second)


def test_corrupt_entry_is_a_miss(tmp_path):
    cache.put("ab" * 32, "detect", [_sig()])
    f = next(cache.CACHE_DIR.glob("*/*/*.json"))
    f.write_text("{not json")
    assert cache.get("ab" * 32, "detect") is None
