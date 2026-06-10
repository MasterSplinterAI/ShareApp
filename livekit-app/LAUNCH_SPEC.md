# Launch Spec — International Web Conferencing with Multilingual Live Translation

Status: pre-launch hardening complete (agent review pass, June 2026)
Goal: launch a working international web conferencing app with impeccable multilingual
translation for participants. Feature branches come after launch.

---

## 1. What ships at launch

| Surface | What | Where |
|---|---|---|
| Conferencing | LiveKit rooms, up to 50 participants, host controls | frontend + backend (v2 routes) |
| Captions | Live partial + final caption bubbles, per-participant language, desktop/mobile/PiP | `TranscriptionPanel.jsx` |
| Translation (prod) | Deepgram nova-3 STT → OpenAI gpt-4o-mini lanes | agent `translation-cloud-prod` |
| Translation (A/B) | Gladia solaria-1 STT + Gladia native translation | agent `translation-cloud-gladia` |
| Pipeline switch | Host-only, staging + `?debug=1` | `TranslationDebugPanel.jsx`, `/v2/host/.../switch-stt-pipeline` |
| Cost telemetry | Per-turn STT minutes + LLM tokens → `/api/cost-events` | `cost_reporter.py` |

Default pipeline at launch: **deepgram** (decision Jun 10: Gladia's slower utterance
finalize delays translation; revisit after tuning `GLADIA_ENDPOINTING_SEC`). Gladia
remains host-switchable per room via the debug panel; `DEFAULT_STT_PIPELINE` env
flips the default without a code change.

> Gladia account is on a **paid plan** (30 concurrent live sessions) — concurrency
> verified Jun 10. Remaining Gladia work before GA: finalize/translation latency.

## 2. Agent architecture (as reviewed)

- One shared STT + Silero VAD pipeline per speaking participant.
- Per-target-language lanes: OpenAI LLM streaming translation (Deepgram path) or
  Gladia native translation (`GLADIA_TRANSLATION_ENABLED=true`, cross-lang listeners present).
- Captions broadcast on data topic `transcription`; packet shape:
  `{ originalText, text, language, sourceLanguage, partial, final, hasTranslation, transcriptionId, sttProvider }`.
- Turn lifecycle: VAD/STT start-of-speech → interim partials → finals into
  `DeepgramCaptionBuffer` → STT-idle (Deepgram) or per-utterance/translation-debounce
  (Gladia) finalize → reliable FINAL publish.

### Hardening applied in the review pass

| Fix | Why |
|---|---|
| `caption_config` over data channel ignored; applied only via room metadata (`room_metadata_changed`) | Any participant could kill room captions; metadata writes go through the authenticated backend route |
| `update_assistants` serialized behind `_reconcile_lock` | Concurrent reconciles could create duplicate STT pipelines (double cost, duplicate captions) |
| `finalize_turn` behind per-pipeline lock + `turn_id` recheck | Six entry paths could double-publish the same FINAL |
| Pipeline legs use `FIRST_COMPLETED` + self-heal restart | A dropped STT websocket used to hang the pipeline silently, captions dead until a participant event |
| Cross-speaker finalize wired into `start_new_turn` | Overlapping speakers now commit each other's open bubbles in order |
| Gladia multi-target finalize waits for all target translations (1s grace) | Second language no longer committed empty when its FINAL lands late |
| Stale per-segment translation tasks cancelled on segment replacement | Slow old LLM result can no longer overwrite newer text |
| `CostReporter` reuses one aiohttp session; closed at shutdown | Socket/TLS churn per cost event |
| Fire-and-forget tasks tracked in `_bg_tasks`, drained 3s at shutdown | Last turn's telemetry survives SIGTERM; no unbounded orphans |
| `caption_config.mode` validated against allow-list | Garbage mode silently disabled mode-dependent logic |
| `requirements.txt` now points at `requirements_livekit.txt` | Stale duplicate manifest caused confusion about what's deployed |

## 3. Pre-launch checklist

### Deploy
- [ ] Commit the hardening pass on `v2-foundation`
- [ ] `lk agent deploy --config livekit.toml` (translation-cloud-prod)
- [ ] `lk agent deploy --config livekit-gladia.toml` (translation-cloud-gladia)
- [ ] Verify `RESOLVED INFERENCE CONFIG` log on both: correct provider, key masks, build ref
- [ ] Confirm staging frontend/backend at latest commit

### Language matrix (manual, staging)
Test each cell on both pipelines: live partials render, FINAL bubble correct,
`hasTranslation` correct, no duplicates, auto-scroll on desktop + mobile.

| Speaker → Listener | en | es | fr | zh | ar (RTL) |
|---|---|---|---|---|---|
| en | same-lang | [ ] | [ ] | [ ] | [ ] |
| es | [ ] | same-lang | [ ] | — | — |
| fr | [ ] | [ ] | same-lang | — | — |

- [ ] 3-listener room with 3 different caption languages (multi-target Gladia case)
- [ ] Mid-meeting language switch (es→en) — pipeline tears down/recreates cleanly
- [ ] Code-switching speech (Gladia `code_switching=True`)
- [ ] Two people talking over each other — caption chronology holds
- [ ] Host toggles captions off/on via caption-config — applies within ~1s, no agent restart

### Resilience
- [ ] Kill agent mid-meeting (redeploy) — `agent_ready` re-sync brings captions back without rejoin
- [ ] Speaker leaves and rejoins — pipeline recreated, no zombie pipelines
- [ ] 30+ min soak call — no caption drift, no memory growth on agent, STT self-heal log absent or recovered
- [ ] Background-noise room — VAD `noisy` preset holds, no phantom bubbles

### Cost & ops
- [ ] Cost events arriving for both pipelines (`deepgram_stt_minute`, `gladia_stt_minute`, `openai_llm_*`)
- [ ] Decide gladia translation cost constant (backend `costConstants.js`) — Gladia bills translation add-on per audio minute
- [ ] Alerting: agent worker down, cost-event silence during active meetings
- [ ] Rollback rehearsed: host switch back to `deepgram` pipeline is the runtime rollback; `lk agent rollback` for bad deploys

### Backend follow-up (pre- or fast-follow)
- [ ] `POST /v2/rooms/:name/caption-config` verifies the requester is the **host of that meeting**, not just any authenticated v2 user
- [ ] Same host check on `switch-stt-pipeline` (already host-scoped — verify)

## 4. Configuration matrix

| Env | prod (Deepgram) | gladia (A/B) |
|---|---|---|
| `STT_PROVIDER` | `deepgram` | `gladia` |
| `LLM_PROVIDER` | `openai` | `openai` (fallback lanes) |
| `GLADIA_TRANSLATION_ENABLED` | — | `true` (set `false` to A/B OpenAI lanes) |
| `VAD_PRESET` | `noisy` | `noisy` |
| `DEEPGRAM_ENDPOINTING_MS` | `800` | (feeds `GLADIA_ENDPOINTING_SEC` default) |
| `DEEPGRAM_STT_IDLE_MS` | `1500` | `1500` |
| `NOISE_CANCELLATION` | `bvc` (default) | `bvc` (default) |
| `BACKEND_BASE_URL` / `COST_EVENT_SECRET` | set | set |

## 5. Known limitations (accepted for launch)

- Caption packets are broadcast to all participants per target language (K encodings/publishes per partial). Fine at ≤50 participants / ≤5 languages; revisit if rooms grow.
- Gladia native translation suppresses original-language finals; same-language listeners get `originalText` from the translation packet — verified working, but original-text fidelity depends on Gladia's `source_texts`.
- LLM token usage is estimated (~4 chars/token) when the provider omits usage data.
- STT idle finalize timing (`1500ms`) is a global knob, not per-language.

## 6. Post-launch branch strategy

`v2-foundation` is the launch branch → merge to `main` at launch, then:

- `feat/<name>` branches off `main`, one feature per branch, PR + staging verify before merge
- Agent changes that touch shared code (`transcription_only_agent.py`) must state which pipeline they affect and be tested on **both** agents before deploy
- Candidate first branches: gladia-translation-GA (flip default pipeline), recording/transcripts export, per-room language allow-lists UI, caption styling/accessibility, cost dashboard

## 7. Launch decision gates

1. Language matrix green on the default (Deepgram) pipeline — **required**
2. Resilience checklist green — **required**
3. Cost telemetry verified — **required**
4. Gladia matrix green — optional (it's host-switchable; can GA later)
