import unittest
from enable import verify_status, secret_lines
from provision import writer_policy

class DrainSafetyTests(unittest.TestCase):
    def status(self, version='reviewed', state='Running'):
        return {'agents':[{'agentId':'primary','version':'reviewed','agentDeployments':[{'version':version,'status':state}]}]}
    def test_requires_promoted_and_all_running_reviewed(self):
        verify_status(self.status(), 'primary', 'reviewed')
        for value in [self.status('old'), self.status(state='Scheduling'), {'agents':[]}]:
            with self.assertRaises(ValueError): verify_status(value,'primary','reviewed')
        named = self.status(); named['agents'][0]['agentDeployments'][0]['deployment']='launch-privacy'
        with self.assertRaises(ValueError): verify_status(named,'primary','reviewed')
    def test_exports_only_exact_fields(self):
        values={'AWS_ACCESS_KEY_ID':'synthetic','AWS_SECRET_ACCESS_KEY':'synthetic','AWS_REGION':'us-east-2','PROVIDER_SECRET':'never-export'}
        self.assertNotIn('PROVIDER',secret_lines(values))
        values['AWS_SECRET_ACCESS_KEY']='injected\nUNEXPECTED=value'
        with self.assertRaises(ValueError): secret_lines(values)
    def test_writer_scope(self):
        policy=writer_policy('CA_synthetic')['Statement']
        self.assertEqual(policy[0]['Action'],['logs:CreateLogGroup'])
        self.assertEqual(policy[1]['Action'],['logs:CreateLogStream','logs:PutLogEvents'])
        self.assertTrue(policy[1]['Resource'].endswith(':CA_synthetic:log-stream:*'))
        self.assertNotIn('secretsmanager',str(policy))
    def test_delivery_verification_rejects_raw_and_extra_content(self):
        import json
        from verify import safe_message
        record={'message':'worker_started','level':'INFO','pid':1,'timestamp':123.0,'worker_instance':'a'*32}
        self.assertTrue(safe_message(json.dumps(record))[0])
        for bad in ['SPEECH_SENTINEL', 'raw provider body', json.dumps({**record,'body':'private'}), json.dumps({**record,'message':'unreviewed'}),json.dumps({**record,'worker_instance':'participant@example.invalid'}),json.dumps({**record,'pid':True}),json.dumps({**record,'timestamp':float('nan')}),json.dumps({'message':'worker_started'})]:
            self.assertFalse(safe_message(bad)[0])
        self.assertTrue(safe_message("Lalia agent startup: module=transcription_only_agent build_ref='947b932'\n")[0])
        self.assertFalse(safe_message("Lalia agent startup: module=transcription_only_agent build_ref='secret'\n")[0])
    def test_old_or_mixed_build_cannot_satisfy_rollout(self):
        from verify import matching_rollout_worker
        self.assertTrue(matching_rollout_worker({'eventCount':2,'sourceBuilds':['reviewed']},'reviewed'))
        for builds in [[],['old'],['old','reviewed']]:
            self.assertFalse(matching_rollout_worker({'eventCount':2,'sourceBuilds':builds},'reviewed'))
    def test_preserves_key_after_durable_save_even_if_cleanup_failed(self):
        import json
        from unittest.mock import Mock
        from provision import remove_unstored_key,validate_stored_key
        iam,sm=Mock(),Mock()
        sm.exceptions.ResourceNotFoundException=type('Missing',(Exception,),{})
        sm.get_secret_value.return_value={'SecretString':json.dumps({'values':{'AWS_ACCESS_KEY_ID':'synthetic'}})}
        remove_unstored_key(iam,sm,'writer','name','synthetic');iam.delete_access_key.assert_not_called()
        sm.get_secret_value.side_effect=RuntimeError('uncertain')
        remove_unstored_key(iam,sm,'writer','name','synthetic');iam.delete_access_key.assert_not_called()
        iam.list_access_keys.return_value={'AccessKeyMetadata':[{'AccessKeyId':'synthetic','Status':'Inactive'}]}
        with self.assertRaises(ValueError):validate_stored_key(iam,'writer','synthetic')
        iam.list_access_keys.return_value={'AccessKeyMetadata':[{'AccessKeyId':'synthetic','Status':'Active'}]}
        validate_stored_key(iam,'writer','synthetic')

if __name__=='__main__': unittest.main()
