#!/usr/bin/env python3
"""Render an offline review plan by default; --apply installs only these resources."""
import argparse
import io
import json
from pathlib import Path
import time
import zipfile

ACCOUNT = '690248313257'
REGION = 'us-east-2'
NAME = 'lalia-operations-monitor'
TOPIC = 'lalia-operations-alerts'
GROUP = 'lalia-operations'
RECIPIENT = 'kennyrhule@proton.me'
RUNBOOK = 'https://github.com/MasterSplinterAI/ShareApp/blob/codex/launch-readiness/scripts/operations-monitor/README.md'

def policy(*statements):
    return {'Version': '2012-10-17', 'Statement': list(statements)}

def allow(actions, resource, **extra):
    return {'Effect': 'Allow', 'Action': actions, 'Resource': resource, **extra}

def trust(service, condition=None):
    statement = {'Effect': 'Allow', 'Principal': {'Service': service}, 'Action': 'sts:AssumeRole'}
    if condition:
        statement['Condition'] = condition
    return policy(statement)

def configuration():
    function = f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{NAME}'
    topic = f'arn:aws:sns:{REGION}:{ACCOUNT}:{TOPIC}'
    runtime_role = f'arn:aws:iam::{ACCOUNT}:role/{NAME}-runtime'
    scheduler_role = f'arn:aws:iam::{ACCOUNT}:role/{NAME}-scheduler'
    alarms = []
    descriptions = {
        'ApiHealthy': 'Process health JSON invalid/unavailable; this does not test PostgreSQL or RTC.',
        'BackupFresh': 'No exact complete nonempty backup within 26 hours; inspect safe backupAgeHours log field. This does not prove restorability.',
        'MonitorHeartbeat': 'Monitoring metrics missing or failing; inspect Lambda/Scheduler and permissions.',
    }
    for metric, description in descriptions.items():
        alarms.append({'AlarmName': f'{NAME}-{metric}', 'AlarmDescription': f'{metric}: {description} State/status and evaluation timestamps are in this notification. Runbook: {RUNBOOK}', 'Namespace': 'Lalia/Operations', 'MetricName': metric, 'Dimensions': [{'Name': 'Service', 'Value': 'lalia-production'}], 'Statistic': 'Minimum', 'Unit': 'Count', 'Period': 300, 'EvaluationPeriods': 3, 'DatapointsToAlarm': 2, 'Threshold': 1, 'ComparisonOperator': 'LessThanThreshold', 'TreatMissingData': 'breaching', 'ActionsEnabled': True, 'AlarmActions': [topic], 'OKActions': [topic]})
    return {
        'account': ACCOUNT, 'region': REGION, 'recipient': RECIPIENT, 'function_arn': function, 'topic_arn': topic,
        'runtime_trust': trust('lambda.amazonaws.com'),
        'runtime_policy': policy(
            allow(['s3:ListBucket'], 'arn:aws:s3:::lalia-backups-690248313257-us-east-2', Condition={'StringEquals': {'s3:prefix': 'lalia/daily/'}}),
            allow(['cloudwatch:PutMetricData'], '*', Condition={'StringEquals': {'cloudwatch:namespace': 'Lalia/Operations'}}),
            allow(['logs:CreateLogStream', 'logs:PutLogEvents'], f'arn:aws:logs:{REGION}:{ACCOUNT}:log-group:/aws/lambda/{NAME}:log-stream:*')),
        'scheduler_trust': trust('scheduler.amazonaws.com', {'StringEquals': {'aws:SourceAccount': ACCOUNT, 'aws:SourceArn': f'arn:aws:scheduler:{REGION}:{ACCOUNT}:schedule-group/{GROUP}'}}),
        'scheduler_policy': policy(allow(['lambda:InvokeFunction'], function)),
        'sns_policy': policy(allow('sns:Publish', topic, Principal={'Service': 'cloudwatch.amazonaws.com'}, Condition={'StringEquals': {'aws:SourceAccount': ACCOUNT}, 'ArnEquals': {'aws:SourceArn': [f'arn:aws:cloudwatch:{REGION}:{ACCOUNT}:alarm:{alarm["AlarmName"]}' for alarm in alarms]}})),
        'lambda': {'FunctionName': NAME, 'Runtime': 'nodejs24.x', 'Role': runtime_role, 'Handler': 'monitor.handler', 'Timeout': 30, 'MemorySize': 128, 'Architectures': ['arm64'], 'VpcConfig': {'SubnetIds': [], 'SecurityGroupIds': []}, 'Description': 'Independent process health and metadata-only backup freshness checks'},
        'reserved_concurrency': 1, 'log_retention_days': 14,
        'schedule': {'Name': NAME, 'GroupName': GROUP, 'ScheduleExpression': 'rate(5 minutes)', 'ScheduleExpressionTimezone': 'UTC', 'FlexibleTimeWindow': {'Mode': 'OFF'}, 'State': 'ENABLED', 'Target': {'Arn': function, 'RoleArn': scheduler_role, 'Input': '{}', 'RetryPolicy': {'MaximumEventAgeInSeconds': 60, 'MaximumRetryAttempts': 0}}},
        'alarms': alarms,
    }

def apply(session, c):
    from botocore.exceptions import ClientError
    if session.region_name != REGION or session.client('sts').get_caller_identity()['Account'] != ACCOUNT:
        raise RuntimeError('Refusing unexpected AWS account/region')
    iam, logs, sns, lam, scheduler, cw = [session.client(name) for name in ['iam', 'logs', 'sns', 'lambda', 'scheduler', 'cloudwatch']]
    tags = {'Application': 'lalia', 'Purpose': 'operations-monitor'}
    # Precreate the group so runtime cannot create arbitrary groups or retention.
    try:
        logs.create_log_group(logGroupName=f'/aws/lambda/{NAME}', tags=tags)
    except logs.exceptions.ResourceAlreadyExistsException:
        pass
    logs.put_retention_policy(logGroupName=f'/aws/lambda/{NAME}', retentionInDays=c['log_retention_days'])
    for suffix in ['runtime', 'scheduler']:
        role_name = f'{NAME}-{suffix}'
        document = json.dumps(c[f'{suffix}_trust'])
        try:
            iam.create_role(RoleName=role_name, AssumeRolePolicyDocument=document, Tags=[{'Key': k, 'Value': v} for k, v in tags.items()])
        except iam.exceptions.EntityAlreadyExistsException:
            iam.update_assume_role_policy(RoleName=role_name, PolicyDocument=document)
        iam.put_role_policy(RoleName=role_name, PolicyName=NAME, PolicyDocument=json.dumps(c[f'{suffix}_policy']))
    topic = sns.create_topic(Name=TOPIC, Tags=[{'Key': k, 'Value': v} for k, v in tags.items()])['TopicArn']
    if topic != c['topic_arn']:
        raise RuntimeError('Unexpected SNS topic')
    sns.set_topic_attributes(TopicArn=topic, AttributeName='Policy', AttributeValue=json.dumps(c['sns_policy']))
    subscriptions = [item for page in sns.get_paginator('list_subscriptions_by_topic').paginate(TopicArn=topic) for item in page['Subscriptions']]
    subscription = next((s for s in subscriptions if s['Protocol'] == 'email' and s['Endpoint'] == RECIPIENT), None)
    if not subscription:
        sns.subscribe(TopicArn=topic, Protocol='email', Endpoint=RECIPIENT, ReturnSubscriptionArn=True)
    data = io.BytesIO()
    with zipfile.ZipFile(data, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.write(Path(__file__).with_name('monitor.mjs'), 'monitor.mjs')
    try:
        lam.get_function(FunctionName=NAME)
        exists = True
    except lam.exceptions.ResourceNotFoundException:
        exists = False
    # IAM role propagation is eventually consistent; retry only that known error.
    for attempt in range(12):
        try:
            if exists:
                lam.update_function_configuration(**{k: v for k, v in c['lambda'].items() if k != 'Architectures'})
                lam.get_waiter('function_updated_v2').wait(FunctionName=NAME)
                lam.update_function_code(FunctionName=NAME, ZipFile=data.getvalue(), Architectures=c['lambda']['Architectures'])
                lam.get_waiter('function_updated_v2').wait(FunctionName=NAME)
            else:
                lam.create_function(**c['lambda'], Code={'ZipFile': data.getvalue()}, Tags=tags)
                lam.get_waiter('function_active_v2').wait(FunctionName=NAME)
            break
        except ClientError as error:
            if error.response['Error']['Code'] != 'InvalidParameterValueException' or 'cannot be assumed' not in error.response['Error']['Message'] or attempt == 11:
                raise
            time.sleep(5)
    lam.put_function_concurrency(FunctionName=NAME, ReservedConcurrentExecutions=1)
    # Invoke before enabling scheduling/alarms. Failure stops setup for inspection.
    result = lam.invoke(FunctionName=NAME, InvocationType='RequestResponse', Payload=b'{}')
    payload = json.loads(result['Payload'].read())
    if result.get('FunctionError') or payload.get('MonitorHeartbeat') is not True:
        raise RuntimeError('Monitor invocation failed; inspect its sanitized CloudWatch logs')
    for alarm in c['alarms']:
        cw.put_metric_alarm(**alarm)
    try:
        scheduler.create_schedule_group(Name=GROUP, Tags=[{'Key': k, 'Value': v} for k, v in tags.items()])
    except scheduler.exceptions.ConflictException:
        pass
    try:
        scheduler.get_schedule(Name=NAME, GroupName=GROUP)
        scheduler.update_schedule(**c['schedule'])
    except scheduler.exceptions.ResourceNotFoundException:
        scheduler.create_schedule(**c['schedule'])
    subscriptions = [item for page in sns.get_paginator('list_subscriptions_by_topic').paginate(TopicArn=topic) for item in page['Subscriptions']]
    confirmed = any(s['Protocol'] == 'email' and s['Endpoint'] == RECIPIENT and s['SubscriptionArn'] != 'PendingConfirmation' for s in subscriptions)
    return {'function_arn': c['function_arn'], 'topic_arn': topic, 'initial_probe': payload, 'email_subscription_confirmed': confirmed, 'email_delivery_verified': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--profile', default='jarmetals')
    args = parser.parse_args()
    c = configuration()
    if not args.apply:
        print(json.dumps(c, indent=2))
        return
    import boto3
    result = apply(boto3.Session(profile_name=args.profile, region_name=REGION), c)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
