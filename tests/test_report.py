import pytest

from corncam import report


def _v(sha, name, label, p, media="image", signals=None, experimental=False):
    return {"sha": sha, "filename": name, "verdict": {
        "label": label, "p_fake": p, "confidence": max(p, 1 - p), "tier": "low", "reason_code": "X",
        "media_type": media, "experimental": experimental, "signals": signals or []}}


def test_parse_key_accepts_common_column_names():
    rows = report.parse_key("Filename,Truth,Team\na.jpg,FAKE,red\nb.jpg,0,blue\n")
    assert rows == [{"id": "a.jpg", "truth": "fake", "team": "red"}, {"id": "b.jpg", "truth": "real", "team": "blue"}]


def test_parse_key_rejects_unknown_labels():
    with pytest.raises(report.KeyError_):
        report.parse_key("item,label\na.jpg,maybe\n")
    with pytest.raises(report.KeyError_):
        report.parse_key("foo,bar\n1,2\n")


def test_points_follow_the_arena_rules():
    verdicts = [_v("1", "a", "fake", 0.9), _v("2", "b", "real", 0.1), _v("3", "c", "fake", 0.7),
                _v("4", "d", "real", 0.2)]
    key = [{"id": "a", "truth": "fake"}, {"id": "b", "truth": "real"}, {"id": "c", "truth": "real"},
           {"id": "4", "truth": "fake"}, {"id": "missing.jpg", "truth": "fake"}]
    r = report.build(verdicts, key)
    assert r["counts"] == {"caught": 1, "cleared": 1, "false_alarm": 1, "missed": 1}
    assert r["points"] == 5 + 3 - 5 - 3
    assert r["unmatched_key"] == ["missing.jpg"]
    assert [x["filename"] for x in r["slipped"]] == ["d"]
    assert [x["filename"] for x in r["false_alarms"]] == ["c"]


def test_face_swap_miss_names_the_face_models():
    sig = [{"name": "GenD face-forgery detector", "score": 0.17, "rank": "low", "reason_code": "NO_STRONG_SIGNAL"},
           {"name": "DF40 face-forgery detector", "score": 0.99, "rank": "high", "reason_code": "FACE_MANIPULATION"}]
    r = report.build([_v("1", "swap.jpg", "real", 0.04, signals=sig)], [{"id": "swap.jpg", "truth": "fake"}])
    assert "Face swap" in r["slipped"][0]["why"]
    assert "Fakes that slipped through" in report.to_markdown(r)


def test_calibration_driven_false_alarm_is_named():
    v = _v("1", "real.jpg", "fake", 0.71)
    v["verdict"]["p_raw"] = 0.31
    r = report.build([v], [{"id": "real.jpg", "truth": "real"}])
    assert "calibration" in r["false_alarms"][0]["why"]
