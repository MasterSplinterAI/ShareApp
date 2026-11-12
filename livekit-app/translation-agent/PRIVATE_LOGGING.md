# Private operational logging

Both deployed caption profiles use `agent_launcher.py`, which validates the selected module, restricts the pre-exec build reference to a Git-style hexadecimal revision, forces `LALIA_PRIVATE_LOG_OUTPUT=1`, and execs the worker. Python remains PID 1. Each agent installs privacy handling before importing LiveKit/provider code; spawned job interpreters inherit the setting.

Application logs contain reviewed static events (`private_log_events.py`), bounded numeric counts/durations/statuses, enumerated providers/exception types, validated revision identifiers, a generated process UUID, PID, and generated Unix timestamp. Raw utterances, translated text, participant identities/maps, room names, response bodies, URLs, exception strings, stacks, and arbitrary SDK extras are removed. The caption/transcript data-channel and product storage paths remain intact. Cost-report/demo failures no longer read provider response text for logging.

`private_logging.py` reconstructs records at actual handler boundaries and again after handler filters. Later SDK setup, debug loggers, nonpropagating loggers, cached traceback text, and IPC queue serialization cannot restore unrestricted fields. Known SDK lifecycle messages become `sdk_worker_registered`, `sdk_job_requested`, etc.; other SDK messages become `sdk_event`, retaining severity and a known exception type/provider when available.

An fd-level gate redirects stdout/stderr into a bounded pipe reader. It drops arbitrary Python prints, native writes, uncaught tracebacks, and formatter bypasses; the first such write produces `unstructured_output_suppressed`. Trusted structured events are written synchronously through a saved descriptor, avoiding forkserver `os._exit()` flush loss. Child output traverses parent gates as authenticated frames using an ephemeral process-family transport key. The gate verifies the signature **and** a strict field/value schema before forwarding. The key is not an AWS/provider credential, must never be logged or snapshotted, and is regenerated at the worker boundary. Forked processes reset the output lock; pipe threads are daemon threads and shutdown joins are bounded.

Operational tradeoffs: unreviewed SDK text and raw crash detail are intentionally unavailable; use event severity, provider, exception class, status, timing, process UUID and the source revision to investigate. SDK log handler duplication can duplicate events. Raw CLI help is suppressed when run through the production launcher. This policy is scoped to the supported launcher/profiles, not arbitrary direct execution of legacy agent scripts, build logs, or processes deliberately writing to separately opened host logging descriptors. Direct helper imports apply record sanitation, while fd protection is enabled by the launcher or explicit `protect_output=True`. A SIGKILL or abrupt parent shutdown can lose trailing child diagnostics. No previously emitted logs are retroactively removed.

## Verification

With the agent requirements installed, run:

```sh
python -m pytest -q
python runtime_smoke.py
python privacy_probe.py
```

When pytest uses a different Python from the real SDK runtime, set `LALIA_AGENT_RUNTIME_PYTHON=/path/to/agent/python`. SDK subprocess checks skip with an explicit reason if that interpreter lacks LiveKit; a release verification must run them, not accept those skips. Forkserver tests need permission to bind a local Unix socket. They make no provider/cloud calls.

For an approved named canary or drain verification, set `LALIA_LOG_PRIVACY_PROBE=1` using the existing safe configuration merge workflow. At worker startup it emits synthetic speech/body/token/URL fixtures into untrusted logging/native stderr, then one safe `privacy_controlled_error` ERROR event (`RuntimeError`, status 503). This is a diagnostic fixture: it does not fail a room or call a provider. Remove/disable that flag after verification. Confirm the event and `worker_started`/SDK lifecycle/session markers, process UUIDs, correct profile and build, with no sentinel content. `python privacy_probe.py` performs the same no-network check inside an image without starting an agent.

Local tests do not establish CloudWatch delivery, Linux image behavior, real RTC media, rolling restart stream history, retention, or IAM isolation. Those remain separate release gates. Disable the dedicated AWS log writer **before** rolling back to an older image that logs speech.
