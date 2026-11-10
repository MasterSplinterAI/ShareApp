"""xAI streaming query params omit language unless multilingual mode is off."""

from xai_multilingual_stt import (
    xai_stt_multilingual_enabled,
    xai_stt_supports,
    xai_websocket_params,
)


def test_xai_stt_language_coverage():
    assert xai_stt_supports("en-US")
    assert xai_stt_supports("zh-CN")
    assert xai_stt_supports("es")
    assert xai_stt_supports("")
    assert xai_stt_supports("multi")
    assert not xai_stt_supports("sw")
    assert not xai_stt_supports("am-ET")


def test_multilingual_is_on_by_default(monkeypatch):
    monkeypatch.delenv("XAI_STT_MULTILINGUAL", raising=False)
    assert xai_stt_multilingual_enabled() is True
    monkeypatch.setenv("XAI_STT_MULTILINGUAL", "false")
    assert xai_stt_multilingual_enabled() is False


def test_auto_detect_omits_language_query_param():
    params = xai_websocket_params(
        sample_rate=16000,
        interim_results=True,
        diarize=False,
        endpointing=800,
        language="en",
        multilingual=True,
    )
    assert all(key != "language" for key, _value in params)
    assert ("sample_rate", "16000") in params
    assert ("interim_results", "true") in params
    assert ("endpointing", "800") in params


def test_fixed_language_is_sent_when_multilingual_disabled():
    params = xai_websocket_params(
        sample_rate=16000,
        interim_results=True,
        diarize=False,
        endpointing=800,
        language="es",
        multilingual=False,
    )
    assert ("language", "es") in params
