import pytest

from corncam import cache


@pytest.fixture(autouse=True)
def isolated_cache(tmp_path, monkeypatch):
    """Tests never read or write the real evidence cache in data/."""
    monkeypatch.setattr(cache, "CACHE_DIR", tmp_path / "cache")
