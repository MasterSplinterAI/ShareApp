"""Tests for codeswitch_source_language helpers."""

from codeswitch_source_language import (
    effective_source_language,
    lane_is_same_language,
    next_source_flip,
    normalize_language_code,
    speech_data_detected_language,
)


class _FakeLang:
    def __init__(self, code: str):
        self.language = code


class TestNormalizeLanguageCode:
    def test_strips_region(self):
        assert normalize_language_code("en-US") == "en"

    def test_empty(self):
        assert normalize_language_code("") == ""
        assert normalize_language_code(None) == ""


class TestSpeechDataDetectedLanguage:
    def test_string_language(self):
        assert speech_data_detected_language(type("SD", (), {"language": "es"})()) == "es"

    def test_nested_language_object(self):
        assert speech_data_detected_language(type("SD", (), {"language": _FakeLang("es-MX")})()) == "es"

    def test_missing_language(self):
        assert speech_data_detected_language(object()) == ""

    def test_ignores_deepgram_multi_placeholder(self):
        # Deepgram sets SpeechData.language='multi' when alt['languages'] is absent
        assert speech_data_detected_language(type("SD", (), {"language": "multi"})()) == ""
        assert speech_data_detected_language(type("SD", (), {"language": "auto"})()) == ""
        assert speech_data_detected_language(type("SD", (), {"language": "und"})()) == ""


class TestEffectiveSourceLanguage:
    def test_defaults_to_configured(self):
        assert effective_source_language("en", "", "en") == "en"

    def test_switches_on_detected_codeswitch(self):
        assert effective_source_language("en", "es", "en") == "es"

    def test_keeps_detected_until_profile_language_returns(self):
        assert effective_source_language("en", "en", "es") == "en"

    def test_ignores_too_short_detection(self):
        assert effective_source_language("en", "e", "en") == "en"

    def test_does_not_flip_on_empty_detection_mid_codeswitch(self):
        assert effective_source_language("en", "", "es") == "es"


class TestNextSourceFlip:
    """Real-time code-switch detection without 1-word noise flips."""

    def test_final_detection_flips_immediately(self):
        assert next_source_flip("es", "en", "", 0, is_final=True, word_count=2) == (
            "en",
            "",
            0,
            True,
        )

    def test_interim_with_three_words_flips_immediately_for_live_translation(self):
        assert next_source_flip("es", "en", "", 0, is_final=False, word_count=3) == (
            "en",
            "",
            0,
            True,
        )

    def test_short_interim_needs_two_agreeing_detections(self):
        assert next_source_flip("en", "es", "", 0, is_final=False, word_count=1) == (
            "en",
            "es",
            1,
            False,
        )
        assert next_source_flip("en", "es", "es", 1, is_final=False, word_count=2) == (
            "es",
            "",
            0,
            True,
        )

    def test_disagreeing_short_interim_restarts_count(self):
        assert next_source_flip("en", "fr", "es", 1, is_final=False, word_count=1) == (
            "en",
            "fr",
            1,
            False,
        )

    def test_detection_matching_current_clears_pending(self):
        assert next_source_flip("es", "es", "fr", 1, is_final=False, word_count=2) == (
            "es",
            "",
            0,
            False,
        )

    def test_empty_detection_keeps_state(self):
        assert next_source_flip("en", "", "es", 1, is_final=False, word_count=4) == (
            "en",
            "es",
            1,
            False,
        )

    def test_flip_back_to_profile_language(self):
        assert next_source_flip("es", "en", "en", 1, is_final=False, word_count=2) == (
            "en",
            "",
            0,
            True,
        )


class TestLaneIsSameLanguage:
    def test_match(self):
        assert lane_is_same_language("es", "es-ES") is True

    def test_mismatch(self):
        assert lane_is_same_language("es", "en") is False
