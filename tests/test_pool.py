import json

import pytest

from corncam import pool as pool_mod


@pytest.fixture
def pool(tmp_path, monkeypatch):
    for name, sub in {"POOL": "", "ITEMS": "items", "VERDICTS": "verdicts"}.items():
        monkeypatch.setattr(pool_mod, name, tmp_path / sub if sub else tmp_path)
    monkeypatch.setattr(pool_mod, "INDEX", tmp_path / "index.json")

    def fake_detect(path):
        class V:
            def to_dict(self):
                return {"label": "fake", "tier": "high", "p_fake": 0.9, "confidence": 0.9,
                        "reason_code": "X", "reason_text": "because"}
        return V()

    monkeypatch.setattr(pool_mod, "detect", fake_detect)
    return pool_mod.Pool()


def test_add_dedupes_by_content(pool):
    a = pool.add("a.jpg", b"same-bytes")
    b = pool.add("b.jpg", b"same-bytes")
    assert a.sha == b.sha and pool.summary()["total"] == 1


def test_worker_analyses_queue_and_export_has_reason(pool):
    pool.add("a.jpg", b"one")
    pool.analyse_all()
    for _ in range(200):
        if pool.summary()["done"] == 1:
            break
        import time

        time.sleep(0.01)
    assert pool.summary() == {**pool.summary(), "done": 1, "fake": 1}
    rows = json.loads(pool.submission("json"))
    assert rows[0]["verdict"] == "fake" and rows[0]["reason"] == "because"
    assert "verdict,confidence" in pool.submission("csv").splitlines()[0].replace("sha256,", "").replace("item,", "")


def test_clear_removes_items(pool):
    pool.add("a.jpg", b"one")
    pool.clear()
    assert pool.summary()["total"] == 0
