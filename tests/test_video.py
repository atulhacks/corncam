import itertools
import shutil
import subprocess

import pytest

from corncam.signals import video

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture
def clip(tmp_path):
    p = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=10",
                    "-pix_fmt", "yuv420p", "-y", str(p)], check=True)
    return p


def test_duration(clip):
    assert video.duration(clip) == pytest.approx(4.0, abs=0.2)


def test_extract_frames_evenly_spaced(clip, tmp_path):
    out = tmp_path / "frames"
    out.mkdir()
    frames = video.extract_frames(clip, out, n=4)
    assert [round(t, 1) for t, _ in frames] == [0.5, 1.5, 2.5, 3.5]
    assert all(p.stat().st_size > 0 for _, p in frames)


def test_unreadable_video_gives_no_frames(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"not a video")
    assert video.extract_frames(bad, tmp_path) == []


def test_select_frames_skips_black_frames_and_stays_spread(tmp_path):
    # 2 s of black then 4 s of a detailed test pattern: no black frame should be picked.
    p = tmp_path / "mixed.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=2:r=10",
                    "-f", "lavfi", "-i", "testsrc=duration=4:size=320x240:rate=10",
                    "-filter_complex", "[0][1]concat=n=2:v=1:a=0", "-pix_fmt", "yuv420p", "-y", str(p)], check=True)
    out = tmp_path / "frames"
    out.mkdir()
    picks = video.select_frames(p, out, n=3, candidates=12)
    assert len(picks) == 3
    assert all(t > 2.0 for t, _, _ in picks)  # black intro skipped
    times = [t for t, _, _ in picks]
    assert min(b - a for a, b in itertools.pairwise(times)) >= 6.0 / (2 * 3) - 1e-6  # spread out
