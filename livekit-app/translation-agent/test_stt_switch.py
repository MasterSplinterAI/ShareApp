"""STT provider ladder and xAI cost mapping."""

from cost_reporter import _STT_EVENT_TYPES
from transcription_codeswitch_agent import (
    VALID_STT_PROVIDERS,
    _stt_provider,
    first_available_stt,
    stt_provider_attempt_order,
)


def test_xai_is_a_valid_stt_provider(monkeypatch):
    assert "xai" in VALID_STT_PROVIDERS
    monkeypatch.setenv("STT_PROVIDER", "xai")
    assert _stt_provider() == "xai"
    monkeypatch.setenv("STT_PROVIDER", "auto")
    assert _stt_provider() == "xai"
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    assert _stt_provider() == "xai"
    monkeypatch.setenv("STT_PROVIDER", "deepgram")
    assert _stt_provider() == "deepgram"


def test_xai_ladder_falls_through_when_handshake_fails():
    assert stt_provider_attempt_order("xai") == ("xai", "deepgram", "openai")

    def boom():
        raise RuntimeError("websocket handshake failed")

    inst, name = first_available_stt(
        "xai",
        {
            "xai": boom,
            "deepgram": lambda: "deepgram-stt",
            "openai": lambda: "openai-stt",
        },
    )
    assert inst == "deepgram-stt"
    assert name == "deepgram"


def test_skipped_provider_is_not_retried():
    inst, name = first_available_stt(
        "xai",
        {
            "xai": lambda: "xai-stt",
            "deepgram": lambda: "deepgram-stt",
            "openai": lambda: "openai-stt",
        },
        excluded={"xai"},
    )
    assert name == "deepgram"
    assert inst == "deepgram-stt"


def test_xai_stt_cost_event_type():
    assert _STT_EVENT_TYPES["xai"] == "xai_stt_minute"
