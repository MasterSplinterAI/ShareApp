# Translation Agent — Efficiency & Quality Optimization Plan

> Standalone work plan for the real-time translation agent. Separate from `LAUNCH_READINESS_FIXES.md` (that one is launch blockers; this one is agent cost/quality tuning). Can be worked independently.
>
> Generated from two deep-dive reviews (efficiency/cost + STT/translation quality). Every item was verified by reading the code. **Tags:** `[COST]`, `[QUALITY]`, `[BOTH]`, `[BUG]`.
>
> **Files in scope (`translation-agent/`):**
> - `transcription_only_agent.py` — **the deployed agent** (~2230 lines). The other `realtime_agent_simple*.py` / `*.backup` files are DEAD — do not edit them.
> - `translation_helpers.py` — pure, unit-tested helpers: `TranslationCache` (LRU), `stable_common_prefix` (LA-2 local agreement), `ends_sentence`/`split_tail` (sentence-freeze), `build_translation_messages` (prompt assembly).
> - `deepgram_caption_buffer.py`, `transcript_assembler.py`, `residual_guard.py`, `caption_targeting.py`.
> - Tests: `test_translation_helpers.py`, `test_target_lane_state.py`, `test_deepgram_caption_buffer.py`, `test_residual_guard.py`, `test_caption_targeting.py`, `test_transcript_assembler.py`. Run with `pytest` from `translation-agent/`.
>
> **Architecture (don't re-derive):** one shared STT (Deepgram nova-3 prod / Gladia solaria-1 A/B / OpenAI gpt-4o-transcribe) + Silero VAD pipeline per speaking participant; per-target-language lanes each running an OpenAI LLM (`gpt-4.1-mini` default) streaming translation; captions broadcast on LiveKit data topic `transcription`. Interim local-agreement (LA-2) gives flicker-free live translation while speaking; rolling 3-pair (source→target) few-shot keeps register/terminology consistent; full-tail re-translation per `is_final` fixes cross-segment grammar; sentence-freeze bounds re-translation cost.
>
> **Working conventions:** add env knobs with safe production defaults; keep changes behind the existing `try/except TypeError` plugin-compat pattern where it exists; add/extend a unit test for every helper change; do NOT change the meeting-core orchestration locks/finalize flow except where a task explicitly says so. Measure cost-sensitive changes against the existing `ttft_ms`/`total_ms` logs before/after.
>
> **Confidence note:** Items 1 and 2 were flagged independently by both reviews (highest confidence). Costs/percentages are estimates — validate against your real language mix and provider invoices.

---

## TIER 1 — Highest leverage (do first)

### TASK 1 — Set translation temperature default to 0.0  `[BOTH]` (flagged by both reviews)
**Problem:** `transcription_only_agent.py:127` (`_llm_temperature`) defaults `LLM_TEMPERATURE` to `0.2`, applied at `:1041`/`:1049`. Translation is near-deterministic. At 0.2 the *same source tail* yields *different* candidates between the interim LA-2 loop (`run_interim_translation` ~`:1474`) and the FINAL re-translation (`translate_tail` ~`:1407`). Since LA-2 (`stable_common_prefix`, `translation_helpers.py:73`) commits only the word-prefix two candidates **agree on**, non-determinism shrinks the live text shown, causes visible interim→final "catch-up," and lowers cache hit-rate.
**Fix:** Default `LLM_TEMPERATURE` to `"0.0"` (keep env-overridable):
```python
raw = os.getenv("LLM_TEMPERATURE", "0.0").strip()
```
**Acceptance:** With temp 0, repeated translation of an identical source tail is byte-identical across interim and final; LA-2 stable prefix grows at least as fast as before in a manual test; no regression in `test_translation_helpers.py`.

### TASK 2 — Stop re-sending few-shot context on interim (throwaway) calls  `[COST]` (both reviews)
**Problem:** Interim translations are discarded (only the LA-2 stable prefix survives; the final re-translates from scratch and explicitly ignores interim — `transcription_only_agent.py:1420-1422,1448-1450`). Yet each interim call re-sends the 3 rolling `(src,tgt)` context pairs (100–300 tokens each) × ~8–10 interim calls/utterance. The completed-sentence examples also nudge the model to *complete* partial clauses (hurts SOV targets).
**Fix:** In `run_interim_translation` (~`:1474`) pass `context_pairs=[]` into `build_translation_messages` (i.e. give the interim path no few-shot). Keep context pairs on the FINAL path only.
**Acceptance:** Interim LLM requests contain only system + live source (no user/assistant example turns) — verify via a logged request or a unit test on the message builder; final path still includes context pairs.

### TASK 3 — Right-size the interim model + raise the interim throttle  `[COST]`
**Problem:** Interim calls are ~60–75% of LLM spend and ~90% wasted. Both lanes use one LLM instance (`lane.llm_instance`, built once ~`:1160`); interval `INTERIM_TRANSLATION_MIN_INTERVAL_MS` defaults 600ms (`:152`).
**Fix:**
1. Add a second, cheaper LLM instance per foreign lane for the interim path (e.g. `gpt-4o-mini` or `gpt-4.1-nano`) via a new `INTERIM_LLM_MODEL` env (default to the cheap model). Keep `gpt-4.1-mini` for the authoritative final. Reuse `_create_llm_for_target` (`:1039-1049`).
2. Raise the `INTERIM_TRANSLATION_MIN_INTERVAL_MS` default 600 → 900ms.
**Acceptance:** Interim and final use different models per the env; interim call count per utterance drops ~33% from the interval change; manual UX check shows live captions still advance smoothly. Estimated combined translation-cost reduction ~2–4×.

### TASK 4 — Cap output tokens on every LLM call  `[COST]` `[SAFETY]`
**Problem:** No output-token cap is passed to the LiveKit OpenAI LLM stream. LLM is built with model/temp/timeout/retries (`:1039-1049`); calls at `:1350,1441,1489,1602`). `asyncio.wait_for` (`:1440,1488`) bounds wall-clock, not tokens billed — a misfire or injection-y source streams until the 6s cutoff, all billed.
**Fix:** LiveKit's current OpenAI plugin uses `max_completion_tokens` (not deprecated `max_tokens`). Because the cap depends on `source_text`, pass it per `chat(...)` call via `extra_kwargs`, with a TypeError fallback for older plugins:
```python
max_completion_tokens = min(
    768,
    max(64, 16 + 4 * len(source_text.split()), 8 + len(source_text) // 2),
)
stream = lane.llm_instance.chat(
    chat_ctx=chat_ctx,
    extra_kwargs={"max_completion_tokens": max_completion_tokens},
)
```
**Acceptance:** A pathological long/repetitive source no longer streams to the timeout; normal translations are unaffected; short utterances and verbose target languages have enough headroom to avoid silent truncation.

---

## TIER 2 — Quality bugs

### TASK 5 — Restore the dead keyterm glossary (silent STT regression)  `[BUG]` `[QUALITY]`
**Problem:** `_default_keyterms` (~70 finance/commodities terms: LME, Contango, Backwardation, Assay, Dore) is built at `:907-918`, then **shadowed**: `_try_deepgram` reassigns `keyterms = _deepgram_keyterms()` at `:942`, and `_deepgram_keyterms()` (`:190-192`) reads ONLY the env var with no default. So unless `DEEPGRAM_KEYTERMS` is set in the deployed env, the domain glossary never reaches nova-3 — degrading STT on exactly the terms the agent was tuned for.
**Fix:** Make `_deepgram_keyterms()` fall back to the default glossary when the env var is unset. LiveKit's current Deepgram plugin prefers nova-3 `keyterm` (singular); keep a fallback to deprecated `keyterms` only for older plugin compatibility. Also confirm the deployed env's `DEEPGRAM_KEYTERMS` value and keep the list focused (very long lists dilute nova-3 boosting).
**Acceptance:** With no `DEEPGRAM_KEYTERMS` env set, the Deepgram STT instance receives the default glossary via `keyterm` (assert in a unit test or startup log); domain terms transcribe correctly in a manual test.

### TASK 6 — Cache must not ignore translation context  `[BUG]` `[QUALITY]`
**Problem:** `TranslationCache._key` (`translation_helpers.py:44-48`) keys only on `(source_lang, target_lang, normalized_text)`. But the prompt injects rolling `context_pairs` specifically for register (tu/vous, です/だ, du/Sie), pronoun, and terminology consistency (`build_translation_messages:118-119`). A cache hit (`translate_tail:1424`, `run_interim_translation:1484`, finalize `:1596`) can return a translation produced under a different context/register than the current conversation — silently defeating the consistency feature.
**Fix (choose one):**
- (a) Add a `context_sig` to the cache key — a short hash of `lane_context_pairs(lane)` (the last target of each pair suffices):
```python
@staticmethod
def _key(source_lang, target_lang, text, context_sig=""):
    norm = _WS_RE.sub(" ", text).strip().lower()
    if not norm: return None
    return (source_lang, target_lang, context_sig, norm)
```
- (b) Cheaper: skip the cache entirely when `context_pairs` is non-empty.
**Acceptance:** Two identical source utterances under different preceding context can produce different cached entries (option a) or bypass cache (option b); `test_translation_helpers.py` updated to cover the new key signature.

### TASK 7 — Per-target sentence-freeze policy (SOV / verb-final grammar)  `[QUALITY]`
**Problem:** The docstring claims full-tail re-translation "fixes verb-final/SOV grammar," but once a sentence is frozen (`maybe_freeze_lane:1392`, gated on `ends_sentence`), the next clause is translated from the tail alone (`split_tail`, `:2055`), with the frozen sentence presented only as a *completed* few-shot example (`lane_context_pairs:1301-1306`) — not as a syntactic antecedent. For Japanese/Korean/Turkish (particle/verb-final) and German subordinate clauses this yields wrong particles, dropped subjects, or non-agreeing subordinate clauses.
**Fix (recommended):** Add a per-target freeze policy — disable sentence-freeze for verb-final/agglutinative targets (`ja, ko, tr, de, hi`; env-configurable list `NO_FREEZE_LANGS`), always re-translating the full utterance for them (O(n²) cost only bites long monologues). Keep freeze for `en/es/fr/it/pt`.
**Alternative:** When frozen, frame the frozen pair as a continuation antecedent in the prompt ("Previous sentence already translated as: '{frozen_tgt}'. Continue naturally; translate ONLY the new text:") instead of a generic few-shot pair.
**Acceptance:** A Japanese long-monologue test shows grammatically connected clauses across what would have been a freeze boundary; Latin-target behavior unchanged; cost on long EN monologues unchanged.

### TASK 8 — Strengthen the translation system prompt  `[QUALITY]`
**Problem:** `build_translation_messages:121-135` is solid on "output only the translation" but silent on register, domain, gender, and partial-clause grammar — the factors that most affect perceived quality in a multilingual meeting.
**Fix:** Add env-driven knobs `TRANSLATION_DOMAIN` (default "general business/technical meeting") and per-target `TRANSLATION_REGISTER` (default neutral-professional), and rewrite the system/partial prompts, e.g.:
```
System:
You are a professional simultaneous interpreter producing live meeting
captions in {target_lang_name}. Domain: {domain}.
Output ONLY the translation. No explanations, quotes, or preamble.
Preserve tone and register; use {register} forms consistently
(default: neutral-professional — vous/Sie/です-ます/존댓말).
Keep names, numbers, acronyms, and the listed terms exact.
When the speaker's gender or a referent is unknown, prefer gender-neutral
phrasing; once committed, stay consistent with the prior context.

Partial addendum:
This is an unfinished utterance still being spoken. Translate only the
words given. Do not invent sentence-final verbs, particles, or
inflections the speaker has not yet said; if the grammatical ending is
not yet determinable, render the partial clause as-is.
```
**Acceptance:** Generated messages include domain + register instructions; manual spot-check on fr/ja/de shows consistent formality and correct handling of the finance keyterms; `test_translation_helpers.py` covers the new prompt fields.

---

## TIER 3 — Medium

### TASK 9 — Destination-target partial caption packets  `[COST]` `[NETWORK]`
**Problem:** `publish_lane` (`:1177-1193`) JSON-encodes once then `publish_data(topic="transcription")` with **no `destination_identities`** — every partial is broadcast to ALL participants, despite the line-7 docstring claiming "destination-filtered when possible." `_listener_identities_for_target_lang` (`:461-470`) computes exactly who wants each language but is never called on the publish path. `publish_live_partial` (`:1823-1846`) calls `publish_lane` once per lane (`:1827`).
**Fix:** For foreign-language **partials**, pass `destination_identities=_listener_identities_for_target_lang(tgt)` (optionally + the speaker). Keep the FINAL reliable packet as a room-wide broadcast (the transcript-log rationale at `:1183` only needs the final). Partials are already `reliable=False` — keep that.
**Acceptance:** In a 3-language room, a partial for language X is delivered only to X-listeners (verify via client logs); final packets still reach everyone; estimated 50–80% fewer partial packets on multi-language rooms.

### TASK 10 — Canonical language-code normalization  `[QUALITY]`
**Problem:** `_normalize_language_code` (`:456`) does `lang.split("-")[0].lower()`, collapsing `zh-Hans`/`zh-Hant` to `zh` (a Traditional-Chinese listener can get Simplified) and dropping region (`pt-BR`, `en-GB`, `es-419`). Targets flow in un-normalized (`caption_targeting.py:8`), and `LANG_NAMES.get(tgt, tgt)` (`:1171`) leaks the literal code into the prompt ("translate to pt-BR") on a miss.
**Fix:** Normalize to a canonical caption code at ingestion (~`:660`) that preserves meaningful script/region (`zh-Hans`/`zh-Hant`, `pt-BR`/`pt-PT`). Resolve the display name with a fallback chain: `LANG_NAMES.get(full) or LANG_NAMES.get(base) or full`. Add common region/script variants to `LANG_NAMES`.
**Acceptance:** A `zh-Hant` listener receives Traditional; `pt-BR` resolves to a real language name in the prompt; same-language passthrough still works.

### TASK 11 — Debounce final-tail re-translation  `[COST]`
**Problem:** Each Deepgram `is_final` segment re-translates the whole growing unfrozen tail (`:2055-2064`) → O(n²) within a long sentence. The in-flight cancel (`:2058-2059`) stops concurrent dupes but sequential finals each spawn a full pass.
**Fix:** Add a ~400ms min-interval/debounce on the final-tail translation per lane (mirror the interim throttle); skip if `<400ms` since last tail translation and no sentence boundary crossed. `finalize_lane` (`:1566`) always does a last pass, so nothing is lost.
**Acceptance:** A long run-on sentence triggers fewer mid-sentence translation calls; final caption text is unchanged vs current behavior in a regression test.

### TASK 12 — Emit RTL direction in caption payload  `[QUALITY]`
**Problem:** Arabic/Hebrew finals carry no directionality hint (publish path `:1618`, `:1308`); preserved Latin keyterms/numbers (LME, KYC) inside Arabic captions render mis-ordered.
**Fix:** Add `"direction": "rtl"` (or a `dir` field) to the caption payload for RTL targets so the frontend can apply `dir`/Unicode bidi isolates. (Pairs with the frontend RTL task in `LAUNCH_READINESS_FIXES.md`.)
**Acceptance:** Caption packets for `ar`/`he`/`fa`/`ur` include the RTL flag; frontend renders mixed bidi text correctly.

### TASK 13 — Collapse the two cost POSTs per LLM call  `[BACKEND LOAD]` `[AGENT+BACKEND]`
**Problem:** `emit_llm` (`:115-134`) fires separate POSTs for input (`:132`) and output (`:134`) tokens → 16–28 backend cost POSTs per utterance per lane (`emit_llm_cost` at `:1384`, via `_spawn_bg`).
**Fix:** This is not agent-only: `/api/cost-events` currently accepts one `event_type` + `units` per request. Add a backend batch/compound cost-event endpoint or schema extension, then combine input+output in the agent; alternatively aggregate per-turn and flush once in `finalize_turn` (which already emits STT cost once per turn at `:1664`).
**Acceptance:** ~2× fewer cost POSTs per utterance; backend cost accounting totals unchanged.

### TASK 14 — Union STT and translation keyterms  `[QUALITY]`
**Problem:** `_deepgram_keyterms()` (STT boosting, `DEEPGRAM_KEYTERMS`, `:190`) and `_translation_keyterms()` (must-preserve, `TRANSLATION_KEYTERMS`, `:185`) are disjoint env vars. A brand/product term boosted in STT isn't preserved in translation, and vice-versa.
**Fix:** Default the translation must-preserve list to the union with the STT keyterms unless `TRANSLATION_KEYTERMS` is explicitly set.
**Acceptance:** With only `DEEPGRAM_KEYTERMS` set, those terms also appear in the translation must-preserve list.

### TASK 15 — A/B the LLM model on hard targets  `[QUALITY]` (measure, don't switch blind)
**Problem:** `_llm_model` (`:123`) defaults `gpt-4.1-mini`. For ja/ko/ar register + finance domain, `gpt-4o-mini`/`gpt-4o` may be measurably more faithful; prompts are short so TTFT dominates (already logged `:1366-1369`).
**Fix:** Run an A/B on ja/ar/tr using the logged `ttft_ms`/`total_ms`. If `4o-mini` TTFT is within ~150ms of `4.1-mini`, prefer it for accuracy; consider reserving `4o` for a "high-accuracy" room tier. Switch via `LLM_MODEL` only after measuring on your real language mix.
**Acceptance:** A documented A/B result (latency + a small human faithfulness rating) backing whatever default you choose.

---

## TIER 4 — Low / polish

- **TASK 16 `[QUALITY]`** — `stable_common_prefix` (`translation_helpers.py:75`) splits on whitespace; CJK has no spaces, so LA-2 is all-or-nothing → live CJK captions "pop" in whole chunks. Add character-level common-prefix for no-space scripts, guarding against splitting inside a grapheme cluster/emoji. *Acceptance:* Japanese live captions reveal progressively in a manual test; no broken multi-byte chars.
- **TASK 17 `[QUALITY]`** — `_SENTENCE_END_RE` (`translation_helpers.py:26-28`) treats any `.` as sentence-final → "approx.", "Inc.", "U.S." cause premature freeze (which then triggers TASK 7). Add a light abbreviation guard (don't freeze if the char before `.` is a single capital or a known abbreviation). *Acceptance:* "approx. 5 tonnes" does not freeze mid-sentence.
- **TASK 18 `[QUALITY]`** — `hasTranslation = source.lower() != translated.lower()` (`:1617`) false-negatives on legitimately identical output ("OK", "Tokyo", numbers, a single preserved keyterm), which may render as a translation gap. Track translation *success* separately from textual difference. *Acceptance:* A correctly-translated utterance that happens to be identical isn't flagged as a gap.
- **TASK 19 `[CORRECTNESS]`** — The publish task at `:1861` (`schedule_live_partial`) is fire-and-forget, untracked, escaping the `_bg_tasks` drain at `:749`. Route it through `self._spawn_bg(...)`. *Acceptance:* No untracked tasks remain on shutdown.

---

## Verified already-optimal — DO NOT "fix" these
(Both reviews confirmed these are correct; changing them would regress.)
- Silero VAD shared per process (`_load_shared_vad:498-511`, `_VAD_MODEL_CACHE:267`).
- `aiohttp` session reused for agent lifetime (`_get_session:56-63`).
- Module-level compiled regex (`translation_helpers.py:26-30`) — no per-call recompile.
- Bounded growth: `final_segments` cleared per turn, `context_pairs` is `deque(maxlen)`, `_translation_cache` is LRU, `_bg_tasks` self-discards.
- Same-language listeners correctly skip the LLM (`:1153,1519`) — no wasted translation.
- Multi-speaker chronology: `start_new_turn` intentionally does not commit other speakers' open bubbles (`:1694-1697`, documented live-observed reason); residual guard + 12-char floor are sound.
- Stripe-style finalize locking / `turn_id` recheck / `FIRST_COMPLETED` self-heal (per LAUNCH_SPEC hardening pass) — leave intact.

---

## Suggested order & grouping
1. **TIER 1** first — biggest cost lever (TASK 1–4); each is a small, low-risk change. One commit per task.
2. **TIER 2** — the quality bugs (TASK 5 and 6 are true bugs; 7–8 are quality wins). TASK 5 is a quick high-value fix.
3. **TIER 3 / 4** as capacity allows; TASK 9 (destination targeting) is the biggest network win and the helper already exists unused.

Run `pytest` in `translation-agent/` after any helper change. For cost/latency tasks, capture `ttft_ms`/`total_ms` and a representative utterance count before/after to confirm the win on your real language mix.
