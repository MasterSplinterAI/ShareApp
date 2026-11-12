"""Privacy regressions assert final bytes, not just logger arguments."""
import ast
import asyncio
import importlib.util
from functools import lru_cache
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parent
SENTINELS = ('SPEECH_SENTINEL_private_original', 'TRANSLATION_SENTINEL_private',
             'BODY_SENTINEL_provider_response', 'person_SENTINEL@example.com',
             'Bearer TOKEN_SENTINEL_secret', 'https://user:PASS_SENTINEL@private.invalid/path?token=SECRET_SENTINEL')
SOURCES = ('transcription_only_agent.py', 'transcription_codeswitch_agent.py',
           'cost_reporter.py', 'demo_orchestrator.py', 'tts_lane.py', 'agent_lifecycle.py')


def test_source_logs_do_not_interpolate_runtime_content():
    unsafe = []
    for filename in SOURCES:
        tree = ast.parse((ROOT / filename).read_text())
        for call in ast.walk(tree):
            if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name) and call.func.value.id == 'logger':
                if call.func.attr in ('debug', 'info', 'warning', 'error', 'exception', 'critical'):
                    if len(call.args) != 1 or not isinstance(call.args[0], ast.Constant) or not isinstance(call.args[0].value, str):
                        unsafe.append(f'{filename}:{call.lineno}')
                    assert not any(k.arg in ('exc_info', 'stack_info') for k in call.keywords), f'{filename}:{call.lineno}'
    assert not unsafe, 'Content-bearing log calls: ' + ', '.join(unsafe)


def test_privacy_helper_exists_before_sdk_imports():
    assert importlib.util.find_spec('private_logging') is not None, 'Missing defensive output filter'
    for filename in SOURCES[:2]:
        source = (ROOT / filename).read_text()
        assert source.index('install_private_logging()') < source.index('from livekit')



@lru_cache(maxsize=1)
def runtime_python():
    executable = os.getenv('LALIA_AGENT_RUNTIME_PYTHON', sys.executable)
    probe = subprocess.run([executable, '-c', 'import livekit.agents'], capture_output=True, timeout=30)
    if probe.returncode:
        pytest.skip('Install agent requirements or set LALIA_AGENT_RUNTIME_PYTHON to the real SDK interpreter')
    return executable


def run_script(script, tmp_path):
    target = tmp_path / 'probe.py'
    target.write_text(script)
    env = {**os.environ, 'PYTHONPATH': str(ROOT), 'PRIVACY_SENTINELS': json.dumps(SENTINELS)}
    result = subprocess.run([runtime_python(), str(target)], cwd=tmp_path, env=env,
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    output = result.stdout + result.stderr
    for value in SENTINELS:
        assert value not in output
    return output


def test_real_sdk_json_and_late_handlers_drop_all_untrusted_fields(tmp_path):
    assert importlib.util.find_spec('private_logging') is not None, 'Missing defensive output filter'
    output = run_script('''
import json, logging, os, sys
from private_logging import install_private_logging, operational_event
install_private_logging()
from livekit.agents.cli.log import setup_logging, JsonFormatter
setup_logging('DEBUG', devmode=False, console=False)
values = json.loads(os.environ['PRIVACY_SENTINELS'])
secret = ' '.join(values)
provider = logging.getLogger('httpx.' + secret)
provider.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stderr)
handler.setFormatter(JsonFormatter())
provider.addHandler(handler)
provider.propagate = False
try:
    raise RuntimeError(secret)
except Exception:
    provider.exception(secret, extra={'headers': {'Authorization': secret}, 'body': secret, 'participant': secret}, stack_info=True)
provider.debug({'message': secret, 'url': secret})
record = logging.LogRecord(secret, logging.ERROR, secret, 12, secret, (), None, secret, secret)
record.exc_text = secret
record.processName = secret
record.threadName = secret
record.body = secret
handler.handle(record)
operational_event('privacy_probe', status_code=503, duration_ms=12.5)
''', tmp_path)
    records = [json.loads(line) for line in output.splitlines()]
    assert any(r.get('message') == 'privacy_probe' for r in records)
    assert any(r.get('status_code') == 503 and r.get('duration_ms') == 12.5 for r in records)
    assert any(r.get('error_type') == 'RuntimeError' for r in records)
    assert all('worker_instance' in r for r in records)


def test_spawned_worker_is_filtered_before_prewarm(tmp_path):
    assert importlib.util.find_spec('private_logging') is not None, 'Missing defensive output filter'
    output = run_script('''
import logging, multiprocessing, os, json
from private_logging import install_private_logging, operational_event
install_private_logging()
def child():
    from livekit.agents.cli.log import setup_logging
    setup_logging('DEBUG', devmode=False, console=False)
    logging.getLogger('livekit.plugins.openai').error(os.environ['PRIVACY_SENTINELS'])
    operational_event('privacy_probe')
if __name__ == '__main__':
    process = multiprocessing.get_context('spawn').Process(target=child)
    process.start(); process.join(15)
    assert process.exitcode == 0
''', tmp_path)
    assert 'privacy_probe' in output


def test_provider_response_body_is_not_read_or_logged(monkeypatch, caplog):
    import cost_reporter
    class Response:
        status = 503
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def text(self):
            pytest.fail('Provider error body must not be read for diagnostics')
    reporter = cost_reporter.CostReporter('private-room')
    reporter._url = SENTINELS[-1]
    reporter._secret = SENTINELS[-2]
    monkeypatch.setattr(reporter, '_get_session', lambda: SimpleNamespace(post=lambda *a, **kw: Response()))
    asyncio.run(reporter._post('openai_llm_input_mtok', 1))
    assert all(value not in caplog.text for value in SENTINELS)


def test_native_fd_writes_and_uncaught_tracebacks_are_suppressed(tmp_path):
    output = run_script('''
import os, sys, logging, threading
from private_logging import install_private_logging, operational_event
install_private_logging(protect_output=True)
secret = os.environ['PRIVACY_SENTINELS']
print(secret, flush=True)
sys.stderr.write(secret + '\\n'); sys.stderr.flush()
os.write(1, (secret + '\\n').encode())
os.write(2, (secret * 1000 + '\\n').encode())
# A lookalike safe JSON line is untrusted without the transport signature.
os.write(1, ('{"message":"privacy_probe","body":' + secret + '}\\n').encode())
def broken(): raise RuntimeError(secret)
t = threading.Thread(target=broken); t.start(); t.join()
operational_event('privacy_controlled_error', error=RuntimeError(secret), status_code=503)
''', tmp_path)
    records = [json.loads(line) for line in output.splitlines()]
    assert any(r['message'] == 'unstructured_output_suppressed' for r in records)
    assert any(r['message'] == 'privacy_controlled_error' and r['error_type'] == 'RuntimeError' for r in records)
    assert len(records) < 10


def test_native_gate_preserves_signed_child_logs_and_pid1_exec(tmp_path):
    output = run_script('''
import logging, multiprocessing, os
from private_logging import install_private_logging, operational_event
install_private_logging(protect_output=True)
def child():
    from livekit.agents.cli.log import setup_logging
    setup_logging('DEBUG', devmode=False, console=False)
    os.write(2, (os.environ['PRIVACY_SENTINELS'] + '\\n').encode())
    logging.getLogger('livekit').error(os.environ['PRIVACY_SENTINELS'])
    operational_event('session_started')
if __name__ == '__main__':
    operational_event('worker_started')
    process = multiprocessing.get_context('spawn').Process(target=child)
    process.start(); process.join(15)
    assert process.exitcode == 0
    operational_event('session_stopped')
''', tmp_path)
    records = [json.loads(line) for line in output.splitlines()]
    started = next(r for r in records if r['message'] == 'worker_started')
    child = next(r for r in records if r['message'] == 'session_started')
    assert started['pid'] != child['pid']
    assert started['worker_instance'] != child['worker_instance']
    assert any(r['message'] == 'session_stopped' for r in records)


@pytest.mark.parametrize('method', ['spawn', 'forkserver'])
def test_real_sdk_ipc_queue_filters_before_serializing(method, tmp_path):
    output = run_script('''
import logging, multiprocessing, os
from private_logging import install_private_logging, operational_event
install_private_logging(protect_output=True)
def child():
    from livekit.agents.ipc.log_queue import LogQueueHandler
    import pickle
    class Duplex:
        def send_bytes(self, value):
            record = pickle.loads(value)
            assert os.environ['PRIVACY_SENTINELS'] not in str(record.__dict__)
            # Simulate parent-side SDK fields added AFTER child formatting.
            record.room = os.environ['PRIVACY_SENTINELS']
            logging.getLogger('parent.simulated').callHandlers(record)
        def close(self): pass
    queue = LogQueueHandler(Duplex())
    source = logging.getLogger('provider.queue')
    source.propagate = False
    source.addHandler(queue)
    source.warning(os.environ['PRIVACY_SENTINELS'], extra={'body': os.environ['PRIVACY_SENTINELS']})
    queue.close(); queue.thread.join(3)
    operational_event('session_started')
if __name__ == '__main__':
    process = multiprocessing.get_context(METHOD).Process(target=child)
    process.start(); process.join(15)
    assert process.exitcode == 0
'''.replace('METHOD', repr(method)), tmp_path)
    assert 'session_started' in output
    assert 'sdk_event' in output


def test_safe_canary_probe_has_no_provider_calls_and_emits_failure(tmp_path):
    script = ROOT / 'privacy_probe.py'
    assert script.exists(), 'Missing controlled privacy probe'
    result = subprocess.run([runtime_python(),
                             str(script)], cwd=tmp_path, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0, result.stderr
    records = [json.loads(line) for line in result.stdout.splitlines()]
    assert any(r['message'] == 'privacy_controlled_error' and r['level'] == 'ERROR' for r in records)
    assert all('SENTINEL' not in line for line in (result.stdout, result.stderr))


@pytest.mark.parametrize('module_name', ['transcription_only_agent', 'transcription_codeswitch_agent'])
def test_real_agent_error_and_room_metadata_paths_are_private(module_name, monkeypatch, capsys):
    import importlib
    import logging
    from unittest.mock import AsyncMock
    module = importlib.import_module(module_name)
    secret = ' '.join(SENTINELS)
    async def run():
        for name in ('DataPacket', 'RemoteParticipant', 'RemoteTrackPublication'):
            monkeypatch.setattr(module.rtc, name, object, raising=False)
        monkeypatch.setattr(module, 'CostReporter', lambda **kw: SimpleNamespace(aclose=AsyncMock()))
        callbacks, handlers = [], {}
        room = SimpleNamespace(name=secret, metadata=secret, on=handlers.__setitem__,
                               remote_participants={}, local_participant=SimpleNamespace(publish_data=AsyncMock()))
        agent = module.TranscriptionOnlyAgent()
        ctx = SimpleNamespace(room=room, connect=AsyncMock(), add_shutdown_callback=callbacks.append)
        await agent.entrypoint(ctx)
        participant = SimpleNamespace(identity=secret, name=secret, metadata=secret)
        handlers['data_received'](SimpleNamespace(participant=participant, data=secret.encode()))
        handlers['room_metadata_changed']('', secret)
        await callbacks[0]()
    # Module startup can replace root handlers. Attach a real stderr handler
    # after import so the assertion does not depend on pytest import order.
    handler = logging.StreamHandler(sys.stderr)
    logging.getLogger().addHandler(handler)
    try:
        asyncio.run(run())
    finally:
        logging.getLogger().removeHandler(handler)
        handler.close()
    output = capsys.readouterr().err
    assert all(value not in output for value in SENTINELS)
    assert 'parse_failed' in output or 'data_error' in output


@pytest.mark.parametrize('module', ['transcription_only_agent', 'transcription_codeswitch_agent'])
def test_canary_startup_probe_uses_real_launcher_and_keeps_secrets_private(module, tmp_path):
    result = subprocess.run([runtime_python(), '-u', str(ROOT / 'agent_launcher.py'), 'start', '--help'],
                            cwd=tmp_path, env={**os.environ, 'AGENT_MODULE': module,
                            'AGENT_BUILD_REF': SENTINELS[-1], 'LALIA_LOG_PRIVACY_PROBE': '1'},
                            capture_output=True, text=True, timeout=30)
    assert result.returncode == 0
    output = result.stdout + result.stderr
    assert 'privacy_controlled_error' in output
    assert all(value not in output for value in SENTINELS)
    assert 'SPEECH_SENTINEL' not in output
    assert module in output


def test_authenticated_frames_still_reject_unreviewed_fields(tmp_path):
    output = run_script('''
import os, time
import private_logging as privacy
privacy.install_private_logging(protect_output=True)
secret = os.environ['PRIVACY_SENTINELS']
data = {'message': 'privacy_probe', 'level': 'INFO', 'pid': os.getpid(),
        'worker_instance': 'a' * 32, 'timestamp': time.time(), 'body': secret}
os.write(1, privacy._gate.frame(data))
privacy.operational_event('privacy_probe')
''', tmp_path)
    records = [json.loads(line) for line in output.splitlines()]
    assert all('body' not in r for r in records)
    assert all(isinstance(r['timestamp'], (int, float)) for r in records)


def test_sdk_worker_lifecycle_remains_observable_without_room_identity(tmp_path):
    output = run_script('''
import logging, os
from private_logging import install_private_logging
install_private_logging(protect_output=True)
log = logging.getLogger('livekit.agents')
log.info('registered worker', extra={'id': os.environ['PRIVACY_SENTINELS'], 'url': os.environ['PRIVACY_SENTINELS']})
log.info('received job request', extra={'room': os.environ['PRIVACY_SENTINELS']})
log.info('shutting down worker', extra={'id': os.environ['PRIVACY_SENTINELS']})
''', tmp_path)
    assert 'sdk_worker_registered' in output
    assert 'sdk_job_requested' in output
    assert 'sdk_worker_stopping' in output
