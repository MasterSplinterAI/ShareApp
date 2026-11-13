#!/usr/bin/env python3
"""Read approved agent streams privately; write only aggregate acceptance evidence."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import boto3
from provision import AGENTS, ACCOUNT, REGION

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'livekit-app/translation-agent'))
from private_logging import _valid_wire_data

def safe_message(message):
    if 'SENTINEL' in message:
        return False, None
    try:
        record=json.loads(message)
    except (ValueError, TypeError):
        return bool(re.fullmatch(r"Lalia agent startup: module=(transcription_only_agent|transcription_codeswitch_agent) build_ref='[a-f0-9]{7,40}'\s*",message)), None
    try: safe=_valid_wire_data(record)
    except (TypeError,ValueError): safe=False
    return safe,record if safe else None

def matching_rollout_worker(summary,build):
    return summary['eventCount']>0 and summary['sourceBuilds']==[build]

def verify(label, build, since, require_session=False):
    if not re.fullmatch('[a-f0-9]{40}',build): raise ValueError('Full reviewed commit required')
    started=datetime.fromisoformat(since.replace('Z','+00:00'))
    if started.tzinfo is None: raise ValueError('Explicit UTC offset required')
    since_ms=int(started.timestamp()*1000)
    session=boto3.Session(profile_name='jarmetals',region_name=REGION)
    assert session.client('sts').get_caller_identity()['Account']==ACCOUNT
    logs=session.client('logs'); agent=dict(AGENTS)[label]
    streams=[item for page in logs.get_paginator('describe_log_streams').paginate(logGroupName=agent) for item in page['logStreams']]
    summaries=[]; events_seen=set(); invalid=0
    for stream in streams:
        args={'logGroupName':agent,'logStreamName':stream['logStreamName'],'startFromHead':True,'startTime':since_ms}
        count=0; kinds=set(); builds=set()
        while True:
            response=logs.get_log_events(**args)
            for event in response['events']:
                count+=1; safe,record=safe_message(event['message'])
                invalid+=not safe
                if record:
                    kinds.add(record['message'])
                    if record.get('build_ref'): builds.add(record['build_ref'])
            if response['nextForwardToken']==args.get('nextToken'):break
            args['nextToken']=response['nextForwardToken']
        summary={'workerStream':stream['logStreamName'],'eventCount':count,'firstEventTimestamp':stream.get('firstEventTimestamp'),'lastEventTimestamp':stream.get('lastEventTimestamp'),'sourceBuilds':sorted(builds),'eventKinds':sorted(kinds)}
        if matching_rollout_worker(summary,build):events_seen|=kinds
        summaries.append(summary)
    needed={'worker_started','privacy_controlled_error','sdk_worker_registered'}
    if require_session: needed|={'session_started','session_stopped','sdk_job_requested'}
    result={'verifiedAt':datetime.now(timezone.utc).isoformat(),'agentId':agent,'reviewedBuild':build,'rolloutSince':since,'workerStreams':summaries,'matchingRolloutWorkers':sum(matching_rollout_worker(x,build) for x in summaries),'unexpectedOrSentinelMessages':invalid,'requiredEventsPresent':needed<=events_seen,'requiredEvents':sorted(needed)}
    result['passed']=result['matchingRolloutWorkers']>=2 and invalid==0 and result['requiredEventsPresent']
    file=ROOT/'docs/launch/evidence/2026-11-12-agent-log-drains.json'
    data=json.loads(file.read_text());data.setdefault('delivery',{})[label]=result
    file.write_text(json.dumps(data,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k!='workerStreams'}))
    if not result['passed']:sys.exit(2)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('profile',choices=[x[0] for x in AGENTS]);parser.add_argument('--build',required=True);parser.add_argument('--since',required=True);parser.add_argument('--require-session',action='store_true');args=parser.parse_args()
    try:verify(args.profile,args.build,args.since,args.require_session)
    except Exception as error:
        print('Private log verification failed: '+type(error).__name__+'; details withheld',file=sys.stderr);sys.exit(1)
