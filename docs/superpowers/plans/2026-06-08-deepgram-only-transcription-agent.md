# Deepgram-Only Transcription Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the intermittent first-word drop and simplify the production transcription agent down to a single Deepgram-primary caption path, removing the xAI STT/LLM provider and the legacy non-Deepgram caption-assembly branch.

**Architecture:** `transcription_only_agent.py` runs one shared STT+VAD pipeline per speaking participant and fans final segments out to per-target LLM translation lanes. Today it carries three STT providers (xAI / Deepgram / OpenAI) and two parallel caption-assembly models (the canonical `DeepgramCaptionBuffer` vs. a legacy `turn_original_parts` + stitch path), selected at runtime via `use_deepgram_captions`. We collapse everything onto the `DeepgramCaptionBuffer` path, keep Deepgram nova-3 as the sole streaming STT, retain OpenAI `gpt-4o-transcribe` only as a thin emergency fallback routed through the same buffer, and delete xAI entirely.

**Tech Stack:** Python 3, LiveKit Agents SDK, `livekit-plugins-deepgram` (nova-3), `livekit-plugins-openai`, `livekit-plugins-silero` (VAD), pytest. Deployed via `livekit-app/translation-agent/Dockerfile` (`CMD python -u transcription_only_agent.py start`) to LiveKit Cloud agent `translation-cloud-prod`.

---

## Context & Root Cause (read before starting)

**Deployed file:** `livekit-app/translation-agent/transcription_only_agent.py` (per `Dockerfile:31`).

**The first-word bug.** Audio is pushed to STT continuously (`feed_audio`, ~line 1325-1330), so Deepgram receives every frame — VAD does **not** gate STT. The drop happens in the post-finalize residual guard:

```1015:1025:livekit-app/translation-agent/transcription_only_agent.py
        def is_residual_after_finalize(candidate: str) -> bool:
            prev = last_finalized_norm[0]
            if not prev:
                return False
            if time.time() - last_finalized_at[0] > _residual_guard_sec():
                return False
            norm = " ".join(candidate.strip().lower().split())
            if not norm:
                return True
            prev_n = " ".join(prev.split())
            return norm == prev_n or prev_n.startswith(norm) or prev_n.endswith(norm)
```

For 1.5-5s after a turn finalizes (`_residual_guard_sec` floor is 1.5s), the first interim of the **next** utterance is a short word. If that word is a prefix or suffix of the previous utterance (`prev_n.startswith(norm)` / `prev_n.endswith(norm)`), it is misclassified as a trailing duplicate and dropped at the interim/final handlers (`if turn_id[0] is None and is_residual_after_finalize(text): continue`, ~lines 1447 and 1460). Common openers (*okay, so, and, well, now, yeah, I*) collide constantly → "sometimes" drops the first word. Env tuning cannot fix it (hard 1.5s floor); it is a logic bug.

**The simplification.** The legacy non-Deepgram path exists only to support providers that don't emit Deepgram-style `is_final`/`speech_final` (xAI, OpenAI). Removing xAI and routing OpenAI's finals through `DeepgramCaptionBuffer` lets us delete `use_deepgram_captions`, `turn_original_parts`, the in-handler stitch branches, `maybe_arm_finalization`, and the legacy finalize-delay timer — eliminating a class of finalize/turn-reset races.

**Safety net:** `test_deepgram_caption_buffer.py` + `test_transcript_assembler.py` (13 tests) currently pass. Run from `livekit-app/translation-agent/`.

**xAI symbols to remove (inventory):** `XAI_SUPPORTED_LANGS`, `_stt_force_deepgram_langs`, `XAI_STT_WS_URL`, `XAI_STT_REST_URL`, `_xai_stt_probe_ok`, `_xai_api_key`, `_xai_stt_endpointing_ms`, `_xai_stt_ws_params`, `probe_xai_stt_connection`, the `xai_plugin` import + `XAI_AVAILABLE`, `_try_xai` (in `_create_stt_instance`), `_try_xai_llm` (in `_create_llm_for_target`), the `skip_stt`/probe block (~943-949), the xAI mismatch warning (~962-966), the runtime xAI handshake-retry branch (~1558), xAI cost model-name branches (~1092-1096), and xAI entries in `provider_order` / `llm_order` and startup logging (~1606-1664).

**Decision to confirm with the user before Phase 2:** keep OpenAI `gpt-4o-transcribe` as an emergency STT fallback (recommended — it routes cleanly through the buffer once finalize is VAD/idle-driven), or go strictly Deepgram-only with no fallback. This plan assumes **keep OpenAI fallback through the unified buffer**.

---

## Phase 1 — Fix the first-word drop (independent, ship first)

This phase stands alone and fixes the user-reported bug with minimal risk. Deploy it before the larger refactor.

### Task 1: Characterize and fix the residual guard

**Files:**
- Create: `livekit-app/translation-agent/test_residual_guard.py`
- Modify: `livekit-app/translation-agent/transcription_only_agent.py` (extract `is_residual_after_finalize` logic to a pure, importable helper, then fix it)

The guard is currently a closure inside `_run_speaker_pipeline`, so it can't be unit-tested. Extract the pure decision to a module-level function and have the closure call it.

- [ ] **Step 1: Extract a pure helper (no behavior change yet).**

Add at module level (near `_deepgram_stt_idle_ms`):

```python
def _is_residual_repeat(candidate: str, prev_finalized: str) -> bool:
    """True when `candidate` is a trailing duplicate of the just-finalized
    utterance (Deepgram re-emits committed text after speech_final), NOT a new
    utterance whose opening words happen to overlap the previous text.

    Only treat as residual when the candidate covers essentially the whole prior
    utterance (exact match, or a high-overlap prefix/suffix). A short opener like
    "okay" / "now" must pass through so its turn can start.
    """
    norm = " ".join(candidate.strip().lower().split())
    prev_n = " ".join(prev_finalized.split())
    if not prev_n:
        return False
    if not norm:
        return True
    if norm == prev_n:
        return True
    # High-overlap continuation of the prior utterance => residual.
    overlap = (
        prev_n.startswith(norm)
        or prev_n.endswith(norm)
        or norm.startswith(prev_n)
        or norm.endswith(prev_n)
    )
    return overlap and len(norm) >= max(12, int(0.6 * len(prev_n)))
```

Then change the closure to delegate (keeps the time-window check in the closure where `last_finalized_*` live):

```python
        def is_residual_after_finalize(candidate: str) -> bool:
            prev = last_finalized_norm[0]
            if not prev:
                return False
            if time.time() - last_finalized_at[0] > _residual_guard_sec():
                return False
            return _is_residual_repeat(candidate, prev)
```

- [ ] **Step 2: Write failing tests** in `test_residual_guard.py`:

```python
from transcription_only_agent import _is_residual_repeat


class TestResidualRepeat:
    def test_exact_repeat_is_residual(self):
        assert _is_residual_repeat("okay well will it autoscroll now",
                                   "okay well will it autoscroll now") is True

    def test_short_opener_matching_prev_suffix_is_not_residual(self):
        # New utterance starts with "now"; prev ended with "now" -> must NOT drop
        assert _is_residual_repeat("now", "okay well will it autoscroll now") is False

    def test_short_opener_matching_prev_prefix_is_not_residual(self):
        assert _is_residual_repeat("okay", "okay well will it autoscroll now") is False

    def test_trailing_tail_of_prev_is_residual(self):
        prev = "thanks everyone lets walk through the q3 rollout timeline"
        assert _is_residual_repeat("through the q3 rollout timeline", prev) is True

    def test_empty_candidate_is_residual(self):
        assert _is_residual_repeat("", "anything") is True

    def test_no_prev_is_not_residual(self):
        assert _is_residual_repeat("hello", "") is False
```

- [ ] **Step 3: Run tests, expect the two "short opener" tests to FAIL** against the OLD logic (proving the bug), then PASS after the fix.

Run: `cd livekit-app/translation-agent && python3 -m pytest test_residual_guard.py -v`
Expected after fix: all PASS.

- [ ] **Step 4: Add a debug log when an interim is dropped as residual** (so we can confirm on staging). In the interim handler (~line 1446-1448) and final handler (~1460-1464), when `is_residual_after_finalize` returns True, log at `debug`/`info`:

```python
                    if turn_id[0] is None and is_residual_after_finalize(text):
                        logger.info(f"{L} 🛑 residual interim dropped: '{text[:40]}'")
                        continue
```

- [ ] **Step 5: Run the full agent test suite.**

Run: `python3 -m pytest test_deepgram_caption_buffer.py test_transcript_assembler.py test_residual_guard.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit.**

```bash
git add livekit-app/translation-agent/transcription_only_agent.py livekit-app/translation-agent/test_residual_guard.py
git commit -m "Fix first-word drop from over-eager post-finalize residual guard."
```

- [ ] **Step 7: Deploy to staging and verify.**

Run: `./deploy-staging.sh` (note: this deploys frontend/backend; **confirm whether the LiveKit Cloud agent has a separate deploy path** — see "Agent deployment" note below). Then in a meeting with `?debug=1`, speak two short sentences back-to-back where the second starts with a word from the first (e.g. end with "…now." then start "Now we…"). Confirm the first word renders and `residual interim dropped` only fires for true repeats.

> **Agent deployment note (resolve early):** `deploy-staging.sh` deploys the web app. The transcription agent runs on **LiveKit Cloud** (`translation-cloud-prod`). Determine the agent deploy command (likely `lk agent deploy` / `lk agent update` from `livekit-app/translation-agent/`, see `livekit.toml`, `DEPLOYMENT.md`, `UPDATE_CLOUD_AGENT.md`). Phase 1 is not live until the agent image is redeployed.

---

## Phase 2 — Remove xAI provider (STT + LLM)

No behavior change for the default Deepgram path; pure deletion + simplification.

### Task 2: Strip xAI from STT/LLM selection and module top-level

**Files:**
- Modify: `livekit-app/translation-agent/transcription_only_agent.py`

- [ ] **Step 1:** Delete the `xai_plugin` import block and `XAI_AVAILABLE` (~38-44).
- [ ] **Step 2:** Delete xAI module constants/helpers: `XAI_SUPPORTED_LANGS`, `_stt_force_deepgram_langs`, `XAI_STT_WS_URL`, `XAI_STT_REST_URL`, `_xai_stt_probe_ok`, `_xai_api_key`, `_xai_stt_endpointing_ms`, `_xai_stt_ws_params`, `probe_xai_stt_connection` (~53-149). Remove the now-unused `aiohttp` import **only if** nothing else uses it (grep first).
- [ ] **Step 3:** In `_create_stt_instance`: delete `_try_xai` and `_stt_force_deepgram_langs` usage; simplify `provider_order` to `{"deepgram": [_try_deepgram, _try_openai], "openai": [_try_openai, _try_deepgram]}.get(stt_provider, [_try_deepgram, _try_openai])`.
- [ ] **Step 4:** In `_create_llm_for_target`: delete `_try_xai_llm`; simplify `llm_order` to `[_try_openai_llm]`. Replace the xAI cost model-name branch (~1092-1096) with the constant `"gpt-4o-mini"`.
- [ ] **Step 5:** In `_run_speaker_pipeline`: delete the `skip_stt`/`probe_xai_stt_connection` block (~942-949) and the xAI-mismatch warning (~962-966); call `_create_stt_instance(speaker_id, speaker_lang)` directly.
- [ ] **Step 6:** Delete the runtime xAI handshake-retry branch (~1555-1560 area) and any `STT_PROVIDER == "xai"` checks in startup logging (~1606-1664). Default `STT_PROVIDER` stays `"deepgram"`.
- [ ] **Step 7: Verify no xAI references remain.**

Run: `rg -n -i 'xai' livekit-app/translation-agent/transcription_only_agent.py`
Expected: no matches.

- [ ] **Step 8: Import + compile check.**

Run: `cd livekit-app/translation-agent && python3 -c "import transcription_only_agent" && python3 -m pytest -q`
Expected: import succeeds, all tests PASS.

- [ ] **Step 9: Commit.**

```bash
git commit -am "Remove xAI STT/LLM provider from transcription agent."
```

---

## Phase 3 — Collapse to a single caption-assembly path

### Task 3: Unify on `DeepgramCaptionBuffer`; route OpenAI finals through it

**Files:**
- Modify: `livekit-app/translation-agent/transcription_only_agent.py`
- (Keep) `deepgram_caption_buffer.py`, `transcript_assembler.py` — still used.

The buffer's `on_final_segment` / `on_interim` / `on_speech_final` are provider-agnostic. OpenAI `gpt-4o-transcribe` emits FINAL transcripts (no interim, no `speech_final`), so finalize for the OpenAI fallback must be driven by VAD `END_OF_SPEECH` + the existing STT-idle timer (already used for Deepgram), not the legacy delay timer.

- [ ] **Step 1:** Remove `use_deepgram_captions` (~994). Treat the buffer as the only model. Delete `turn_original_parts` (~996) and all reads/writes of it.
- [ ] **Step 2:** In the INTERIM handler (~1446-1457): drop the `if use_deepgram_captions[0] … else (stitch)` branch; always `display_text = dg_buffer.on_interim(text)`.
- [ ] **Step 3:** In the FINAL handler (~1459-1492+): always go through `dg_buffer.on_final_segment(...)`; delete the legacy `full_so_far`/`turn_original_parts` branch (~1494-end of that else).
- [ ] **Step 4:** In `finalize_turn` (~1120-1124): always `dg_buffer.on_speech_final(); full_original = dg_buffer.committed_text()`.
- [ ] **Step 5:** In `translate_segment` (~1055-1058): `full_original = dg_buffer.committed_text()` unconditionally.
- [ ] **Step 6:** Delete `maybe_arm_finalization` (~1260-1266) and the legacy `arm_finalization`/`schedule_finalization`/`_caption_finalize_delay_sec` machinery **iff** unused after unification. Keep `cancel_finalization` if still referenced by VAD `START_OF_SPEECH`; otherwise inline its STT-idle cancel. **Grep each symbol before deleting.**
- [ ] **Step 7:** Ensure OpenAI fallback finalizes: confirm VAD `END_OF_SPEECH` → `arm_stt_idle_finalize()` path (or equivalent) runs regardless of provider (remove the `use_deepgram_captions[0]` guard in `arm_stt_idle_finalize`, ~1209, so idle-finalize works for any provider that lacks `speech_final`).
- [ ] **Step 8:** `arm_stt_idle_finalize` / `schedule_stt_idle_finalize` / `touch_stt_activity` / `schedule_live_partial` (~1308) — remove `use_deepgram_captions[0]` guards.
- [ ] **Step 9: Verify + test.**

Run: `rg -n 'use_deepgram_captions|turn_original_parts|maybe_arm_finalization' livekit-app/translation-agent/transcription_only_agent.py`
Expected: no matches.
Run: `python3 -c "import transcription_only_agent" && python3 -m pytest -q`
Expected: PASS.

- [ ] **Step 10: Commit.**

```bash
git commit -am "Unify transcription agent on single Deepgram caption buffer path."
```

---

## Phase 4 — Trim config, docs, and dead modules

### Task 4: Clean up env knobs and stale docs

**Files:**
- Modify: `.env.example`, `AGENT_CLOUD_ENV.example`, `env.example` (remove `XAI_*`, `STT_DEEPGRAM_LANGS`, `XAI_STT_ENDPOINTING_MS`, `XAI_LLM_MODEL`; keep `STT_PROVIDER=deepgram`, `DEEPGRAM_*`, `LLM_PROVIDER=openai`).
- Review for deletion (grep repo for importers first): `realtime_agent_simple_backup.py`, `pipeline_translation_agent.py`, `realtime_agent_simple.py` if no longer referenced by any deploy path or doc. **Do not delete without confirming they are not an alternate/rollback target named in `DEPLOYMENT.md`.**
- Update: `DEPLOYMENT.md` / `UPDATE_CLOUD_AGENT.md` rollback notes to reflect Deepgram-only.

- [ ] **Step 1:** Edit env example files; `rg -n -i 'xai|STT_DEEPGRAM_LANGS' livekit-app/translation-agent/*.example` → no matches.
- [ ] **Step 2:** Grep for importers of the backup/alt agents before any deletion: `rg -n 'realtime_agent_simple|pipeline_translation_agent' livekit-app`. Decide keep/delete with the user.
- [ ] **Step 3:** Update docs.
- [ ] **Step 4: Commit.**

```bash
git commit -am "Trim xAI config and stale agent docs after Deepgram-only refactor."
```

---

## Verification (whole feature)

- [ ] `cd livekit-app/translation-agent && python3 -m pytest -q` → all PASS.
- [ ] `python3 -c "import transcription_only_agent"` → no ImportError.
- [ ] `rg -n -i 'xai|use_deepgram_captions|turn_original_parts' livekit-app/translation-agent/transcription_only_agent.py` → no matches.
- [ ] Redeploy the LiveKit Cloud agent (NOT just `deploy-staging.sh`).
- [ ] Staging meeting with `?debug=1`:
  - Back-to-back short sentences with overlapping opener words → first word retained.
  - English source → Spanish/Japanese target lanes still translate.
  - Same-language lane shows live partials; foreign lane waits for translation.
  - No duplicate finalized bubbles after a pause.
  - OpenAI fallback path (temporarily set `STT_PROVIDER=openai` in a test run) still produces finalized captions via VAD/idle finalize.

---

## Risks & Rollback

- **Risk:** OpenAI fallback never emits `speech_final`; if the VAD/idle finalize guard isn't generalized (Phase 3 Step 7-8), OpenAI turns won't finalize. Mitigation: explicit test run with `STT_PROVIDER=openai`.
- **Risk:** Deleting `cancel_finalization`/`schedule_finalization` that are still referenced. Mitigation: grep every symbol before deletion (steps call this out).
- **Risk:** Agent deploy is separate from web deploy; Phase 1 fix appears "not working" if only the web app is redeployed. Mitigation: confirm + run the agent deploy command.
- **Rollback:** Each phase is a standalone commit on `v2-foundation`. Revert the specific commit; the Cloud agent can also be redeployed from the prior image. `realtime_agent_simple.py` remains as the documented rollback agent until Phase 4 decides its fate.
