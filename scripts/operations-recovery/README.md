# Runtime recovery snapshots

The operator-owned recovery workflow preserves configuration in three AWS Secrets Manager records in account `690248313257`, region `us-east-2`: `lalia/prod/recovery/backend`, `agent-primary`, and `agent-stable`. These are recovery snapshots, not running application dependencies. It issues no provider rotation, settings-key rotation, or automatic configuration replacement.

## Capture and source qualification

```sh
python3 scripts/operations-recovery/capture.py --evidence docs/launch/evidence/2026-11-12-runtime-recovery.json
```

The existing authenticated operator profile performs capture. Backend `.env` and selected effective PM2 application overrides travel through private SSH/process memory; no plaintext environment artifact is written locally or passed as a command argument. The application-key inventory includes literal source references and explicit dynamic storage settings. It excludes unrelated PM2/system environment values. Only metadata, key names, coverage states, version IDs and equality booleans are printed or saved as evidence. `localSourceRevision` identifies the local inspected source; deployed revision remains explicitly unverified unless established separately.

Backend `complete=true` means its required settings key, database/JWT/LiveKit/cost-reporting fields have qualified effective sources. It does not prove every integration credential is current, that every optional feature is configured, or that a restored application can contact external providers. A separate isolated restore verifies the recovered key against actual encrypted settings.

Agent cloud secrets are write-only. Local provider values are `candidate_local_copy`, absent required fields are `unknown`, and only qualified newly issued fields retain `new_issued_verified`. Matching names or nonempty local values do not establish equality with deployed values. Generic agent capture therefore remains incomplete; the known-value procedure below establishes complete recovery coverage by applying and verifying a reviewed configuration. Never silently rotate provider keys or overwrite an agent with a partial manifest to resolve coverage gaps. Existing complete snapshots cannot be replaced by incomplete candidates.

## Establish known agent values

`establish_agent.py` restores known configuration to the existing production agents without claiming to export their write-only cloud values. Its source qualification is **known values reapplied and verified, not cloud export**. The operator must independently review source, provider authentication, worker logs, media results, and backend cost/quota evidence. The final evidence JSON is an operator attestation, not an independent cloud audit performed by the helper.

Before running it, confirm the reviewed source revision and observed deployment versions in `SOURCE_REVISION` and `PROFILES`. The reviewed STT usage-recovery source is `a82930ad4449d2c55b79a94be2c2e7c7e1a37884`; the helper deliberately advances `AGENT_BUILD_REF` to that revision. The pinned target versions are primary `Ckpqp8J7B2Jw` and stable `q5NLx2CmaUKC`. Successful image builds alone do not authorize execution: each target must be promoted to the expected production agent and observed Running before prepare/apply. Module, agent name, privacy-probe setting, and issued AWS credentials retain verified provenance. New deployment version constants must come from observed successful deployment status; do not substitute a build reference for a LiveKit deployment version.

The helper uses AWS profile `jarmetals`, account `690248313257`, region `us-east-2`, and LiveKit project `production`. It requires the correct agent ID, name, version, and Running deployments. It selects exactly deployed secret names, with only `BACKEND_BASE_URL` and `COST_EVENT_SECRET` permitted as stable-profile additions. It obtains the cost-event secret from the complete backend snapshot and uses `https://lalia.cloud` as the canonical endpoint. Other reviewed provider/timing settings are explicit in `desired_values()`. Missing retained values, unexpected inventory changes, injected LiveKit credentials, unsafe values, or mismatched identity fail closed; unrelated local `.env` fields are not imported.

Run each profile separately, retaining the sanitized metadata and receipt files. The commands below use placeholders for the exact version returned by prepare; never pass secret values on the command line.

1. **Prepare the encrypted input before applying it.** This writes an incomplete version with the custom `known-values-pending` stage, then retrieves that exact version and compares its contents. It does not move `AWSCURRENT`.

   ```sh
   python3 scripts/operations-recovery/establish_agent.py prepare --profile stable --output /tmp/lalia-stable-pending.json
   ```

2. **Apply that exact pending version.** Recheck its sanitized key inventory and version ID, then run:

   ```sh
   python3 scripts/operations-recovery/establish_agent.py apply --profile stable --version-id PENDING_VERSION_ID --output /tmp/lalia-stable-apply.json
   ```

   The helper rechecks the Running deployment and unchanged baseline inventory, retrieves the exact pending version by ID and stage, and passes values in a mode-0600 temporary dotenv file. LiveKit merges the supplied values into the same agent; `--overwrite` is never used. The file is removed even when the command fails, and private subprocess output is withheld. A successful apply receipt still reports `complete=false`.

3. **Wait for the new worker and drain the previous worker before starting media.** A Running status with the same image version immediately after updating secrets is insufficient: the old worker can still accept jobs during rollout. Inspect scoped worker registration/stop logs and retain the distinct worker IDs and UTC timestamps. Both new-worker registration and previous-worker stop must follow the apply receipt and precede the media test.

4. **Verify fresh media, actual provider costs, and quota reconciliation.** Use a disposable `lalia-canary-usage-{profile}-...` fixture and `canary-synthetic-` participant identities. The stable profile must pass its caption media checks; primary must additionally produce actual TTS audio. The scoped backend audit must show positive STT and LLM costs (plus TTS for primary), exact STT-to-quota mirroring, and matching usage/entitlement totals. A media-only pass or zero/missing provider-cost rows is a failure; leave recovery incomplete and investigate. Preserve actual supporting media, worker-log, and backend audit artifacts before preparing the attestation.

   Required attestation fields are `schema_version: 1`, `profile`, `agent_id`, `deployment_version`, `secret_version_id`, and UTC `verified_at`; `scope` contains `room_name` and `identity_prefix`; `media` contains `passed`, `tts_required`, and `tts_passed`; `telemetry` contains `positive` and `quota_matches`. `rollout` must contain `new_worker_id`, `previous_worker_id`, `new_worker_registered_at`, `previous_worker_stopped_at`, and `media_started_at`. IDs must be nonempty and distinct. The helper enforces `prepared <= applied <= registered <= media_started <= verified <= now` and `applied <= previous_worker_stopped <= media_started`. `tts_required` is true for primary and false for stable. Supporting scoped aggregate details may accompany these fields.

5. **Finalize only after independent evidence review.**

   ```sh
   python3 scripts/operations-recovery/establish_agent.py finalize --profile stable --version-id PENDING_VERSION_ID --receipt /tmp/lalia-stable-apply.json --usage-evidence /tmp/lalia-usage-stable-evidence.json --output /tmp/lalia-stable-complete.json
   ```

   Finalize requires the matching successful apply receipt, passing fresh-rollout/media/telemetry evidence, a still-Running expected deployment, and exact coverage of the full deployed name inventory. Only then does it call `save_snapshot` with `complete=true` and `known_deployed_verified` coverage. `save_snapshot` retrieves the new complete snapshot and verifies equality before promoting `AWSCURRENT`. Repeat this procedure with `--profile primary` and separate artifacts.

Preparing a new version moves the pending stage; older pending versions cannot subsequently apply or finalize through this helper. A reviewed source or deployment change also invalidates earlier pending snapshots. The initial stable attempt based on `947b932e9be6e9cf9d5fa44739ea8b13f5222aa8` failed STT accounting; it and the unapplied primary pending snapshot from that source are superseded and must never be finalized. Start fresh against the reviewed fix and observed deployment versions.

After an agent has a complete known-value snapshot, generic `capture.py` cannot refresh that agent's qualification: it still has only local candidate values and no cloud export. `save_snapshot` deliberately rejects its incomplete candidate instead of replacing the complete snapshot. A generic capture may have refreshed the backend before reaching that rejection. Do not weaken the guard, relabel local candidates as verified, or assume matching names prove equality. For an agent configuration change, repeat the reviewed prepare/apply/fresh-worker/media/quota/finalize procedure.

## Safe version promotion and history

Capture writes a uniquely labeled candidate version, retrieves it into memory, compares it internally, and only then promotes it to `AWSCURRENT`. A failed equality check leaves the previous current version intact. Identical effective snapshots create no new version. The first snapshot for each settings-key generation receives a persistent `key-generation-...` label; later captures with the same key do not move that historical label. This preserves the key source independently of `AWSCURRENT` and `AWSPREVIOUS`.

Every new database backup records its backend secret ARN, exact version ID and key-generation reference. Prefer preserving exact referenced versions, and always preserve labeled key generations until all dependent backup objects and noncurrent object versions have actually expired and been removed. If an exact version is unavailable, the verifier may use the matching pinned generation solely for decryption-key validation and records that it did not retrieve the exact historical environment. Do not rely on lifecycle scheduling alone as proof of deletion. No automatic version deletion, secret deletion or key rotation is enabled. Before any future settings-key rotation, plan database re-encryption and historical backup/key compatibility explicitly.

Separate exact-record managed permission policies are prepared for operator-controlled writers and readers. Runtime monitor, log writers and the EC2 backup identity receive no secret-read permission. The bootstrap capture operator currently performs the complete write/readback workflow; the narrow writer policy deliberately lacks read permission and cannot independently perform the verification phase.

## Restore verification and backup references

See [VERIFY-RESTORE.md](VERIFY-RESTORE.md) for the private-stream isolated PostgreSQL 16 procedure, strict root-owned reference file, tests and cleanup rules. The verifier starts no application, support/consent service, email, billing or provider job. It authenticates restored encrypted platform settings, prints aggregate counts only, and removes temporary artifacts and the isolated cluster after verification.

Current sanitized evidence is in the launch evidence directory and `restore-verification.json`. `restore-verification-legacy.json` records the compatible older backup that lacked an embedded reference; subsequent evidence must distinguish that compatibility check from a newly referenced backup. No evidence file contains secret values or decrypted settings.
