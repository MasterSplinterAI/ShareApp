#!/usr/bin/env python3
"""Enable approved CloudWatch drains only after the sanitized image is running.

The operator supplies the canary-verified promoted version. Values are read from
the encrypted recovery store, never printed or passed as command arguments.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from provision import AGENTS, ACCOUNT, REGION, PREFIX, validate_stored_key

CLI = '/tmp/lalia-lk-2.19.4/lk'
FIELDS = ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION')

def verify_status(status, agent_id, expected_version):
    agents = status.get('agents', [])
    if len(agents) != 1 or agents[0].get('agentId') != agent_id or agents[0].get('version') != expected_version:
        raise ValueError('Unexpected agent production version')
    deployments = agents[0].get('agentDeployments', [])
    if not any(not d.get('deployment') for d in deployments):
        raise ValueError('No production deployment')
    if any(d.get('version') != expected_version or d.get('status') != 'Running' for d in deployments):
        raise ValueError('Every extant deployment must run the reviewed sanitized version')

def secret_lines(values):
    if values.get('AWS_REGION') != REGION:
        raise ValueError('Unexpected log destination region')
    for key in FIELDS:
        value = values.get(key)
        if not isinstance(value, str) or not value or any(c in value for c in '\r\n\x00'):
            raise ValueError('Invalid drain configuration')
    return ''.join(key+'='+values[key]+'\n' for key in FIELDS)

def private_cli(args):
    result = subprocess.run([CLI, '--project', 'production', *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
    if result.returncode:
        raise RuntimeError('LiveKit command failed; private output withheld')
    return result.stdout

def enable(label, version):
    import boto3
    session = boto3.Session(profile_name='jarmetals', region_name=REGION)
    if session.client('sts').get_caller_identity()['Account'] != ACCOUNT:
        raise ValueError('Unexpected AWS account')
    agent_id = dict(AGENTS)[label]
    verify_status(json.loads(private_cli(['agent', 'status', '--id', agent_id, '--json'])), agent_id, version)
    snapshot = json.loads(session.client('secretsmanager').get_secret_value(SecretId=PREFIX+'agent-'+label)['SecretString'])
    validate_stored_key(session.client('iam'), 'lalia-'+label+'-agent-log-writer', snapshot['values'].get('AWS_ACCESS_KEY_ID'))
    payload = secret_lines(snapshot['values'])
    with tempfile.TemporaryDirectory(prefix='lalia-private-drain-') as directory:
        file = Path(directory)/'drain.env'
        descriptor = os.open(file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            stream.write(payload)
        # No --overwrite: preserve all provider and application settings.
        private_cli(['agent', 'update-secrets', '--id', agent_id, '--secrets-file', str(file)])
    print(json.dumps({'agentId':agent_id, 'reviewedVersion':version, 'fieldsMerged':list(FIELDS), 'temporaryFileRemoved':True, 'deliveryVerified':False}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', choices=[x[0] for x in AGENTS])
    parser.add_argument('--verified-version', required=True)
    args = parser.parse_args()
    try:
        enable(args.profile, args.verified_version)
    except Exception as error:
        print('Drain activation failed: '+type(error).__name__+'; private details withheld', file=sys.stderr)
        sys.exit(1)
