# Runtime recovery snapshots

The operator-owned recovery workflow preserves configuration in three AWS Secrets Manager records in account `690248313257`, region `us-east-2`: `lalia/prod/recovery/backend`, `agent-primary`, and `agent-stable`. These are recovery snapshots, not running application dependencies. It issues no provider rotation, settings-key rotation, or automatic configuration replacement.

## Capture and source qualification

```sh
python3 scripts/operations-recovery/capture.py --evidence docs/launch/evidence/2026-11-12-runtime-recovery.json
```

The existing authenticated operator profile performs capture. Backend `.env` and selected effective PM2 application overrides travel through private SSH/process memory; no plaintext environment artifact is written locally or passed as a command argument. The application-key inventory includes literal source references and explicit dynamic storage settings. It excludes unrelated PM2/system environment values. Only metadata, key names, coverage states, version IDs and equality booleans are printed or saved as evidence. `localSourceRevision` identifies the local inspected source; deployed revision remains explicitly unverified unless established separately.

Backend `complete=true` means its required settings key, database/JWT/LiveKit/cost-reporting fields have qualified effective sources. It does not prove every integration credential is current, that every optional feature is configured, or that a restored application can contact external providers. A separate isolated restore verifies the recovered key against actual encrypted settings.

Agent cloud secrets are write-only. Local provider values are `candidate_local_copy`, absent required fields are `unknown`, and only qualified newly issued fields retain `new_issued_verified`. Matching names or nonempty local values do not establish equality with deployed values. Agent snapshots therefore remain incomplete until all required sources are qualified. Never silently rotate provider keys or overwrite an agent with a partial manifest to resolve coverage gaps. Existing complete snapshots cannot be replaced by incomplete candidates.

## Safe version promotion and history

Capture writes a uniquely labeled candidate version, retrieves it into memory, compares it internally, and only then promotes it to `AWSCURRENT`. A failed equality check leaves the previous current version intact. Identical effective snapshots create no new version. The first snapshot for each settings-key generation receives a persistent `key-generation-...` label; later captures with the same key do not move that historical label. This preserves the key source independently of `AWSCURRENT` and `AWSPREVIOUS`.

Every new database backup records its backend secret ARN, exact version ID and key-generation reference. Prefer preserving exact referenced versions, and always preserve labeled key generations until all dependent backup objects and noncurrent object versions have actually expired and been removed. If an exact version is unavailable, the verifier may use the matching pinned generation solely for decryption-key validation and records that it did not retrieve the exact historical environment. Do not rely on lifecycle scheduling alone as proof of deletion. No automatic version deletion, secret deletion or key rotation is enabled. Before any future settings-key rotation, plan database re-encryption and historical backup/key compatibility explicitly.

Separate exact-record managed permission policies are prepared for operator-controlled writers and readers. Runtime monitor, log writers and the EC2 backup identity receive no secret-read permission. The bootstrap capture operator currently performs the complete write/readback workflow; the narrow writer policy deliberately lacks read permission and cannot independently perform the verification phase.

## Restore verification and backup references

See [VERIFY-RESTORE.md](VERIFY-RESTORE.md) for the private-stream isolated PostgreSQL 16 procedure, strict root-owned reference file, tests and cleanup rules. The verifier starts no application, support/consent service, email, billing or provider job. It authenticates restored encrypted platform settings, prints aggregate counts only, and removes temporary artifacts and the isolated cluster after verification.

Current sanitized evidence is in the launch evidence directory and `restore-verification.json`. `restore-verification-legacy.json` records the compatible older backup that lacked an embedded reference; subsequent evidence must distinguish that compatibility check from a newly referenced backup. No evidence file contains secret values or decrypted settings.
