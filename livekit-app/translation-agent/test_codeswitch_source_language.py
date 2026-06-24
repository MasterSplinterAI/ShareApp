"""Tests for codeswitch_source_language helpers."""

from codeswitch_source_language import (
    effective_source_language,
    lane_is_same_language,
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


class TestLaneIsSameLanguage:
    def test_match(self):
        assert lane_is_same_language("es", "es-ES") is True

    def test_mismatch(self):
        assert lane_is_same_language("es", "en") is False
