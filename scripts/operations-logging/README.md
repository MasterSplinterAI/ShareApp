# Sanitized LiveKit runtime logs

Owner approved November 12, 2026. Account `690248313257`, region `us-east-2`.
The two groups are `CA_do6qoLXhxqA7` (primary) and `CA_gKYczmp9DCNy`
(stable). Each retains events for 30 days; streams are LiveKit worker IDs.

This uses the [documented LiveKit CloudWatch drain](https://docs.livekit.io/deploy/agents/log-drains/).
It forwards process stdout/stderr, not recordings or product transcript storage.
All deployed profiles must use reviewed private logging before enabling it.
See `livekit-app/translation-agent/PRIVATE_LOGGING.md` for filtering boundaries
and lost diagnostic detail. Build logs and platform-generated messages are
outside the application formatter; do not assume every platform log is scrubbed.

## Permissions and activation

`provision.py` creates one writer per agent. Each can create its exact group,
create streams there and append events. Neither can read/delete logs, write to
another agent, or read recovery secrets. The 30-day policy is set by the owner,
not the writer. New keys are saved in the corresponding encrypted recovery
snapshot before use; they are initially marked `new_issued_pending_delivery`.
Do not print recovery payloads or credentials.

1. Test the sanitized committed image in a named deployment with real media.
2. Promote that exact image; record its previous production version.
3. Ensure all extant deployments for that agent run the sanitized version.
4. Run `python3 scripts/operations-logging/enable.py primary --verified-version VERSION`
   (or `stable`). It checks versions/status and merges only the three AWS fields
   using a private temporary file removed after the command. This restarts workers.
5. Observe actual startup, dispatch, session end and synthetic controlled-error
   events in CloudWatch. Verify no synthetic content/credential sentinels and
   retain evidence of at least two worker streams for restart history.
6. Mark newly issued key coverage verified only after actual delivery. Disable
   the synthetic privacy probe after acceptance using a merge update.

Never use `--overwrite`, put credential values on command lines, or grant broad
CloudWatch/Secrets Manager policies to resolve a delivery problem. Existing
provider credentials are outside this setup and must not be rotated speculatively.

## Rollback and operation

Before rolling back to a version that may log speech or provider content, disable
that agent's dedicated IAM access key so the drain cannot ingest unsafe output.
Then use the recorded LiveKit rollback version. Preserve already sanitized history.
Do not delete a recovery snapshot or key generation while backups depend on it.

If delivery stops, check agent version/Running state, region, exact-group IAM,
and new stream timestamps. No logs may simply mean no runtime activity; the
independent health monitor does not assert that RTC, STT or TTS is healthy.
Baseline AWS operations cost was estimated at $2–5/month plus log ingestion and
storage; actual costs depend on event volume and retention.

Tests: `python3 -m unittest discover -s scripts/operations-logging -v`.
Sanitized deployment/IAM/delivery evidence is in
`docs/launch/evidence/2026-11-12-agent-log-drains.json`.
