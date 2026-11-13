import importlib.util
import json
import pathlib
import unittest

path = pathlib.Path(__file__).with_name('deploy.py')
if path.exists():
    spec = importlib.util.spec_from_file_location('deploy', path)
    deploy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(deploy)
else:
    deploy = None

class DeploymentTests(unittest.TestCase):
    def config(self):
        self.assertIsNotNone(deploy, 'deployment implementation is missing')
        return deploy.configuration()

    def test_runtime_has_only_prefix_list_namespace_metric_and_own_logs(self):
        c = self.config()
        statements = c['runtime_policy']['Statement']
        self.assertEqual(len(statements), 3)
        self.assertEqual(statements[0]['Action'], ['s3:ListBucket'])
        self.assertEqual(statements[0]['Resource'], 'arn:aws:s3:::lalia-backups-690248313257-us-east-2')
        self.assertEqual(statements[0]['Condition'], {'StringEquals': {'s3:prefix': 'lalia/daily/'}})
        self.assertEqual(statements[1]['Condition'], {'StringEquals': {'cloudwatch:namespace': 'Lalia/Operations'}})
        self.assertEqual(statements[2]['Resource'], 'arn:aws:logs:us-east-2:690248313257:log-group:/aws/lambda/lalia-operations-monitor:log-stream:*')
        self.assertNotIn('GetObject', json.dumps(c))
        self.assertNotIn('secretsmanager', json.dumps(c))

    def test_all_alarms_require_two_of_three_and_missing_data_breaches(self):
        c = self.config()
        self.assertEqual(len(c['alarms']), 3)
        for alarm in c['alarms']:
            self.assertEqual((alarm['Period'], alarm['EvaluationPeriods'], alarm['DatapointsToAlarm']), (300, 3, 2))
            self.assertEqual(alarm['TreatMissingData'], 'breaching')
            self.assertEqual(alarm['AlarmActions'], alarm['OKActions'])
            self.assertEqual(alarm['Dimensions'], [{'Name': 'Service', 'Value': 'lalia-production'}])
            self.assertEqual(alarm['ComparisonOperator'], 'LessThanThreshold')
            self.assertIn('README.md', alarm['AlarmDescription'])
        allowed = c['sns_policy']['Statement'][0]['Condition']
        self.assertEqual(allowed['StringEquals']['aws:SourceAccount'], '690248313257')
        self.assertEqual(len(allowed['ArnEquals']['aws:SourceArn']), 3)

    def test_function_and_scheduler_are_separate_and_bounded(self):
        c = self.config()
        self.assertEqual(c['lambda']['Timeout'], 30)
        self.assertEqual(c['lambda']['Runtime'], 'nodejs24.x')
        self.assertEqual(c['lambda']['VpcConfig'], {'SubnetIds': [], 'SecurityGroupIds': []})
        self.assertEqual(c['schedule']['ScheduleExpression'], 'rate(5 minutes)')
        self.assertEqual(c['scheduler_policy']['Statement'][0]['Resource'], c['function_arn'])
        trust = c['scheduler_trust']['Statement'][0]['Condition']['StringEquals']
        self.assertEqual(trust['aws:SourceArn'], 'arn:aws:scheduler:us-east-2:690248313257:schedule-group/lalia-operations')

if __name__ == '__main__': unittest.main()
