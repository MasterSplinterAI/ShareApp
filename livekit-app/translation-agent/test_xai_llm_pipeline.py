"""Tests for unified xAI LLM translation config, domain keyterms, and cost telemetry mapping."""

import cost_reporter
from transcription_codeswitch_agent import (
    MAX_XAI_KEYTERMS,
    _translation_domain_terms,
    _translation_keyterms,
    _xai_llm_model,
    _xai_stt_keyterms,
)
from translation_helpers import build_translation_messages


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


def test_xai_stt_keyterms_include_mining_refining_software_and_participant():
    terms = _xai_stt_keyterms(["Kenneth Rhule"])
    for expected in ("cassiterite", "tin", "doré", "aqua regia", "LBMA", "WebRTC", "Kenneth Rhule"):
        assert expected in terms
    assert "Guest" not in terms
    assert len(terms) <= MAX_XAI_KEYTERMS


def test_translation_messages_include_verbatim_keyterms_and_domain_vocab():
    msgs = build_translation_messages(
        target_lang_name="Spanish",
        source_text="Our cassiterite and tin doré bars cleared LBMA settlement on WebRTC.",
        context_pairs=(),
        keyterms=_translation_keyterms(),
        domain_terms=_translation_domain_terms(),
    )
    sys_prompt = msgs[0][1]
    assert "Keep these terms exactly as written (do not translate them):" in sys_prompt
    assert "LBMA" in sys_prompt
    assert "WebRTC" in sys_prompt
    assert "Domain vocabulary context" in sys_prompt
    assert "cassiterite" in sys_prompt
    assert "doré" in sys_prompt
