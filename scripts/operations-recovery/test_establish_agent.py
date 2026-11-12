import copy
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.find_spec('establish_agent')
if spec:
    import establish_agent as e
else:
    e = None


def retained(profile='stable'):
    cfg = e.PROFILES[profile]
    values = {'AWS_ACCESS_KEY_ID': 'issued-id', 'AWS_SECRET_ACCESS_KEY': 'issued-secret',
              'AWS_REGION': 'us-east-2', 'AGENT_MODULE': cfg['module'], 'AGENT_NAME': cfg['name'],
              'AGENT_BUILD_REF': e.SOURCE_REVISION, 'LALIA_LOG_PRIVACY_PROBE': '0',
              'DEEPGRAM_API_KEY': 'deepgram', 'OPENAI_API_KEY': 'openai',
              'STT_PROVIDER': 'deepgram', 'LLM_PROVIDER': 'openai',
              'CAPTION_UTTERANCE_END_DELAY_SEC': '1.0'}
    if profile == 'primary':
        values.update(XAI_API_KEY='xai', ELEVENLABS_API_KEY='eleven', BACKEND_BASE_URL='old',
                      COST_EVENT_SECRET='old-cost', LOG_LEVEL='DEBUG', XAI_STT_ENDPOINTING_MS='20')
    return {'kind': 'agent', 'agentId': cfg['id'], 'complete': False, 'values': values,
            'coverage': {k: 'new_issued_verified' if k in e.PRESERVED else 'candidate_local_copy' for k in values}}


def baseline(profile='stable'):
    names = list(retained(profile)['values'])
    return names + (['TTS_ENABLED', 'TTS_PROVIDER'] if profile == 'primary' else [])


def backend():
    return {'kind': 'backend', 'complete': True, 'values': {'COST_EVENT_SECRET': 'verified-cost'},
            'coverage': {'COST_EVENT_SECRET': 'verified_effective'}}


def pending(profile='stable'):
    return e.build_pending(profile, baseline(profile), retained(profile), backend())


def running(profile='stable'):
    p = e.PROFILES[profile]
    return {'agents': [{'agentId': p['id'], 'agentName': p['name'], 'version': p['version'],
                        'agentDeployments': [{'status': 'Running', 'version': p['version'],
                                               'deploymentEnabled': True, 'replicas': 1}]}]}


class EstablishTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(e, 'establish_agent implementation is required')

    def test_pending_complete_inventory_without_unrelated_values(self):
        r = retained(); r['values']['UNRELATED_LOCAL_SECRET'] = 'never-import'
        p = e.build_pending('stable', baseline(), r, backend())
        self.assertFalse(p['complete'])
        self.assertEqual(set(p['values']), set(baseline()) | {'BACKEND_BASE_URL', 'COST_EVENT_SECRET'})
        self.assertEqual(p['values']['COST_EVENT_SECRET'], 'verified-cost')
        self.assertEqual(p['values']['AWS_SECRET_ACCESS_KEY'], 'issued-secret')

    def test_unknown_missing_deployed_value_fails(self):
        with self.assertRaises(ValueError):
            e.build_pending('stable', baseline() + ['NEW_UNKNOWN'], retained(), backend())

    def test_unsafe_values_fail_without_leaking(self):
        for value in ['secret\nINJECT=x', 'secret\rnext', 'secret\0tail', '']:
            r = retained(); r['values']['OPENAI_API_KEY'] = value
            with self.assertRaises(ValueError) as raised:
                e.build_pending('stable', baseline(), r, backend())
            self.assertNotIn(value or 'OPENAI', str(raised.exception))

    def test_wrong_profile_identity_and_auto_credentials_fail(self):
        with self.assertRaises(ValueError):
            e.build_pending('stable', baseline(), retained('primary'), backend())
        with self.assertRaises(ValueError):
            e.build_pending('stable', baseline() + ['LIVEKIT_API_SECRET'], retained(), backend())
        s = running(); s['agents'][0]['version'] = 'different'
        with self.assertRaises(ValueError): e.require_running('stable', s)

    def test_pending_written_and_verified_without_promotion(self):
        p = pending(); sm = Mock()
        sm.put_secret_value.return_value = {'VersionId': 'pending-v', 'ARN': 'arn:synthetic'}
        sm.get_secret_value.return_value = {'SecretString': json.dumps(p)}
        result = e.store_pending(sm, 'stable', p)
        self.assertEqual(result['versionId'], 'pending-v')
        self.assertEqual(sm.put_secret_value.call_args.kwargs['VersionStages'], [e.PENDING_STAGE])
        sm.update_secret_version_stage.assert_not_called()
        sm.get_secret_value.return_value = {'SecretString': '{}'}
        with self.assertRaises(ValueError): e.store_pending(sm, 'stable', p)
        sm.update_secret_version_stage.assert_not_called()

    def test_apply_exact_pending_private_file_cleaned_on_failure(self):
        p = pending(); sm = Mock(); lk = Mock()
        sm.get_secret_value.return_value = {'SecretString': json.dumps(p)}
        lk.status.return_value = running(); lk.inventory.return_value = baseline()
        observed = []
        def fail(profile, path):
            observed.append(path)
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            self.assertIn("COST_EVENT_SECRET='verified-cost'", Path(path).read_text())
            raise RuntimeError('private output')
        lk.update.side_effect = fail
        with self.assertRaises(RuntimeError): e.apply_pending(sm, 'stable', 'pending-v', lk)
        self.assertFalse(os.path.exists(observed[0]))
        self.assertEqual(sm.get_secret_value.call_args.kwargs['VersionId'], 'pending-v')
        sm.update_secret_version_stage.assert_not_called()

    def test_apply_inventory_drift_blocks_mutation(self):
        sm = Mock(); lk = Mock()
        sm.get_secret_value.return_value = {'SecretString': json.dumps(pending())}
        lk.status.return_value = running(); lk.inventory.return_value = baseline() + ['DRIFT']
        with self.assertRaises(ValueError): e.apply_pending(sm, 'stable', 'pending-v', lk)
        lk.update.assert_not_called()

    def test_partial_evidence_cannot_complete_or_promote(self):
        sm = Mock(); lk = Mock()
        sm.get_secret_value.return_value = {'SecretString': json.dumps(pending())}
        lk.status.return_value = running(); lk.inventory.return_value = list(pending()['values'])
        with patch.object(e, 'save_snapshot') as save:
            with self.assertRaises(ValueError): e.finalize_pending(sm, 'stable', 'pending-v', lk, {}, {})
            save.assert_not_called()
        sm.update_secret_version_stage.assert_not_called()

    def test_private_cli_uses_fixed_project_explicit_id_and_merge(self):
        with patch.object(e.subprocess, 'run', return_value=Mock(returncode=0, stdout='')) as run:
            with patch.dict(os.environ, {'LIVEKIT_API_SECRET': 'ambient-secret'}):
                e.LiveKit('/synthetic/lk').update('stable', '/private/synthetic.env')
        args = run.call_args.args[0]
        self.assertEqual(args, ['/synthetic/lk', '--project', 'production', 'agent',
                                'update-secrets', '--id', e.PROFILES['stable']['id'],
                                '--secrets-file', '/private/synthetic.env'])
        self.assertNotIn('LIVEKIT_API_SECRET', run.call_args.kwargs['env'])
        self.assertTrue(run.call_args.kwargs['capture_output'])

    def test_invalid_pending_coverage_cannot_apply(self):
        for field, value in [('complete', True), ('coverage', {}), ('profile', 'primary')]:
            p = pending(); p[field] = value
            sm = Mock(); lk = Mock()
            sm.get_secret_value.return_value = {'SecretString': json.dumps(p)}
            with self.assertRaises(ValueError): e.apply_pending(sm, 'stable', 'pending-v', lk)
            lk.update.assert_not_called()

    def test_retained_old_build_becomes_reviewed_source(self):
        for profile in ['stable', 'primary']:
            r = retained(profile)
            r['values']['AGENT_BUILD_REF'] = '947b932e9be6e9cf9d5fa44739ea8b13f5222aa8'
            p = e.build_pending(profile, baseline(profile), r, backend())
            self.assertEqual(p['sourceRevision'], 'a82930ad4449d2c55b79a94be2c2e7c7e1a37884')
            self.assertEqual(p['values']['AGENT_BUILD_REF'], p['sourceRevision'])
            self.assertEqual(p['values']['AWS_SECRET_ACCESS_KEY'], r['values']['AWS_SECRET_ACCESS_KEY'])

    def test_superseded_deployment_versions_rejected(self):
        for profile, old_version in [('stable', 'CqPbKWM3fgks'), ('primary', 'M9VUJFcXh9BM')]:
            status = running(profile)
            status['agents'][0]['version'] = old_version
            status['agents'][0]['agentDeployments'][0]['version'] = old_version
            with self.assertRaises(ValueError): e.require_running(profile, status)

    def test_wrong_pending_build_rejected(self):
        p = pending(); p['values']['AGENT_BUILD_REF'] = 'other-build'
        with self.assertRaises(ValueError): e.validate_pending('stable', p)

    def test_superseded_source_pending_cannot_apply_or_finalize(self):
        for profile in ['stable', 'primary']:
            p = pending(profile)
            p['sourceRevision'] = '947b932e9be6e9cf9d5fa44739ea8b13f5222aa8'
            p['values']['AGENT_BUILD_REF'] = p['sourceRevision']
            sm = Mock(); lk = Mock()
            sm.get_secret_value.return_value = {'SecretString': json.dumps(p)}
            lk.status.return_value = running(profile); lk.inventory.return_value = baseline(profile)
            with patch.object(e, 'save_snapshot') as save:
                with self.assertRaises(ValueError): e.apply_pending(sm, profile, 'superseded', lk)
                with self.assertRaises(ValueError): e.finalize_pending(sm, profile, 'superseded', lk, {}, {})
                lk.update.assert_not_called()
                save.assert_not_called()

    def test_unverified_backend_or_issued_values_rejected(self):
        b = backend(); b['complete'] = False
        with self.assertRaises(ValueError): e.build_pending('stable', baseline(), retained(), b)
        r = retained(); r['coverage']['AWS_SECRET_ACCESS_KEY'] = 'candidate_local_copy'
        with self.assertRaises(ValueError): e.build_pending('stable', baseline(), r, backend())

    def test_rollout_freshness_required_before_finalize(self):
        p = pending('primary'); p['capturedAt'] = '2020-01-01T00:00:00+00:00'
        receipt = {'profile': 'primary', 'agentId': e.PROFILES['primary']['id'], 'versionId': 'pending-v',
                   'appliedAt': '2020-01-01T00:00:10+00:00', 'applied': True}
        rollout = {'new_worker_id': 'CAW_new', 'previous_worker_id': 'CAW_old',
                   'new_worker_registered_at': '2020-01-01T00:00:20+00:00',
                   'previous_worker_stopped_at': '2020-01-01T00:00:30+00:00',
                   'media_started_at': '2020-01-01T00:00:40+00:00'}
        evidence = {'schema_version': 1, 'profile': 'primary', 'agent_id': e.PROFILES['primary']['id'],
                    'deployment_version': e.PROFILES['primary']['version'], 'secret_version_id': 'pending-v',
                    'verified_at': '2020-01-01T00:00:50+00:00',
                    'scope': {'room_name': 'lalia-canary-usage-primary-synthetic', 'identity_prefix': 'canary-synthetic-'},
                    'media': {'passed': True, 'tts_required': True, 'tts_passed': True},
                    'telemetry': {'positive': True, 'quota_matches': True}, 'rollout': rollout}
        sm = Mock(); lk = Mock()
        sm.get_secret_value.return_value = {'SecretString': json.dumps(p)}
        lk.status.return_value = running('primary'); lk.inventory.return_value = list(p['values'])
        bad_rollouts = [{}, dict(rollout, new_worker_registered_at='2020-01-01T00:00:05+00:00'),
                        dict(rollout, previous_worker_stopped_at='2020-01-01T00:00:45+00:00'),
                        dict(rollout, previous_worker_stopped_at='2020-01-01T00:00:05+00:00'),
                        dict(rollout, media_started_at='2020-01-01T00:00:15+00:00'),
                        dict(rollout, media_started_at='2020-01-01T00:00:55+00:00'),
                        dict(rollout, new_worker_id='CAW_old'), dict(rollout, new_worker_id=' ')]
        with patch.object(e, 'save_snapshot') as save:
            for bad in bad_rollouts:
                with self.subTest(rollout=bad):
                    with self.assertRaises(ValueError):
                        e.finalize_pending(sm, 'primary', 'pending-v', lk, receipt, dict(evidence, rollout=bad))
            save.assert_not_called()
            e.finalize_pending(sm, 'primary', 'pending-v', lk, receipt, evidence)
            self.assertEqual(save.call_count, 1)

    def test_verified_finalize_and_primary_tts_gate(self):
        for profile in ['stable', 'primary']:
            p = pending(profile); sm = Mock(); lk = Mock()
            sm.get_secret_value.return_value = {'SecretString': json.dumps(p)}
            lk.status.return_value = running(profile); lk.inventory.return_value = list(p['values'])
            receipt = {'profile': profile, 'agentId': e.PROFILES[profile]['id'], 'versionId': 'pending-v',
                       'appliedAt': p['capturedAt'], 'applied': True}
            evidence = {'schema_version': 1, 'profile': profile, 'agent_id': e.PROFILES[profile]['id'],
                        'deployment_version': e.PROFILES[profile]['version'], 'secret_version_id': 'pending-v',
                        'verified_at': p['capturedAt'], 'scope': {'room_name': 'lalia-canary-usage-' + profile + '-synthetic', 'identity_prefix': 'canary-synthetic-'},
                        'media': {'passed': True, 'tts_required': profile == 'primary', 'tts_passed': profile == 'primary'},
                        'telemetry': {'positive': True, 'quota_matches': True},
                        'rollout': {'new_worker_id': 'CAW_new', 'previous_worker_id': 'CAW_old',
                                    'new_worker_registered_at': p['capturedAt'],
                                    'previous_worker_stopped_at': p['capturedAt'],
                                    'media_started_at': p['capturedAt']}}
            with patch.object(e, 'save_snapshot', return_value={'complete': True}) as save:
                e.finalize_pending(sm, profile, 'pending-v', lk, receipt, evidence)
                final = save.call_args.args[2]
                self.assertTrue(final['complete'])
                self.assertEqual(set(final['coverage'].values()), {'known_deployed_verified'})
                for changed in [dict(evidence, secret_version_id='different'),
                                dict(evidence, scope={'room_name': 'unscoped', 'identity_prefix': 'canary-synthetic-'}),
                                dict(evidence, verified_at='2000-01-01T00:00:00+00:00'),
                                dict(evidence, telemetry={'positive': True, 'quota_matches': False})]:
                    with self.assertRaises(ValueError): e.finalize_pending(sm, profile, 'pending-v', lk, receipt, changed)
                lk.inventory.return_value = list(p['values']) + ['UNCOVERED']
                with self.assertRaises(ValueError): e.finalize_pending(sm, profile, 'pending-v', lk, receipt, evidence)
                lk.inventory.return_value = list(p['values'])
                if profile == 'primary':
                    evidence['media']['tts_passed'] = False
                    with self.assertRaises(ValueError): e.finalize_pending(sm, profile, 'pending-v', lk, receipt, evidence)
                    self.assertEqual(save.call_count, 1)

if __name__ == '__main__': unittest.main()
