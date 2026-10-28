import numpy as np
import soundfile as sf

from corncam.ingest import load_item
from corncam.schema import Rank
from corncam.signals import audio


def test_windows_cover_long_clip_evenly():
    wav = np.zeros(audio.SR * 30, np.float32)  # 30 s
    wins = audio.windows(wav)
    assert len(wins) == audio.MAX_WINDOWS
    assert wins[0][0] == 0.0 and abs(wins[-1][0] - 26.0) < 1e-6  # last window ends at the clip end
    assert all(len(w) == audio.WINDOW for _, w in wins)


def test_short_clip_is_one_window():
    assert len(audio.windows(np.zeros(audio.SR * 2, np.float32))) == 1


def test_prepare_window_pads_and_normalises():
    w = audio._prepare_window((0.01 * np.sin(np.arange(audio.SR) * 0.1)).astype(np.float32))
    assert len(w) == audio.WINDOW and np.abs(w).max() <= 1.0


def test_decode_resamples_to_16k_mono(tmp_path):
    p = tmp_path / "tone.wav"
    sf.write(p, 0.3 * np.sin(np.linspace(0, 2000, 44_100 * 2)).repeat(2).reshape(-1, 2), 44_100)
    wav = audio.decode(str(p))
    assert wav.dtype == np.float32 and abs(len(wav) - 2 * audio.SR) < audio.SR // 100


def test_silent_clip_is_not_judged(tmp_path):
    p = tmp_path / "silence.wav"
    sf.write(p, np.zeros(audio.SR * 3, np.float32), audio.SR)
    s = audio.pellav2(load_item(p))  # returns before the model is loaded
    assert s.rank is Rank.NA and s.reason_code == "NO_SPEECH"


def test_pure_tone_is_not_judged_as_a_voice(tmp_path):
    p = tmp_path / "tone.wav"
    t = np.arange(audio.SR * 3) / audio.SR
    sf.write(p, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), audio.SR)
    s = audio.pellav2(load_item(p))  # VAD gate returns before pellav2 is loaded
    assert s.rank is Rank.NA and s.reason_code == "NO_SPEECH"


def test_no_usable_evidence_is_called_real(tmp_path):
    from corncam.detect import detect

    p = tmp_path / "tone.wav"
    t = np.arange(audio.SR * 3) / audio.SR
    sf.write(p, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), audio.SR)
    v = detect(p)  # provenance n/a + no speech: nothing to judge -> must not be a false alarm
    assert v.label == "real"
