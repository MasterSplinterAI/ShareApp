"""xAI streaming query params omit language unless multilingual mode is off."""

from xai_multilingual_stt import xai_stt_multilingual_enabled, xai_websocket_params


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
    assert "language" not in params
    assert params["sample_rate"] == "16000"
    assert params["interim_results"] == "true"
    assert params["endpointing"] == "800"


def test_fixed_language_is_sent_when_multilingual_disabled():
    params = xai_websocket_params(
        sample_rate=16000,
        interim_results=True,
        diarize=False,
        endpointing=800,
        language="es",
        multilingual=False,
    )
    assert params["language"] == "es"
