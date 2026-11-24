import unittest
from recovery import backend_snapshot, agent_snapshot, may_replace, generation_label, recovery_policies

class RecoveryTests(unittest.TestCase):
    def test_effective_values_and_missing_key(self):
        s = backend_snapshot({'SETTINGS_ENCRYPTION_KEY':'synthetic-key','FRONTEND_URL':'old'}, {'FRONTEND_URL':'new','PATH':'exclude'})
        self.assertEqual(s['values']['FRONTEND_URL'], 'new')
        self.assertNotIn('PATH', s['values'])
        extra=backend_snapshot({'SETTINGS_ENCRYPTION_KEY':'synthetic'}, {'COST_EVENT_SECRET':'synthetic-cost'}, ['COST_EVENT_SECRET'])
        self.assertEqual(extra['values']['COST_EVENT_SECRET'],'synthetic-cost')
        self.assertFalse(s['complete'])
        self.assertEqual(s['coverage']['DATABASE_URL'],'missing')
        with self.assertRaises(ValueError): backend_snapshot({}, {})
    def test_unknown_and_candidate_are_not_complete(self):
        s = agent_snapshot(['OPENAI_API_KEY','AGENT_MODULE'], {'OPENAI_API_KEY':'synthetic'}, {})
        self.assertFalse(s['complete'])
        self.assertEqual(s['coverage']['OPENAI_API_KEY'], 'candidate_local_copy')
        self.assertEqual(s['coverage']['AGENT_MODULE'], 'unknown')
        self.assertNotIn('AGENT_MODULE', s['values'])
    def test_new_writer_qualified_without_upgrading_other_fields(self):
        s = agent_snapshot(['OPENAI_API_KEY'], {'OPENAI_API_KEY':'synthetic'}, {'AWS_REGION':'us-east-2'})
        self.assertEqual(s['coverage']['AWS_REGION'], 'new_issued_verified')
        self.assertFalse(s['complete'])
    def test_no_incomplete_overwrite(self):
        self.assertFalse(may_replace({'complete':True}, {'complete':False}))
        self.assertTrue(may_replace({'complete':False}, {'complete':True}))
        self.assertTrue(may_replace(None, {'complete':False}))
    def test_historical_generation_stable_without_key_disclosure(self):
        self.assertEqual(generation_label('synthetic-key'), generation_label('synthetic-key'))
        self.assertNotIn('synthetic-key', generation_label('synthetic-key'))
    def test_distinct_scoped_permission_sets(self):
        writer,reader = recovery_policies(['arn:aws:secretsmanager:us-east-2:690248313257:secret:one-abc'])
        self.assertNotIn('secretsmanager:GetSecretValue',writer['Statement'][0]['Action'])
        self.assertEqual(reader['Statement'][0]['Action'],['secretsmanager:GetSecretValue','secretsmanager:DescribeSecret'])
        self.assertNotIn('*',str(reader['Statement'][0]['Resource']))
if __name__=='__main__': unittest.main()

class SaveTests(unittest.TestCase):
    def fake(self,current,snapshot,bad=False):
        from unittest.mock import Mock
        import json
        sm=Mock()
        sm.exceptions.ResourceNotFoundException=type('Missing',(Exception,),{})
        sm.exceptions.ResourceExistsException=type('Exists',(Exception,),{})
        sm.get_secret_value.side_effect=[{'SecretString':json.dumps(current)}, {'SecretString':json.dumps({'bad':True} if bad else snapshot)}]
        sm.put_secret_value.return_value={'VersionId':'new','ARN':'arn:synthetic'}
        sm.describe_secret.return_value={'VersionIdsToStages':{'old':['AWSCURRENT','key-generation-existing']}}
        return sm
    def test_verify_before_promoting_and_keep_historical_label(self):
        from recovery import save_snapshot,PREFIX
        s={'complete':True,'values':{'x':'synthetic'},'keyGeneration':'key-generation-existing'}
        sm=self.fake({'complete':True,'values':{'x':'old'}},s)
        save_snapshot(sm,PREFIX+'backend',s)
        calls=sm.update_secret_version_stage.call_args_list
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0].kwargs['VersionStage'],'AWSCURRENT')
        self.assertFalse(any(c.kwargs['VersionStage']=='key-generation-existing' for c in calls))
    def test_failed_candidate_never_promoted(self):
        from recovery import save_snapshot,PREFIX
        s={'complete':True,'values':{'x':'synthetic'}}
        sm=self.fake({'complete':True,'values':{'x':'old'}},s,bad=True)
        with self.assertRaises(ValueError): save_snapshot(sm,PREFIX+'backend',s)
        sm.update_secret_version_stage.assert_not_called()
    def test_unchanged_capture_does_not_write_new_version(self):
        from recovery import save_snapshot,PREFIX
        import json
        s={'complete':True,'values':{'x':'synthetic'},'capturedAt':'new'}
        old={**s,'capturedAt':'old'}
        sm=self.fake(old,s)
        sm.get_secret_value.side_effect=[{'SecretString':json.dumps(old)}, {'SecretString':json.dumps(old),'ARN':'arn:synthetic','VersionId':'old'}]
        result=save_snapshot(sm,PREFIX+'backend',s)
        self.assertTrue(result['unchanged']);sm.put_secret_value.assert_not_called()
