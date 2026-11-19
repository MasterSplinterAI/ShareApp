"""Tests for unified xAI LLM translation config and cost telemetry mapping."""

import cost_reporter
from transcription_codeswitch_agent import _xai_llm_model


def test_cost_reporter_maps_xai_llm_events():
    assert cost_reporter._LLM_EVENT_TYPES["xai"] == (
        "xai_llm_input_mtok",
        "xai_llm_output_mtok",
    )


def test_xai_llm_model_defaults_even_when_openai_fallback_model_set(monkeypatch):
    monkeypatch.delenv("XAI_LLM_MODEL", raising=False)
    monkeypatch.delenv("TRANSLATION_XAI_MODEL", raising=False)
    monkeypatch.setenv("LLM_MODEL", "gpt-4.1-mini")
    assert _xai_llm_model() == "grok-4.20-0309-non-reasoning"


def test_xai_llm_model_honors_override(monkeypatch):
    monkeypatch.setenv("XAI_LLM_MODEL", "grok-4.20-0309-non-reasoning")
    assert _xai_llm_model() == "grok-4.20-0309-non-reasoning"
