from corncam import fusion
from corncam.schema import Category, Policy, Rank, Signal


def sig(score, rank, category=Category.GENERATIVE_AI, policy=Policy.INCLUDE, decisive=False, code="X"):
    return Signal("s", category, score, rank, code, "e", policy, decisive)


def test_decisive_provenance_settles_verdict():
    signals = [sig(0.99, Rank.HIGH, Category.PROVENANCE, Policy.TRUST, decisive=True), sig(0.1, Rank.LOW)]
    assert fusion.p_fake(signals) >= 0.99
    assert fusion.tier(signals, experimental=True) is Rank.HIGH


def test_trusted_detector_casts_two_votes():
    signals = [sig(0.9, Rank.HIGH, policy=Policy.TRUST)]
    assert fusion.count_votes(signals) == 2
    assert fusion.tier(signals, experimental=False) is Rank.HIGH


def test_experimental_demotes_two_votes_to_uncertain():
    signals = [sig(0.9, Rank.HIGH, policy=Policy.TRUST)]
    assert fusion.tier(signals, experimental=True) is Rank.UNCERTAIN


def test_three_votes_override_experimental():
    signals = [sig(0.9, Rank.HIGH, policy=Policy.TRUST), sig(0.8, Rank.HIGH)]
    assert fusion.tier(signals, experimental=True) is Rank.HIGH


def test_noise_only_votes_are_demoted():
    signals = [sig(0.8, Rank.HIGH, Category.VISUAL_NOISE), sig(0.7, Rank.HIGH, Category.VISUAL_NOISE)]
    assert fusion.tier(signals, experimental=False) is Rank.UNCERTAIN


def test_no_evidence_is_coin_flip_and_low_tier():
    signals = [sig(None, Rank.NA)]
    assert fusion.p_fake(signals) == 0.5
    assert fusion.tier(signals, experimental=False) is Rank.LOW


def test_trusted_weighs_more_in_probability():
    trusted_fake = [sig(0.9, Rank.HIGH, policy=Policy.TRUST), sig(0.2, Rank.LOW)]
    assert fusion.p_fake(trusted_fake) > 0.5


def test_strongest_prefers_decisive_for_fake():
    d = sig(0.99, Rank.HIGH, Category.PROVENANCE, Policy.TRUST, decisive=True, code="PROVENANCE_AI_DECLARED")
    assert fusion.strongest([sig(0.95, Rank.HIGH), d], "fake") is d


def test_fake_label_with_no_votes_is_shown_uncertain():
    signals = [sig(0.2, Rank.LOW, policy=Policy.TRUST)]
    assert fusion.reconcile(Rank.LOW, "fake", signals) is Rank.UNCERTAIN


def test_real_label_with_strong_votes_is_shown_uncertain():
    signals = [sig(0.9, Rank.HIGH, policy=Policy.TRUST)]
    assert fusion.reconcile(Rank.HIGH, "real", signals) is Rank.UNCERTAIN


def test_decisive_provenance_is_never_reconciled():
    d = sig(0.99, Rank.HIGH, Category.PROVENANCE, Policy.TRUST, decisive=True)
    assert fusion.reconcile(Rank.HIGH, "fake", [d]) is Rank.HIGH


def test_consistent_tiers_pass_through():
    assert fusion.reconcile(Rank.HIGH, "fake", []) is Rank.HIGH
    assert fusion.reconcile(Rank.LOW, "real", []) is Rank.LOW


def _named(name, score, category, policy=Policy.TRUST):
    return Signal(name, category, score, Rank.HIGH if score > 0.5 else Rank.LOW, "X", "", policy)


def test_face_swap_is_not_cancelled_by_the_whole_image_detector():
    # A swapped face on a real photo: the whole-image detector rightly says "not generated", the face model says "fake".
    signals = [_named("Smaug AI-image detector", 0.01, Category.GENERATIVE_AI),
               _named("GenD face-forgery detector", 0.97, Category.FACES)]
    assert fusion.p_fake(signals) > 0.5


def test_face_model_below_its_operating_point_does_not_convict():
    # GenD flags ~21% of real faces at 0.5 but ~6% at 0.8; 0.6 must stay below the call threshold.
    signals = [_named("Smaug AI-image detector", 0.01, Category.GENERATIVE_AI),
               _named("GenD face-forgery detector", 0.6, Category.FACES)]
    assert fusion.p_fake(signals) < 0.5


def test_pixel_noise_cannot_convict_on_its_own():
    signals = [_named("Smaug AI-image detector", 0.2, Category.GENERATIVE_AI),
               _named("aicheck pixel heuristics", 0.6, Category.VISUAL_NOISE, Policy.INCLUDE)]
    assert abs(fusion.p_fake(signals) - 0.2) < 1e-6
