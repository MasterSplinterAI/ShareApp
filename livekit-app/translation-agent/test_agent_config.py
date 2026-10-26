"""Configuration helper tests for the translation agent."""

import types

import transcription_only_agent as agent_module
from transcription_only_agent import (
    TranscriptionOnlyAgent,
    _deepgram_keyterms,
    _llm_temperature,
    _stt_provider,
)


def test_stt_provider_defaults_to_deepgram(monkeypatch):
    monkeypatch.delenv("STT_PROVIDER", raising=False)
    assert _stt_provider() == "deepgram"


def test_stt_provider_rejects_unknown_values(monkeypatch):
    # Production once ran STT_PROVIDER='xai' — no such provider exists, and the
    # unknown value silently fell back. Validation must land on deepgram.
    monkeypatch.setenv("STT_PROVIDER", "xai")
    assert _stt_provider() == "deepgram"


def test_stt_provider_accepts_known_values(monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "Gladia")
    assert _stt_provider() == "gladia"
    monkeypatch.setenv("STT_PROVIDER", "openai")
    assert _stt_provider() == "openai"


def test_llm_temperature_defaults_to_zero(monkeypatch):
    monkeypatch.delenv("LLM_TEMPERATURE", raising=False)
    assert _llm_temperature() == 0.0


def test_invalid_llm_temperature_falls_back_to_zero(monkeypatch):
    monkeypatch.setenv("LLM_TEMPERATURE", "not-a-number")
    assert _llm_temperature() == 0.0


def test_deepgram_keyterms_use_domain_defaults_when_env_unset(monkeypatch):
    monkeypatch.delenv("DEEPGRAM_KEYTERMS", raising=False)
    terms = _deepgram_keyterms()
    assert "LME" in terms
    assert "Contango" in terms
    assert "KYC" in terms
    # Deepgram returns HTTP 400 ("Keyterm limit exceeded: 500 tokens") when too
    # many multi-syllable keyterms are passed on nova-3 language=multi.
    assert len(terms) <= 45


def test_deepgram_keyterms_caps_env_list_to_avoid_http_400(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_KEYTERMS", ",".join(f"Term{i}" for i in range(100)))
    assert len(_deepgram_keyterms()) <= 45


def test_deepgram_keyterms_env_overrides_defaults(monkeypatch):
    monkeypatch.setenv("DEEPGRAM_KEYTERMS", "Lalia,LiveKit")
    assert _deepgram_keyterms() == ["Lalia", "LiveKit"]


def test_deepgram_stt_prefers_current_keyterm_argument(monkeypatch):
    calls = []

    class FakeSTT:
        def __init__(self, **kwargs):
            calls.append(kwargs)

    monkeypatch.setenv("LIVEKIT_CLOUD", "true")
    monkeypatch.setattr(agent_module, "PLUGINS_AVAILABLE", True)
    monkeypatch.setattr(agent_module, "deepgram", types.SimpleNamespace(STT=FakeSTT))

    stt, provider = TranscriptionOnlyAgent()._create_stt_instance("speaker-1", "en")

    assert stt is not None
    assert provider == "deepgram"
    assert "keyterm" in calls[0]
    assert "keyterms" not in calls[0]


def test_deepgram_stt_falls_back_to_legacy_keyterms_argument(monkeypatch):
    calls = []

    class FakeSTT:
        def __init__(self, **kwargs):
            calls.append(kwargs)
            if "keyterm" in kwargs:
                raise TypeError("unexpected keyword argument 'keyterm'")

    monkeypatch.setenv("LIVEKIT_CLOUD", "true")
    monkeypatch.setattr(agent_module, "PLUGINS_AVAILABLE", True)
    monkeypatch.setattr(agent_module, "deepgram", types.SimpleNamespace(STT=FakeSTT))

    stt, provider = TranscriptionOnlyAgent()._create_stt_instance("speaker-1", "en")

    assert stt is not None
    assert provider == "deepgram"
    assert "keyterm" in calls[0]
    assert "keyterms" in calls[1]
