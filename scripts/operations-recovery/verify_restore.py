#!/usr/bin/env python3
"""Stream an S3 backup and recovered key to an isolated remote PG16 drill.

No customer artifact or plaintext key is written locally. Only aggregate evidence
is saved. The EC2 instance receives no AWS credential or Secrets Manager access.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess
import sys
import threading

ACCOUNT = '690248313257'
REGION = 'us-east-2'
BUCKET = 'lalia-backups-690248313257-us-east-2'
PREFIX = 'lalia/daily/'
FILES = {'manifest.json', 'database.dump', 'uploads.tar.gz'}
SSH = ['ssh', '-i', '/Users/rhule/Downloads/AxisAlgo.pem', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', 'ubuntu@3.16.210.84']

def select_backup(objects, now):
    runs = {}
    for item in objects:
        key = item.get('Key', '')
        if not key.startswith(PREFIX):
            continue
        relative = key[len(PREFIX):]
        if '/' not in relative:
            continue
        run, name = relative.split('/', 1)
        if run:
            runs.setdefault(run, []).append((name, item))
    valid = []
    for run, entries in runs.items():
        if len(entries) != 3 or {name for name, _ in entries} != FILES or not all(item.get('Size', 0) > 0 for _, item in entries):
            continue
        completed = next(item['LastModified'] for name, item in entries if name == 'manifest.json')
        age = (now-completed).total_seconds()
        if 0 <= age <= 26*3600:
            valid.append((completed, run))
    if not valid:
        raise ValueError('No fresh complete backup')
    return PREFIX + max(valid)[1] + '/'

def recovery_reference(manifest, evidence):
    if 'recovery' in manifest:
        ref = manifest['recovery']
    else:
        backend = evidence['snapshots']['backend']
        if backend.get('complete') is not True:
            raise ValueError('Legacy backup requires verified complete recovery source')
        ref = {'format': 1, 'backend': {'secretArn': backend['arn'], 'versionId': backend['versionId'], 'keyGeneration': backend['keyGeneration']}}
    backend = ref.get('backend', {})
    if set(ref) != {'format', 'backend'} or ref['format'] != 1 or set(backend) != {'secretArn', 'versionId', 'keyGeneration'}:
        raise ValueError('Invalid recovery reference schema')
    patterns = {'secretArn': r'arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-[A-Za-z0-9]{6}', 'versionId': r'[A-Za-z0-9-]{32,64}', 'keyGeneration': r'key-generation-[a-f0-9]{24}'}
    if any(not isinstance(backend.get(key), str) or not re.fullmatch(pattern, backend[key]) for key, pattern in patterns.items()):
        raise ValueError('Unexpected recovery reference')
    return ref

def retrieve_key(sm, backend):
    fallback = False
    try:
        recovered = sm.get_secret_value(SecretId=backend['secretArn'], VersionId=backend['versionId'])
    except sm.exceptions.ResourceNotFoundException:
        fallback = True
        recovered = sm.get_secret_value(SecretId=backend['secretArn'], VersionStage=backend['keyGeneration'])
    if recovered['ARN'] != backend['secretArn'] or (not fallback and recovered['VersionId'] != backend['versionId']):
        raise ValueError('Unexpected recovery version')
    snapshot = json.loads(recovered['SecretString'])
    key = snapshot['values']['SETTINGS_ENCRYPTION_KEY']
    generation = 'key-generation-'+hashlib.sha256(key.strip().encode()).hexdigest()[:24]
    if snapshot.get('complete') is not True or snapshot.get('keyGeneration') != backend['keyGeneration'] or generation != backend['keyGeneration']:
        raise ValueError('Recovery key generation mismatch')
    return key, {'requestedVersionId': backend['versionId'], 'actualVersionId': recovered['VersionId'], 'historicalGenerationFallbackUsed': fallback, 'exactConfigurationVersionRetrieved': not fallback}

def private_ssh(command, data=None, timeout=600):
    result = subprocess.run(SSH+[command], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Private remote command failed; output withheld')
    return result.stdout

def stream_to_remote(body, destination):
    process = subprocess.Popen(SSH+['umask 077; cat > '+shlex.quote(destination)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    timer = threading.Timer(600, process.kill)
    timer.start()
    try:
        for chunk in body.iter_chunks(chunk_size=1024*1024):
            process.stdin.write(chunk)
        process.stdin.close()
        if process.wait(timeout=30):
            raise RuntimeError('Private artifact transfer failed')
    finally:
        timer.cancel()
        body.close()
        if process.poll() is None:
            process.kill()
        process.wait()

def perform_restore(evidence_path, output_path):
    import boto3
    from botocore.config import Config
    session = boto3.Session(profile_name='jarmetals', region_name=REGION)
    config = Config(connect_timeout=5, read_timeout=30, retries={'max_attempts': 2})
    if session.client('sts', config=config).get_caller_identity()['Account'] != ACCOUNT:
        raise RuntimeError('Unexpected AWS account')
    s3 = session.client('s3', config=config)
    objects = [item for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=PREFIX) for item in page.get('Contents', [])]
    started = datetime.now(timezone.utc)
    prefix = select_backup(objects, started)
    response = s3.get_object(Bucket=BUCKET, Key=prefix+'manifest.json')
    try:
        manifest_bytes = response['Body'].read(16*1024*1024+1)
    finally:
        response['Body'].close()
    if len(manifest_bytes) > 16*1024*1024:
        raise ValueError('Unexpected manifest size')
    manifest = json.loads(manifest_bytes)
    ref = recovery_reference(manifest, json.loads(Path(evidence_path).read_text()))
    backend = ref['backend']
    key, retrieval = retrieve_key(session.client('secretsmanager', config=config), backend)
    remote = private_ssh('umask 077; mktemp -d /tmp/lalia-key-restore.XXXXXXXX').decode().strip()
    if not re.fullmatch(r'/tmp/lalia-key-restore\.[A-Za-z0-9]{8}', remote):
        raise ValueError('Unexpected private restore directory')
    result = None
    try:
        private_ssh('umask 077; cat > '+shlex.quote(remote+'/manifest.json'), manifest_bytes)
        del manifest_bytes, manifest
        for filename in ['database.dump', 'uploads.tar.gz']:
            body = s3.get_object(Bucket=BUCKET, Key=prefix+filename)['Body']
            stream_to_remote(body, remote+'/'+filename)
        private_ssh('umask 077; cat > '+shlex.quote(remote+'/verify-restore.cjs'), Path(__file__).with_name('verify-restore.cjs').read_bytes())
        output = private_ssh('LALIA_BACKUP_TOOLS=/opt/lalia-backup node '+shlex.quote(remote+'/verify-restore.cjs')+' '+shlex.quote(remote), json.dumps({'settingsKey': key}).encode())
        key = None
        result = json.loads(output)
        if result.get('status') != 'restore_and_key_verified' or result.get('allAuthenticated') is not True:
            raise ValueError('Restore result failed verification')
    finally:
        key = None
        private_ssh('rm -rf -- '+shlex.quote(remote)+' && test ! -e '+shlex.quote(remote), timeout=30)
    # withCluster returns only after pg_ctl stop and removal have succeeded.
    evidence = {'startedAt': started.isoformat(), 'completedAt': datetime.now(timezone.utc).isoformat(), 'account': ACCOUNT, 'region': REGION, 'backupBucket': BUCKET, 'backupPrefix': prefix, 'recovery': ref, 'keyRetrieval': retrieval, 'verification': result, 'temporaryInputsRemoved': True, 'isolatedClusterStoppedAndRemoved': True, 'localCustomerFilesCreated': False, 'plaintextKeyFilesCreated': False, 'ec2SecretReadGranted': False}
    Path(output_path).write_text(json.dumps(evidence, indent=2)+'\n')
    print(json.dumps({'status': result['status'], 'tables': result['tables'], 'constraints': result['constraints'], 'encryptedValues': result['encryptedValues'], 'allAuthenticated': result['allAuthenticated'], 'cleanupVerified': True}))

def main():
    repo = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recovery-evidence', default=str(repo/'docs/launch/evidence/2026-11-12-runtime-recovery.json'))
    parser.add_argument('--output', default=str(Path(__file__).with_name('restore-verification.json')))
    args = parser.parse_args()
    perform_restore(args.recovery_evidence, args.output)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Private restore verification failed: '+type(error).__name__+'; details withheld', file=sys.stderr)
        sys.exit(1)
