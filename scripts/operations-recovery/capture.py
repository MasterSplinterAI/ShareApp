#!/usr/bin/env python3
"""Owner-run capture: subprocess output stays in memory; only metadata is printed."""
import argparse,json,subprocess,sys,re
from pathlib import Path
import boto3
from recovery import ACCOUNT,REGION,PREFIX,backend_snapshot,agent_snapshot,save_snapshot,recovery_policies
SSH=['ssh','-i','/Users/rhule/Downloads/AxisAlgo.pem','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes','ubuntu@3.16.210.84']
CAPTURE_JS=r'''
const fs=require('node:fs');const {createRequire}=require('node:module');const {execFileSync}=require('node:child_process');
const r=createRequire('/var/www/share-app-staging/livekit-app/backend/package.json');
const file=r('dotenv').parse(fs.readFileSync('/var/www/share-app-staging/livekit-app/backend/.env'));
const matches=JSON.parse(execFileSync('pm2',['jlist'],{encoding:'utf8',maxBuffer:8*1024*1024})).filter(p=>p.name==='livekit-backend-staging');
if(matches.length!==1||matches[0].pm2_env.status!=='online')throw Error('Expected one online backend');
const p=matches[0].pm2_env;const effective={};for(const k of new Set([...Object.keys(file),...__APPLICATION_KEYS__])){if(typeof p[k]==='string')effective[k]=p[k];else if(typeof p.env?.[k]==='string')effective[k]=p.env[k];}
process.stdout.write(JSON.stringify({file,effective}));
'''
def process_json(args,input=None,cwd=None):
    r=subprocess.run(args,input=input,text=True,capture_output=True,cwd=cwd,timeout=60)
    if r.returncode: raise RuntimeError('Private command failed; output withheld')
    return json.loads(r.stdout)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--evidence',required=True);a=ap.parse_args()
    session=boto3.Session(profile_name='jarmetals',region_name=REGION)
    if session.client('sts').get_caller_identity()['Account']!=ACCOUNT: raise RuntimeError('Wrong account')
    sm=session.client('secretsmanager');iam=session.client('iam')
    repo=Path(__file__).resolve().parents[2]
    app_keys=set()
    for f in (repo/'livekit-app/backend').rglob('*.js'):
        if 'node_modules' not in f.parts and 'test' not in f.parts:
            source=f.read_text()
            app_keys.update(re.findall(r'process\.env\.([A-Z_0-9]+)',source))
            app_keys.update(re.findall(r'''\benv[A-Za-z]*\(['"]([A-Z_0-9]+)['"]''',source))
    revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
    raw=process_json(SSH+['node','-'],CAPTURE_JS.replace('__APPLICATION_KEYS__',json.dumps(sorted(app_keys))))
    results={'backend':save_snapshot(sm,PREFIX+'backend',backend_snapshot(raw['file'],raw['effective'],app_keys,revision))}
    js="const fs=require('fs');const d=require(process.argv[1]);process.stdout.write(JSON.stringify(d.parse(fs.readFileSync(process.argv[2]))))"
    local=process_json(['node','-e',js,str(repo.parent/'share-app/livekit-app/backend/node_modules/dotenv'),str(repo.parent/'share-app/livekit-app/translation-agent/.env')])
    for label,agent in [('agent-primary','CA_do6qoLXhxqA7'),('agent-stable','CA_gKYczmp9DCNy')]:
        inv=process_json(['/tmp/lalia-lk-2.19.4/lk','--project','production','agent','secrets','--id',agent,'--json'],cwd=str(repo/'livekit-app/translation-agent'))
        if isinstance(inv,dict): inv=inv.get('secrets',[])
        if not isinstance(inv,list) or not inv: raise RuntimeError('Unexpected secret inventory')
        names=[x if isinstance(x,str) else x.get('name',x.get('Name')) for x in inv]
        if any(not isinstance(n,str) for n in names): raise RuntimeError('Unexpected secret names')
        names=sorted(set(names)|{'BACKEND_BASE_URL','COST_EVENT_SECRET','AGENT_MODULE','AGENT_NAME','OPENAI_API_KEY','STT_PROVIDER','LLM_PROVIDER'})
        issued={}
        try:
            prior=json.loads(sm.get_secret_value(SecretId=PREFIX+label)['SecretString'])
            issued={k:prior['values'][k] for k,v in prior.get('coverage',{}).items() if v.startswith('new_issued_')}
        except sm.exceptions.ResourceNotFoundException: pass
        snapshot=agent_snapshot(names,local,issued)
        if issued:
            snapshot['coverage'].update({k:prior['coverage'][k] for k in issued})
        snapshot.update(agentId=agent,sourceQualification='Local provider values are candidates, not verified cloud export')
        results[label]=save_snapshot(sm,PREFIX+label,snapshot)
    for name,policy in zip(['LaliaRecoverySnapshotWriter','LaliaRecoverySnapshotReader'],recovery_policies([x['arn'] for x in results.values()])):
        arn=f'arn:aws:iam::{ACCOUNT}:policy/{name}'
        try: iam.create_policy(PolicyName=name,PolicyDocument=json.dumps(policy),Description='Exact-record Lalia recovery permissions; operator assignment only')
        except iam.exceptions.EntityAlreadyExistsException:
            existing=iam.get_policy(PolicyArn=arn)['Policy']
            doc=iam.get_policy_version(PolicyArn=arn,VersionId=existing['DefaultVersionId'])['PolicyVersion']['Document']
            if doc!=policy: raise RuntimeError('Existing recovery policy differs')
        results[name]={'arn':arn,'policy':policy,'attachedToServiceRoles':False}
    out={'account':ACCOUNT,'region':REGION,'snapshots':results,'plaintextLocalFilesCreated':False,'providerKeysRotated':False}
    Path(a.evidence).write_text(json.dumps(out,indent=2)+'\n')
    print(json.dumps({'captured':list(results),'backendEqualityVerified':True,'agentCoverage':'candidate/unknown; not complete'}))
if __name__=='__main__':
    try: main()
    except Exception as e:
        print('Recovery capture failed: '+type(e).__name__+'; private outputs withheld',file=sys.stderr);sys.exit(1)
