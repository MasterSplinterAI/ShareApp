"""Recovery snapshots. Values are private; only sanitized return metadata may be printed."""
import hashlib
import json
import uuid
from datetime import datetime, timezone

ACCOUNT = '690248313257'
REGION = 'us-east-2'
PREFIX = 'lalia/prod/recovery/'

def generation_label(key):
    return 'key-generation-' + hashlib.sha256(key.strip().encode()).hexdigest()[:24]

def backend_snapshot(file_values, overrides, approved_keys=(), revision="unknown"):
    values = dict(file_values)
    sources = {k:'backend_env' for k in values}
    for k in set(values) | set(approved_keys):
        if k in overrides and isinstance(overrides[k], str):
            values[k] = overrides[k]
            sources[k] = 'effective_pm2'
    if not values.get('SETTINGS_ENCRYPTION_KEY','').strip():
        raise ValueError('Dedicated settings key required')
    required = ['SETTINGS_ENCRYPTION_KEY','DATABASE_URL','JWT_SECRET_V2','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','COST_EVENT_SECRET']
    coverage = {k:('verified_effective' if values.get(k) else 'missing') for k in required}
    return {'format':1, 'kind':'backend', 'complete':all(v=='verified_effective' for v in coverage.values()), 'coverage':coverage, 'localSourceRevision':revision, 'deployedRevision':'not independently identified by capture' , 'sourcePaths':['/var/www/share-app-staging/livekit-app/backend/.env','pm2:livekit-backend-staging'], 'capturedAt':datetime.now(timezone.utc).isoformat(),
            'values':values, 'sources':sources, 'keyGeneration':generation_label(values['SETTINGS_ENCRYPTION_KEY'])}

def agent_snapshot(required, local_values, issued):
    values,coverage={},{}
    for k in sorted(set(required)):
        if k.startswith('LIVEKIT_'): continue # LiveKit regenerates injected agent credentials.
        if local_values.get(k):
            values[k]=local_values[k]; coverage[k]='candidate_local_copy'
        else: coverage[k]='unknown'
    for k,v in issued.items():
        values[k]=v; coverage[k]='new_issued_verified'
    return {'format':1, 'kind':'agent', 'complete':all(v=='new_issued_verified' for v in coverage.values()) and bool(coverage),
            'capturedAt':datetime.now(timezone.utc).isoformat(), 'values':values,'coverage':coverage}

def may_replace(current,candidate):
    return not (current and current.get('complete') and not candidate.get('complete'))

def recovery_policies(arns):
    if not arns or any('*' in a for a in arns): raise ValueError('Exact ARNs required')
    def policy(actions): return {'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':actions,'Resource':arns}]}
    return (policy(['secretsmanager:PutSecretValue','secretsmanager:UpdateSecretVersionStage','secretsmanager:DescribeSecret']),
            policy(['secretsmanager:GetSecretValue','secretsmanager:DescribeSecret']))

def save_snapshot(sm,name,snapshot):
    """Owner bootstrap access; capture into memory, pin key generation, verify equality."""
    if name not in [PREFIX+x for x in ('backend','agent-primary','agent-stable')]: raise ValueError('Unexpected recovery name')
    current=None
    try:
        current=json.loads(sm.get_secret_value(SecretId=name)['SecretString'])
    except sm.exceptions.ResourceNotFoundException: pass
    if not may_replace(current,snapshot): raise ValueError('Incomplete candidate cannot replace complete snapshot')
    def stable(value): return {k:v for k,v in value.items() if k != 'capturedAt'}
    if current is not None and stable(current)==stable(snapshot):
        found=sm.get_secret_value(SecretId=name)
        return {'arn':found['ARN'],'versionId':found['VersionId'],'complete':snapshot['complete'],
                'keys':sorted(snapshot['values']),'keyGeneration':snapshot.get('keyGeneration'),
                'coverage':snapshot.get('coverage',{}),'retrievalEqualityVerified':True,'unchanged':True}
    payload=json.dumps(snapshot,sort_keys=True,separators=(',',':'))
    if current is None:
        try:
            sm.create_secret(Name=name,Description='Lalia operator recovery snapshot; not a runtime dependency',
                Tags=[{'Key':'Application','Value':'Lalia'},{'Key':'Purpose','Value':'disaster-recovery'}])
        except sm.exceptions.ResourceExistsException: pass
    candidate='capture-'+uuid.uuid4().hex
    result=sm.put_secret_value(SecretId=name,SecretString=payload,VersionStages=[candidate])
    version=result['VersionId']; arn=result['ARN']
    restored=json.loads(sm.get_secret_value(SecretId=arn,VersionId=version)['SecretString'])
    if restored!=snapshot: raise ValueError('Recovery snapshot equality failed; current version unchanged')
    versions=sm.describe_secret(SecretId=arn).get('VersionIdsToStages',{})
    if snapshot.get('keyGeneration'):
        label=snapshot['keyGeneration']
        if not any(label in stages for stages in versions.values()):
            sm.update_secret_version_stage(SecretId=arn,VersionStage=label,MoveToVersionId=version)
    old=next((v for v,stages in versions.items() if 'AWSCURRENT' in stages),None)
    sm.update_secret_version_stage(SecretId=arn,VersionStage='AWSCURRENT',MoveToVersionId=version,**({'RemoveFromVersionId':old} if old else {}))
    sm.update_secret_version_stage(SecretId=arn,VersionStage=candidate,RemoveFromVersionId=version)
    return {'arn':arn,'versionId':version,'complete':snapshot['complete'],'keys':sorted(snapshot['values']),
            'keyGeneration':snapshot.get('keyGeneration'),'coverage':snapshot.get('coverage',{}),'retrievalEqualityVerified':True}
