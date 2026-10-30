"""Tests for the post-finalize residual guard.

Regression coverage for the intermittent "first word dropped" bug: the guard
must drop Deepgram's trailing re-emissions of a just-finalized utterance, but
must NOT drop a short opener of a brand-new utterance that happens to be a
prefix/suffix of the previous one.
"""

from residual_guard import is_residual_repeat


class TestResidualRepeat:
    def test_exact_repeat_is_residual(self):
        prev = "okay well will it autoscroll now"
        assert is_residual_repeat(prev, prev) is True

    def test_short_opener_matching_prev_suffix_is_not_residual(self):
        # New utterance starts with "now"; prev ended with "now" -> must NOT drop.
        assert is_residual_repeat("now", "okay well will it autoscroll now") is False

    def test_short_opener_matching_prev_prefix_is_not_residual(self):
        assert is_residual_repeat("okay", "okay well will it autoscroll now") is False

    def test_single_common_opener_is_not_residual(self):
        for opener in ("so", "and", "well", "yeah", "i", "the"):
            assert is_residual_repeat(opener, "the meeting starts at three") is False, opener

    def test_trailing_tail_of_prev_is_residual(self):
        prev = "thanks everyone lets walk through the q3 rollout timeline"
        assert is_residual_repeat("through the q3 rollout timeline", prev) is True

    def test_case_and_whitespace_insensitive_exact(self):
        assert is_residual_repeat("  Okay   Well  ", "okay well") is True

    def test_empty_candidate_is_residual(self):
        assert is_residual_repeat("", "anything here") is True

    def test_no_prev_is_not_residual(self):
        assert is_residual_repeat("hello", "") is False
