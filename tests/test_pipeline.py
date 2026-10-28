import re
from pathlib import Path

from corncam import pipeline

SIGNALS = Path(__file__).resolve().parents[1] / "src" / "corncam" / "signals"


def _described() -> set[str]:
    return {d["name"] for spec in pipeline.MEDIA.values() for lane in spec["lanes"] for d in lane["detectors"]}


def test_every_emitted_detector_name_is_described():
    # Signal names are the first string argument of Signal(...) or a `name = "..."` binding in the detector modules.
    emitted = set()
    for f in SIGNALS.glob("*.py"):
        src = f.read_text()
        emitted |= set(re.findall(r'Signal\(\s*"([^"]+)"', src)) | set(re.findall(r'\bname = "([^"]+)"', src))
    generic = {"aicheck", "Video frames"}  # n/a placeholders, never scored
    missing = emitted - _described() - generic
    assert not missing, f"describe these detectors in pipeline.MEDIA: {missing}"


def test_describe_reports_coverage():
    d = pipeline.describe()
    assert d["media"]["image"]["covered"] and not d["media"]["video"]["covered"]
    assert d["media"]["text"]["planned"]
