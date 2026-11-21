#!/usr/bin/env python3
"""Owner-run known-value recovery: prepare -> apply -> media audit -> finalize.

Secrets remain in memory except for a mode-0600 temporary dotenv file during apply.
No cloud export is implied: completion means known values reapplied and verified.
Only finalize calls save_snapshot and may promote AWSCURRENT. Commands suppress
private subprocess output, including errors. Do not run under shell tracing.
The usage-evidence JSON is an operator attestation: independently inspect its
scoped media, fresh-worker registration/previous-worker drain, and backend
cost/quota audit artifacts before invoking finalize.
"""
import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from recovery import ACCOUNT, REGION, PREFIX, save_snapshot

SOURCE_REVISION = 'a82930ad4449d2c55b79a94be2c2e7c7e1a37884'
PENDING_STAGE = 'known-values-pending'
PROFILES = {
    'primary': {'id': 'CA_do6qoLXhxqA7', 'version': 'Ckpqp8J7B2Jw',
                'module': 'transcription_codeswitch_agent', 'name': 'translation-cloud-deepgram-codeswitch'},
    'stable': {'id': 'CA_gKYczmp9DCNy', 'version': 'q5NLx2CmaUKC',
               'module': 'transcription_only_agent', 'name': 'translation-cloud-prod'},
}
# Require verified provenance for these retained fields. AGENT_BUILD_REF is then
# deliberately advanced to the reviewed source revision in desired_values().
PRESERVED = {'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AGENT_MODULE',
             'AGENT_NAME', 'AGENT_BUILD_REF', 'LALIA_LOG_PRIVACY_PROBE'}


def now():
    return datetime.now(timezone.utc).isoformat()


def secret_name(profile):
    if profile not in PROFILES:
        raise ValueError('Unexpected profile')
    return PREFIX + 'agent-' + profile


def inventory_names(raw):
    rows = raw.get('secrets') if isinstance(raw, dict) else raw
    if not isinstance(rows, list) or not rows:
        raise ValueError('Invalid deployed inventory')
    names = []
    for row in rows:
        if isinstance(row, dict):
            if row.get('kind', 'AGENT_SECRET_KIND_ENVIRONMENT') != 'AGENT_SECRET_KIND_ENVIRONMENT':
                raise ValueError('File-mounted secrets need a separate recovery workflow')
            name = row.get('name')
        else:
            name = row
        if not isinstance(name, str) or not re.fullmatch(r'[A-Z_][A-Z0-9_]*', name) or name.startswith('LIVEKIT_'):
            raise ValueError('Unsafe or injected secret name')
        names.append(name)
    if len(set(names)) != len(names):
        raise ValueError('Duplicate deployed secret name')
    return sorted(names)


def validate_values(values):
    if not isinstance(values, dict) or not values:
        raise ValueError('Missing values')
    inventory_names(list(values))
    for value in values.values():
        # Single-quoted dotenv values preserve $, #, spaces, double quotes and backslashes.
        # Embedded single quotes are refused instead of risking parser-dependent changes.
        if not isinstance(value, str) or not value.strip() or any(c in value for c in "\r\n\0'"):
            raise ValueError('Unsafe or empty retained value')


def desired_values(profile, cost_secret):
    # Owner-approved canonical settings from retained source; not an export of cloud values.
    values = {'AGENT_BUILD_REF': SOURCE_REVISION,
              'BACKEND_BASE_URL': 'https://lalia.cloud', 'COST_EVENT_SECRET': cost_secret,
              'CAPTION_UTTERANCE_END_DELAY_SEC': '3.0', 'LLM_PROVIDER': 'openai',
              'STT_PROVIDER': 'xai' if profile == 'primary' else 'deepgram'}
    if profile == 'primary':
        values.update(TTS_ENABLED='true', TTS_PROVIDER='xai', LOG_LEVEL='INFO', XAI_STT_ENDPOINTING_MS='600')
    return values


def require_identity(profile, values):
    cfg = PROFILES[profile]
    expected = {'AGENT_MODULE': cfg['module'], 'AGENT_NAME': cfg['name'],
                'AWS_REGION': REGION, 'LALIA_LOG_PRIVACY_PROBE': '0', 'AGENT_BUILD_REF': SOURCE_REVISION}
    if not PRESERVED <= set(values) or any(values[k] != v for k, v in expected.items()):
        raise ValueError('Retained deployment identity mismatch')
    needed = {'DEEPGRAM_API_KEY', 'OPENAI_API_KEY'} | ({'XAI_API_KEY', 'ELEVENLABS_API_KEY'} if profile == 'primary' else set())
    if not needed <= set(values):
        raise ValueError('Missing expected provider credentials')


def build_pending(profile, inventory, retained, backend):
    secret_name(profile)
    baseline = inventory_names(inventory)
    if retained.get('kind') != 'agent' or retained.get('agentId') != PROFILES[profile]['id']:
        raise ValueError('Retained snapshot profile mismatch')
    if backend.get('kind') != 'backend' or backend.get('complete') is not True or backend.get('coverage', {}).get('COST_EVENT_SECRET') != 'verified_effective':
        raise ValueError('Complete verified backend snapshot required')
    allowed_additions = {'BACKEND_BASE_URL', 'COST_EVENT_SECRET'} if profile == 'stable' else set()
    required = set(baseline) | allowed_additions
    desired = desired_values(profile, backend.get('values', {}).get('COST_EVENT_SECRET'))
    if not set(desired) <= required:
        raise ValueError('Expected settings missing from deployed inventory')
    retained_values = retained.get('values', {})
    for key in PRESERVED:
        qualification = retained.get('coverage', {}).get(key, '')
        if not qualification.startswith('new_issued_') and qualification != 'known_deployed_verified':
            raise ValueError('Verified retained deployment values required')
    values = {key: desired[key] if key in desired else retained_values.get(key) for key in sorted(required)}
    validate_values(values)
    require_identity(profile, values)
    snapshot = {'format': 1, 'kind': 'agent', 'complete': False, 'profile': profile,
                'agentId': PROFILES[profile]['id'], 'deployedVersion': PROFILES[profile]['version'],
                'sourceRevision': SOURCE_REVISION, 'sourceQualification': 'known values prepared for reapplication, not cloud export',
                'capturedAt': now(), 'baselineKeys': baseline, 'values': values,
                'coverage': {key: 'known_value_pending_application' for key in values}}
    validate_pending(profile, snapshot)
    return snapshot


def validate_pending(profile, snapshot):
    secret_name(profile)
    cfg = PROFILES[profile]
    if (snapshot.get('format') != 1 or snapshot.get('kind') != 'agent' or snapshot.get('complete') is not False
            or snapshot.get('profile') != profile or snapshot.get('agentId') != cfg['id']
            or snapshot.get('deployedVersion') != cfg['version'] or snapshot.get('sourceRevision') != SOURCE_REVISION):
        raise ValueError('Pending snapshot profile or state mismatch')
    baseline = set(inventory_names(snapshot.get('baselineKeys')))
    values = snapshot.get('values')
    validate_values(values)
    expected = baseline | ({'BACKEND_BASE_URL', 'COST_EVENT_SECRET'} if profile == 'stable' else set())
    if set(values) != expected or snapshot.get('coverage') != {k: 'known_value_pending_application' for k in values}:
        raise ValueError('Pending snapshot coverage mismatch')
    require_identity(profile, values)
    if any(values.get(k) != v for k, v in desired_values(profile, values.get('COST_EVENT_SECRET')).items()):
        raise ValueError('Pending settings do not match reviewed configuration')


def require_running(profile, status):
    cfg = PROFILES[profile]
    rows = status.get('agents', [])
    if len(rows) != 1:
        raise ValueError('Expected exactly one agent')
    row = rows[0]
    if row.get('agentId') != cfg['id'] or row.get('agentName') != cfg['name'] or row.get('version') != cfg['version']:
        raise ValueError('Live deployment identity mismatch')
    deployments = row.get('agentDeployments', [])
    if not deployments or any(d.get('status') != 'Running' or d.get('version') != cfg['version']
                              or d.get('deploymentEnabled') is not True or d.get('replicas', 0) < 1 for d in deployments):
        raise ValueError('Expected deployment is not Running')


def store_pending(sm, profile, snapshot):
    validate_pending(profile, snapshot)
    result = sm.put_secret_value(SecretId=secret_name(profile), SecretString=json.dumps(snapshot, sort_keys=True),
                                 VersionStages=[PENDING_STAGE])
    restored = json.loads(sm.get_secret_value(SecretId=secret_name(profile), VersionId=result['VersionId'],
                                              VersionStage=PENDING_STAGE)['SecretString'])
    if restored != snapshot:
        raise ValueError('Pending retrieval equality failed; no apply permitted')
    return {'arn': result['ARN'], 'versionId': result['VersionId'], 'pendingStage': PENDING_STAGE,
            'profile': profile, 'agentId': PROFILES[profile]['id'], 'complete': False,
            'keys': sorted(snapshot['values']), 'retrievalEqualityVerified': True}


def load_pending(sm, profile, version):
    if not isinstance(version, str) or not version:
        raise ValueError('Exact pending version required')
    snapshot = json.loads(sm.get_secret_value(SecretId=secret_name(profile), VersionId=version,
                                              VersionStage=PENDING_STAGE)['SecretString'])
    validate_pending(profile, snapshot)
    return snapshot


def apply_pending(sm, profile, version, lk):
    snapshot = load_pending(sm, profile, version)
    require_running(profile, lk.status(profile))
    if inventory_names(lk.inventory(profile)) != snapshot['baselineKeys']:
        raise ValueError('Inventory changed after prepare; apply blocked')
    fd, path = tempfile.mkstemp(prefix='lalia-agent-secrets-', suffix='.env')
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            for key, value in sorted(snapshot['values'].items()):
                handle.write(f"{key}='{value}'\n")
            handle.flush()
            os.fsync(handle.fileno())
        lk.update(profile, path)
    finally:
        os.unlink(path)
    return {'profile': profile, 'agentId': PROFILES[profile]['id'], 'versionId': version,
            'applied': True, 'appliedAt': now(), 'keys': sorted(snapshot['values']),
            'complete': False, 'awaiting': 'Fresh worker registration, previous worker drain, Running status and scoped usage/media evidence'}


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Timezone required')
    return parsed


def verify_evidence(profile, version, receipt, evidence, snapshot):
    cfg = PROFILES[profile]
    if (receipt.get('profile') != profile or receipt.get('agentId') != cfg['id']
            or receipt.get('versionId') != version or receipt.get('applied') is not True):
        raise ValueError('Matching successful apply receipt required')
    if (evidence.get('schema_version') != 1 or evidence.get('profile') != profile
            or evidence.get('agent_id') != cfg['id'] or evidence.get('deployment_version') != cfg['version']
            or evidence.get('secret_version_id') != version):
        raise ValueError('Scoped evidence identity mismatch')
    media, telemetry, scope = (evidence.get(k, {}) for k in ('media', 'telemetry', 'scope'))
    if (media.get('passed') is not True or media.get('tts_required') is not (profile == 'primary')
            or (profile == 'primary' and media.get('tts_passed') is not True)
            or telemetry.get('positive') is not True or telemetry.get('quota_matches') is not True
            or not isinstance(scope.get('room_name'), str)
            or not scope['room_name'].startswith('lalia-canary-usage-' + profile + '-')
            or scope.get('identity_prefix') != 'canary-synthetic-'):
        raise ValueError('Passing scoped media, actual telemetry and quota evidence required')
    rollout = evidence.get('rollout', {})
    if not isinstance(rollout, dict):
        raise ValueError('Fresh rollout attestation required')
    worker_ids = [rollout.get(k) for k in ('new_worker_id', 'previous_worker_id')]
    if any(not isinstance(worker, str) or not worker.strip() for worker in worker_ids) or worker_ids[0].strip() == worker_ids[1].strip():
        raise ValueError('Distinct new and previous worker identities required')
    try:
        prepared, applied, verified = (timestamp(v) for v in (snapshot['capturedAt'], receipt['appliedAt'], evidence['verified_at']))
        if not prepared <= applied <= verified <= datetime.now(timezone.utc):
            raise ValueError('Evidence time ordering invalid')
        registered, stopped, media_started = (timestamp(rollout[k]) for k in (
            'new_worker_registered_at', 'previous_worker_stopped_at', 'media_started_at'))
        if not (applied <= registered <= media_started <= verified and applied <= stopped <= media_started):
            raise ValueError('Media must start after fresh worker registration and previous worker drain')
    except (KeyError, TypeError, AttributeError):
        raise ValueError('Evidence timestamps required') from None


def finalize_pending(sm, profile, version, lk, receipt, evidence):
    snapshot = load_pending(sm, profile, version)
    verify_evidence(profile, version, receipt, evidence, snapshot)
    require_running(profile, lk.status(profile))
    if set(inventory_names(lk.inventory(profile))) != set(snapshot['values']):
        raise ValueError('Full deployed name coverage required')
    final = copy.deepcopy(snapshot)
    final.update(complete=True, capturedAt=now(), sourceQualification='known values reapplied and verified, not cloud export',
                 coverage={key: 'known_deployed_verified' for key in final['values']},
                 appliedPendingVersionId=version, appliedAt=receipt['appliedAt'], verificationEvidence=evidence,
                 verificationEvidenceSha256=hashlib.sha256(json.dumps(evidence, sort_keys=True).encode()).hexdigest())
    return save_snapshot(sm, secret_name(profile), final)


class LiveKit:
    def __init__(self, binary):
        self.binary = binary

    def run(self, args, json_output=True):
        # Ignore ambient credentials so --project production is authoritative.
        env = {k: v for k, v in os.environ.items() if not k.startswith('LIVEKIT_')}
        with tempfile.TemporaryDirectory(prefix='lalia-lk-operation-') as cwd:
            result = subprocess.run([self.binary, '--project', 'production', 'agent'] + args,
                                    cwd=cwd, env=env, text=True, capture_output=True, timeout=180)
        if result.returncode:
            raise RuntimeError('Private LiveKit command failed; output withheld')
        return json.loads(result.stdout) if json_output else None

    def status(self, profile):
        return self.run(['status', '--id', PROFILES[profile]['id'], '--json'])

    def inventory(self, profile):
        return inventory_names(self.run(['secrets', '--id', PROFILES[profile]['id'], '--json']))

    def update(self, profile, path):
        return self.run(['update-secrets', '--id', PROFILES[profile]['id'], '--secrets-file', path], False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'apply', 'finalize'])
    parser.add_argument('--profile', required=True, choices=sorted(PROFILES))
    parser.add_argument('--version-id')
    parser.add_argument('--receipt', help='Apply receipt JSON; required for finalize')
    parser.add_argument('--usage-evidence', help='Scoped audited usage/media JSON; required for finalize')
    parser.add_argument('--output', required=True, help='Sanitized result metadata JSON')
    parser.add_argument('--lk-binary', default='/tmp/lalia-lk-2.19.4/lk')
    args = parser.parse_args()
    if args.action != 'prepare' and not args.version_id:
        parser.error('--version-id required for apply and finalize')
    if args.action == 'finalize' and not (args.receipt and args.usage_evidence):
        parser.error('--receipt and --usage-evidence required for finalize')
    import boto3
    session = boto3.Session(profile_name='jarmetals', region_name=REGION)
    if session.client('sts').get_caller_identity()['Account'] != ACCOUNT:
        raise ValueError('Wrong AWS account')
    sm = session.client('secretsmanager')
    lk = LiveKit(str(Path(args.lk_binary).resolve()))
    if args.action == 'prepare':
        require_running(args.profile, lk.status(args.profile))
        retained = json.loads(sm.get_secret_value(SecretId=secret_name(args.profile))['SecretString'])
        backend = json.loads(sm.get_secret_value(SecretId=PREFIX + 'backend')['SecretString'])
        result = store_pending(sm, args.profile, build_pending(args.profile, lk.inventory(args.profile), retained, backend))
    elif args.action == 'apply':
        result = apply_pending(sm, args.profile, args.version_id, lk)
    else:
        result = finalize_pending(sm, args.profile, args.version_id, lk,
                                  json.loads(Path(args.receipt).read_text()), json.loads(Path(args.usage_evidence).read_text()))
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'action': args.action, 'profile': args.profile, 'versionId': result['versionId'],
                      'complete': result['complete']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print('Agent recovery failed: ' + type(exc).__name__ + '; private outputs withheld', file=sys.stderr)
        sys.exit(1)
