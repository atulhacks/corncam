import pytest

from corncam import calibrate

PARAMS = {"a": 1.2, "b": 1.9, "train_prior": 0.5}


def test_no_params_is_identity():
    assert calibrate.apply(0.3, None) == 0.3


def test_calibration_is_monotonic():
    ps = [0.01, 0.1, 0.3, 0.5, 0.9]
    out = [calibrate.apply(p, PARAMS) for p in ps]
    assert out == sorted(out)


def test_lower_fake_prior_lowers_probability():
    base = calibrate.apply(0.2, PARAMS)
    assert calibrate.apply(0.2, PARAMS, prior=0.2) < base < calibrate.apply(0.2, PARAMS, prior=0.8)


def test_prior_equal_to_training_prior_changes_nothing():
    assert calibrate.apply(0.2, PARAMS, prior=0.5) == pytest.approx(calibrate.apply(0.2, PARAMS))


def test_invalid_prior_env_rejected(monkeypatch):
    monkeypatch.setenv("CORNCAM_FAKE_PRIOR", "1.5")
    with pytest.raises(ValueError):
        calibrate.pool_prior()
