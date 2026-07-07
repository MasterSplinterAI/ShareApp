"""Configuration helper tests for the translation agent."""

import types

import transcription_only_agent as agent_module
from transcription_only_agent import (
    TranscriptionOnlyAgent,
    _deepgram_keyterms,
    _llm_temperature,
)


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
