import importlib.util
import pathlib
import unittest
from datetime import datetime, timedelta, timezone
path=pathlib.Path(__file__).with_name('verify_restore.py')
module=None
if path.exists():
    spec=importlib.util.spec_from_file_location('verify_restore',path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class RestoreTransportTests(unittest.TestCase):
    def test_newest_complete_backup_uses_manifest_time_and_excludes_other_prefixes(self):
        self.assertIsNotNone(module)
        now=datetime.now(timezone.utc)
        def objects(run,age): return [{'Key':f'lalia/daily/{run}/{name}','Size':1,'LastModified':now-timedelta(hours=age)} for name in ['manifest.json','database.dump','uploads.tar.gz']]
        selected=module.select_backup(objects('older',5)+objects('newest',1)+objects('incomplete',0)[:1],now)
        self.assertEqual(selected,'lalia/daily/newest/')
        with self.assertRaises(ValueError): module.select_backup(objects('stale',27),now)
    def test_reference_rejects_extra_fields_and_wrong_secret_or_region(self):
        self.assertIsNotNone(module)
        ref={'format':1,'backend':{'secretArn':'arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-Ab123X','versionId':'12345678-1234-1234-1234-123456789012','keyGeneration':'key-generation-'+'1'*24}}
        self.assertEqual(module.recovery_reference({'recovery':ref},{}),ref)
        bad={**ref,'SECRET':'private'}
        with self.assertRaises(ValueError): module.recovery_reference({'recovery':bad},{})
        bad={'format':1,'backend':{**ref['backend'],'secretArn':ref['backend']['secretArn'].replace('us-east-2','us-east-1')}}
        with self.assertRaises(ValueError): module.recovery_reference({'recovery':bad},{})

class HistoricalKeyTests(unittest.TestCase):
    def test_missing_exact_version_uses_only_matching_pinned_generation(self):
        import hashlib,json
        self.assertTrue(hasattr(module,'retrieve_key'))
        key='synthetic-key'; generation='key-generation-'+hashlib.sha256(key.encode()).hexdigest()[:24]
        ref={'secretArn':'arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-Ab123X','versionId':'12345678-1234-1234-1234-123456789012','keyGeneration':generation}
        class Missing(Exception): pass
        class Fake:
            class exceptions: ResourceNotFoundException=Missing
            def __init__(self): self.calls=[]
            def get_secret_value(self,**args):
                self.calls.append(args)
                if 'VersionId' in args: raise Missing()
                return {'ARN':ref['secretArn'],'VersionId':'87654321-4321-4321-4321-210987654321','SecretString':json.dumps({'complete':True,'keyGeneration':generation,'values':{'SETTINGS_ENCRYPTION_KEY':key}})}
        client=Fake();actual,proof=module.retrieve_key(client,ref)
        self.assertEqual(actual,key);self.assertTrue(proof['historicalGenerationFallbackUsed']);self.assertNotEqual(proof['actualVersionId'],ref['versionId'])
        self.assertEqual(client.calls[1],{'SecretId':ref['secretArn'],'VersionStage':generation})
    def test_generation_mismatch_and_permission_errors_never_produce_key(self):
        import json
        self.assertTrue(hasattr(module,'retrieve_key'))
        ref={'secretArn':'arn:aws:secretsmanager:us-east-2:690248313257:secret:lalia/prod/recovery/backend-Ab123X','versionId':'12345678-1234-1234-1234-123456789012','keyGeneration':'key-generation-'+'1'*24}
        class Missing(Exception): pass
        class Fake:
            class exceptions: ResourceNotFoundException=Missing
            def get_secret_value(self,**args):
                if 'VersionId' in args: raise Missing()
                return {'ARN':ref['secretArn'],'VersionId':'older','SecretString':json.dumps({'complete':True,'keyGeneration':ref['keyGeneration'],'values':{'SETTINGS_ENCRYPTION_KEY':'wrong-key'}})}
        with self.assertRaises(ValueError):module.retrieve_key(Fake(),ref)
        class Denied(Fake):
            def get_secret_value(self,**args): raise PermissionError('denied')
        with self.assertRaises(PermissionError):module.retrieve_key(Denied(),ref)

if __name__=='__main__': unittest.main()
