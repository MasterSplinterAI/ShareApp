# Streaming Translation Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cut translated-caption latency from the current 1.5–5s band to under ~1s perceived, raise translation quality for word-order-divergent languages, and harden the LLM lane to enterprise grade (timeouts, retries, cache, metrics, per-lane isolation), with gpt-4.1-mini pinned as the translation model.

**Architecture:** `livekit-app/translation-agent/transcription_only_agent.py` keeps one shared Deepgram nova-3 STT+VAD pipeline per speaker fanning out to per-target LLM lanes. This plan changes the lane translation model from "translate each Deepgram `is_final` segment in isolation and stitch with spaces" to "translate the *unfrozen tail* of the accumulated utterance, freeze at sentence boundaries, and additionally translate stable interim prefixes (simultaneous-MT local agreement) so foreign-language readers see text while the speaker is still talking." All pure logic lives in a new `translation_helpers.py` with pytest coverage; the agent file only orchestrates.

**Tech Stack:** Python 3.13, LiveKit Agents SDK, livekit-plugins-deepgram 1.3.9 (nova-3, `keyterms` supported), livekit-plugins-openai 1.3.2 (`model`/`temperature`/`timeout`/`max_retries` supported), pytest.

---

## Context (read before starting)

Current behavior (verified in code):

- Translation fires only on Deepgram `is_final` segments (`process_stt`, `FINAL_TRANSCRIPT` branch). Cross-language lanes display nothing until then (`lane_live_text` returns only translated parts).
- Each segment is translated with a fresh `ChatContext`, no prior context, via `openai.LLM()` (unpinned plugin default).
- Translated segments are joined with `" ".join(...)` → broken grammar for SOV/verb-final targets (ja, ko, de).
- `_finalize_turn_locked` gathers pending translate tasks of **all** lanes before publishing **any** lane's final.
- An LLM exception silently substitutes the untranslated original. No timeout, no retry, no cache, no latency metrics.

Perception thresholds from 2026 vendor benchmarks: <800ms first-chunk feels live; >2s collapses.

## Design decisions

1. **Single-slot lane translation.** Each foreign lane maintains `frozen_src`/`frozen_tgt` (sentence-complete prefix already translated) plus a live tail translation. Display = `frozen_tgt + tail`. Invariant kept for compatibility: `lane.turn_translated_parts == [display]`, so `lane_live_text`, finalize, and the Gladia path are untouched.
2. **Freeze at sentence boundaries.** After a successful final-tail translation, if the source tail ends with sentence-final punctuation, fold tail into frozen. Bounds re-translation cost on long monologues (no O(n²) blowup) while keeping whole-sentence grammar.
3. **Interim local agreement (LA-2).** On interim transcripts, translate the unfrozen source tail (one in-flight call per lane, min-interval debounce). Display only the word-level common prefix of the last two candidate translations — the standard stability heuristic from simultaneous-MT literature. Final translations supersede and reset interim state.
4. **Hardening.** gpt-4.1-mini pinned (env-overridable `LLM_MODEL`), temperature 0.2, client-level timeout + retries, app-level `asyncio.wait_for` + one retry around stream consumption, LRU translation cache, structured latency logs (`ttft_ms`, `total_ms`), per-lane finalize so one slow target cannot delay other lanes' finals.
5. **Context + terminology.** Rolling deque of the last N committed (source → target) pairs per lane injected as few-shot user/assistant message pairs; `TRANSLATION_KEYTERMS` env injects must-preserve terms; `DEEPGRAM_KEYTERMS` env feeds nova-3 keyterm prompting.

## New environment variables (all optional, safe defaults)

| Var | Default | Meaning |
| --- | --- | --- |
| `LLM_MODEL` | `gpt-4.1-mini` | Translation model |
| `LLM_TEMPERATURE` | `0.2` | Translation temperature |
| `LLM_TIMEOUT_SEC` | `6.0` | Per-attempt budget for one translation call |
| `INTERIM_TRANSLATION_ENABLED` | `true` | Live local-agreement translation of interims |
| `INTERIM_TRANSLATION_MIN_INTERVAL_MS` | `600` | Debounce between interim translation calls per lane |
| `TRANSLATION_CONTEXT_PAIRS` | `3` | Rolling (source→target) pairs carried across turns |
| `TRANSLATION_CACHE_SIZE` | `512` | LRU entries (0 disables) |
| `TRANSLATION_KEYTERMS` | empty | Comma-separated terms the LLM must preserve |
| `DEEPGRAM_KEYTERMS` | empty | Comma-separated nova-3 keyterm prompts |

### Task 1: `translation_helpers.py` + `test_translation_helpers.py`

Pure logic, TDD: `TranslationCache` (LRU, normalized keys), `stable_common_prefix` (word-level LCP), `ends_sentence` (multilingual sentence-final punctuation), `split_tail` (committed text minus frozen prefix), `join_nonempty`, `build_translation_messages` (system prompt + context pairs + keyterms + current source).

Verify: `venv/bin/python -m pytest test_translation_helpers.py -q` → all pass.

### Task 2: Model pin + STT keyterms + env helpers

`_create_llm_for_target` → `openai.LLM(model=_llm_model(), temperature=_llm_temperature(), timeout=httpx-compatible, max_retries=1)`. `_try_deepgram` gains `keyterms=` when env set (TypeError-guarded). Add env helper functions. Cost reporter uses `_llm_model()` instead of hardcoded `gpt-4o-mini`.

Verify: `venv/bin/python -m py_compile transcription_only_agent.py`.

### Task 3: Lane translation path rewrite

Replace `translate_segment` with `translate_tail(lane, tgt, ...)`: cache lookup → LLM stream with `wait_for` + 1 retry → per-delta display update + partial publish → freeze-on-sentence → metrics log → cost emit. `TargetLaneState` gains `frozen_src/frozen_tgt/tail_translation/interim_*/context_pairs/current_task`. FINAL_TRANSCRIPT branch translates the unfrozen tail of `dg_buffer.committed_text()` instead of the raw segment; cancels the lane's in-flight task. Finalize appends (original, translated) to `lane.context_pairs`.

Verify: py_compile + full pytest suite.

### Task 4: Interim local-agreement translation

INTERIM_TRANSCRIPT branch schedules `run_interim_translation` per foreign lane (skip when in-flight, debounced, skip same-language/Gladia-native/transcription_only). Local agreement via `stable_common_prefix`; publishes stable prefix as the lane's live text. Final translation start cancels interim task and resets agreement state.

Verify: py_compile + full pytest suite.

### Task 5: Per-lane finalize

`_finalize_turn_locked`: snapshot `full_original`/`tid`; per-lane async finalizer awaits **that lane's** pending tasks (capped `wait_for`), publishes that lane's final, updates context pairs; `asyncio.gather` of finalizers; then clear turn state. One slow lane no longer delays others' finals.

Verify: py_compile + full pytest suite.

### Task 6: Config logging, env examples, benchmark script

`log_resolved_inference_config` logs new envs. `env.example` + `AGENT_CLOUD_ENV.example` document them. New `benchmark_translation.py`: measures TTFT/total per model (default gpt-4o-mini vs gpt-4.1-mini vs gpt-4.1-nano) across sample segments/language pairs using `OPENAI_API_KEY`.

Verify: py_compile all touched files; full pytest suite green.

### Task 7: Full verification

`venv/bin/python -m pytest -q` (all test files) + `py_compile` on agent + helpers + benchmark. Report latency expectations and deploy notes.
