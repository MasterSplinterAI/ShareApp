#!/usr/bin/env python3
"""Create narrow log writers; preserve new key only in encrypted recovery store."""
import json,sys
from pathlib import Path
import boto3
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'operations-recovery'))
from recovery import ACCOUNT,REGION,PREFIX,save_snapshot
AGENTS=[('primary','CA_do6qoLXhxqA7'),('stable','CA_gKYczmp9DCNy')]
def validate_stored_key(iam,user,key_id):
    keys=iam.list_access_keys(UserName=user)['AccessKeyMetadata']
    if not any(k['AccessKeyId']==key_id and k['Status']=='Active' for k in keys):
        raise ValueError('Stored log key is not active for the intended writer; operator recovery required')

def remove_unstored_key(iam,sm,user,name,key_id):
    # A failed label cleanup may occur after AWSCURRENT promotion. Never delete
    # a durably stored key; uncertainty also leaves it intact for operator review.
    try:
        stored=json.loads(sm.get_secret_value(SecretId=name)['SecretString'])
    except sm.exceptions.ResourceNotFoundException:
        stored={}
    except Exception:
        return
    if stored.get('values',{}).get('AWS_ACCESS_KEY_ID') != key_id:
        iam.delete_access_key(UserName=user,AccessKeyId=key_id)
def writer_policy(agent):
    group=f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:{agent}'
    return {'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':['logs:CreateLogGroup'],'Resource':group},
        {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':group+':log-stream:*'}]}
def main():
    session=boto3.Session(profile_name='jarmetals',region_name=REGION)
    if session.client('sts').get_caller_identity()['Account']!=ACCOUNT: raise RuntimeError('Wrong account')
    iam,logs,sm=[session.client(x) for x in ['iam','logs','secretsmanager']]
    evidence=[]
    for label,agent in AGENTS:
        user='lalia-'+label+'-agent-log-writer'
        try: logs.create_log_group(logGroupName=agent,tags={'Application':'Lalia','Purpose':'sanitized-agent-logs'})
        except logs.exceptions.ResourceAlreadyExistsException: pass
        logs.put_retention_policy(logGroupName=agent,retentionInDays=30)
        try: iam.create_user(UserName=user,Tags=[{'Key':'Application','Value':'Lalia'},{'Key':'Purpose','Value':'sanitized-agent-logs'}])
        except iam.exceptions.EntityAlreadyExistsException: pass
        policy=writer_policy(agent)
        iam.put_user_policy(UserName=user,PolicyName='WriteOnlyOwnAgentLogs',PolicyDocument=json.dumps(policy))
        name=PREFIX+'agent-'+label
        snapshot=json.loads(sm.get_secret_value(SecretId=name)['SecretString'])
        if not snapshot['values'].get('AWS_ACCESS_KEY_ID'):
            key=iam.create_access_key(UserName=user)['AccessKey']
            try:
                snapshot['values'].update(AWS_ACCESS_KEY_ID=key['AccessKeyId'],AWS_SECRET_ACCESS_KEY=key['SecretAccessKey'],AWS_REGION=REGION)
                snapshot['coverage'].update({x:'new_issued_pending_delivery' for x in ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_REGION']})
                stored=save_snapshot(sm,name,snapshot)
            except Exception:
                remove_unstored_key(iam,sm,user,name,key['AccessKeyId']); raise
        else:
            validate_stored_key(iam,user,snapshot['values']['AWS_ACCESS_KEY_ID'])
            stored={'versionId':sm.get_secret_value(SecretId=name)['VersionId'],'reusedStoredKey':True}
        evidence.append({'agentId':agent,'logGroup':agent,'retentionDays':30,'userName':user,'policy':policy,'recoveryVersionId':stored['versionId'],'injectedIntoLiveKit':False})
    Path('docs/launch/evidence/2026-11-12-agent-log-drains.json').write_text(json.dumps({'provisioned':evidence},indent=2)+'\n')
    print(json.dumps({'groups':len(evidence),'retentionDays':30,'credentialsStoredEncrypted':True,'liveKitChanged':False}))
if __name__=='__main__':
    try: main()
    except Exception as e:
        print('Log provisioning failed: '+type(e).__name__+'; private outputs withheld',file=sys.stderr);sys.exit(1)
