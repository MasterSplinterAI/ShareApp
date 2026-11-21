"""Deny-by-default diagnostic logging for the two deployed caption workers.

Messages must be in the reviewed static vocabulary. SDK text, exception strings,
extra objects and traceback source lines are never serialized. In production an
fd-level gate also discards arbitrary Python/native stdout and stderr writes.
"""
from __future__ import annotations

import atexit
import hashlib
import hmac
import json
import logging
import math
import os
import re
import threading
import time
import uuid

from private_log_events import SAFE_EVENTS

_SDK_EVENTS = {
    'starting worker': 'sdk_worker_starting',
    'registered worker': 'sdk_worker_registered',
    'received job request': 'sdk_job_requested',
    'draining worker': 'sdk_worker_draining',
    'shutting down worker': 'sdk_worker_stopping',
    'initializing process': 'sdk_process_initializing',
    'process initialized': 'sdk_process_initialized',
    'job exiting': 'sdk_job_exiting',
    'process is unresponsive, killing process': 'sdk_process_unresponsive',
}
_EVENTS = SAFE_EVENTS | frozenset(_SDK_EVENTS.values()) | frozenset({
    'privacy_probe', 'privacy_controlled_error', 'worker_started', 'session_started',
    'session_stopped', 'unstructured_output_suppressed', 'sdk_event', 'inference_config',
})
_NUMBERS = frozenset({'count', 'duration_ms', 'ttft_ms', 'status_code', 'retry_count', 'input_tokens', 'output_tokens'})
_ERROR_TYPES = frozenset({'RuntimeError', 'ValueError', 'TypeError', 'TimeoutError', 'ConnectionError',
                         'OSError', 'CancelledError', 'TtsApiError', 'APIStatusError', 'APIConnectionError', 'APITimeoutError'})
_PROVIDERS = frozenset({'deepgram', 'openai', 'gladia', 'xai', 'elevenlabs', 'unknown'})
_MODULES = frozenset({'transcription_only_agent', 'transcription_codeswitch_agent'})
_installed = False
_gate = None
_worker_pid = None
_worker_id = None
_original_handle = logging.Handler.handle
_original_format = logging.Handler.format


def _worker_identity():
    global _worker_pid, _worker_id
    if _worker_pid != os.getpid():
        _worker_pid, _worker_id = os.getpid(), uuid.uuid4().hex
    return _worker_id


def _safe_data(record):
    # Never call getMessage(), str(exception), or repr(extra).
    msg = record.msg
    event = 'sdk_event'
    if type(msg) is str and not record.args:
        event = msg if msg in _EVENTS else _SDK_EVENTS.get(msg, 'sdk_event')
    levels = {10: 'DEBUG', 20: 'INFO', 30: 'WARNING', 40: 'ERROR', 50: 'CRITICAL'}
    level = record.levelno if type(record.levelno) is int and record.levelno in levels else 30
    data = {'message': event, 'level': levels[level], 'pid': os.getpid(),
            'worker_instance': _worker_identity(), 'timestamp': time.time()}
    for key in _NUMBERS:
        value = record.__dict__.get(key)
        if type(value) in (int, float) and 0 <= value <= 1e12 and math.isfinite(value):
            data[key] = value
    error_type = record.__dict__.get('error_type')
    if record.exc_info and isinstance(record.exc_info, tuple) and len(record.exc_info) == 3:
        error_type = getattr(record.exc_info[0], '__name__', None)
    if error_type is not None:
        data['error_type'] = error_type if type(error_type) is str and error_type in _ERROR_TYPES else 'ProviderError'
    for key, allowed in (('provider', _PROVIDERS), ('agent_module', _MODULES)):
        value = record.__dict__.get(key)
        if type(value) is str and value in allowed:
            data[key] = value
    build = record.__dict__.get('build_ref')
    if type(build) is str and re.fullmatch(r'[a-fA-F0-9]{7,40}', build):
        data['build_ref'] = build
    if 'provider' not in data and type(record.name) is str:
        for provider in _PROVIDERS:
            if record.name == f'livekit.plugins.{provider}' or record.name.startswith(f'livekit.plugins.{provider}.'):
                data['provider'] = provider
                break
    return data


def _sanitize(record):
    data = _safe_data(record)
    # Rebuild the entire record: formatter-specific fields and custom extras can
    # otherwise bypass a root logger filter (including cached exc_text).
    clean = logging.LogRecord('agent.operations', getattr(logging, data['level']),
                              'redacted', 0, data.pop('message'), (), None, 'redacted')
    clean.__dict__.update(data)
    record.__dict__.clear()
    record.__dict__.update(clean.__dict__)
    return record


def _handle(handler, record):
    _sanitize(record)
    if _gate is not None and isinstance(handler, logging.StreamHandler):
        # Commit trusted records synchronously. multiprocessing forkserver uses
        # os._exit(), so a child-local pipe-reader thread cannot flush on exit.
        if handler.filter(record):
            _gate._output(_safe_data(record))
            return True
        return False
    return _original_handle(handler, record)


def _format(handler, record):
    if isinstance(handler, logging.StreamHandler):
        data = _safe_data(record)
        if _gate is not None:
            return _gate.frame(data).decode('utf-8').rstrip('\n')
        return json.dumps(data, ensure_ascii=True, separators=(',', ':'))
    # Filters on SDK handlers may add room/participant values after handle().
    return _original_format(handler, _sanitize(record))


def _valid_wire_data(data):
    """Recheck the wire schema even for a correctly authenticated child frame."""
    required = {'message', 'level', 'pid', 'worker_instance', 'timestamp'}
    optional = _NUMBERS | {'error_type', 'provider', 'agent_module', 'build_ref'}
    if type(data) is not dict or not required <= data.keys() or data.keys() - required - optional:
        return False
    if data['message'] not in _EVENTS or data['level'] not in {'DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'}:
        return False
    if type(data['pid']) is not int or not 0 < data['pid'] < 2**31:
        return False
    if type(data['worker_instance']) is not str or not re.fullmatch(r'[0-9a-f]{32}', data['worker_instance']):
        return False
    for key in (_NUMBERS | {'timestamp'}) & data.keys():
        value = data[key]
        if type(value) not in (int, float) or not 0 <= value <= 1e12 or not math.isfinite(value):
            return False
    for key, values in (('error_type', _ERROR_TYPES | {'ProviderError'}), ('provider', _PROVIDERS), ('agent_module', _MODULES)):
        if key in data and (type(data[key]) is not str or data[key] not in values):
            return False
    if 'build_ref' in data and (type(data['build_ref']) is not str or not re.fullmatch(r'[a-fA-F0-9]{7,40}', data['build_ref'])):
        return False
    return True


class _OutputGate:
    """Only authenticated structured frames cross the stdout/stderr boundary.

    Spawned interpreters inherit the per-container key through the environment;
    their output goes through the parent's gate as well. This is a transport
    integrity key generated at startup, not an application/provider credential.
    Raw pipe reads are bounded and never interpolated in suppression diagnostics.
    """
    PREFIX = b'LALIA_PRIVATE_V1 '
    MAX_LINE = 4096

    def __init__(self):
        self.pid = os.getpid()
        parent = os.environ.get('_LALIA_LOG_GATE_OWNER')
        self.nested = parent is not None and parent != str(self.pid)
        key = os.environ.get('_LALIA_LOG_GATE_KEY')
        if not self.nested or not key:
            key = os.urandom(32).hex()
            os.environ['_LALIA_LOG_GATE_KEY'] = key
        self.key = bytes.fromhex(key)
        os.environ['_LALIA_LOG_GATE_OWNER'] = str(self.pid)
        self.output_fd = os.dup(1)
        self.read_fd, write_fd = os.pipe()
        os.dup2(write_fd, 1)
        os.dup2(write_fd, 2)
        os.close(write_fd)
        self.suppressed = False
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._read, name='private-log-gate', daemon=True)
        self.thread.start()
        if hasattr(os, 'register_at_fork'):
            os.register_at_fork(after_in_child=self._after_fork)
        atexit.register(self.close)

    def _after_fork(self):
        # A logging thread may have owned the lock at fork. The child continues
        # to write trusted frames through the still-running parent's pipe gate.
        self.lock = threading.Lock()

    def frame(self, data):
        payload = json.dumps(data, ensure_ascii=True, separators=(',', ':')).encode()
        digest = hmac.new(self.key, payload, hashlib.sha256).hexdigest().encode()
        return self.PREFIX + digest + b' ' + payload + b'\n'

    def _output(self, data):
        encoded = self.frame(data) if self.nested else (json.dumps(data, separators=(',', ':')).encode() + b'\n')
        with self.lock:
            try:
                os.write(self.output_fd, encoded)
            except OSError:
                pass  # Diagnostic failure must not terminate translation.

    def _line(self, line):
        if line.startswith(self.PREFIX):
            try:
                digest, payload = line[len(self.PREFIX):].split(b' ', 1)
                expected = hmac.new(self.key, payload, hashlib.sha256).hexdigest().encode()
                if hmac.compare_digest(digest, expected):
                    data = json.loads(payload)
                    if _valid_wire_data(data):
                        self._output(data)
                        return
            except (ValueError, TypeError):
                pass
        if not self.suppressed:
            self.suppressed = True
            self._output({'message': 'unstructured_output_suppressed', 'level': 'WARNING',
                          'pid': self.pid, 'worker_instance': _worker_identity(), 'timestamp': time.time()})

    def _read(self):
        pending = b''
        oversized = False
        try:
            while True:
                chunk = os.read(self.read_fd, 4096)
                if not chunk:
                    if pending or oversized:
                        self._line(b'')
                    return
                for part in chunk.splitlines(keepends=True):
                    if not oversized:
                        pending += part
                        if len(pending) > self.MAX_LINE:
                            pending, oversized = b'', True
                    if part.endswith(b'\n'):
                        self._line(b'' if oversized else pending.rstrip(b'\r\n'))
                        pending, oversized = b'', False
        except OSError:
            return
        finally:
            os.close(self.read_fd)

    def close(self):
        if self.pid != os.getpid():
            return
        import sys
        for stream in (sys.stdout, sys.stderr):
            try:
                stream.flush()
            except Exception:
                pass
        # Closing this process's writers permits the reader to drain. Children
        # may still hold writers; a bounded join avoids shutdown deadlocks.
        for fd in (1, 2):
            try:
                os.close(fd)
            except OSError:
                pass
        self.thread.join(timeout=1.0)


def install_private_logging(*, protect_output=None):
    global _installed, _gate
    if not _installed:
        logging.Handler.handle = _handle
        logging.Handler.format = _format
        logging.raiseExceptions = False
        _installed = True
    if protect_output is None:
        protect_output = os.environ.get('LALIA_PRIVATE_LOG_OUTPUT') == '1'
    if protect_output and (_gate is None or _gate.pid != os.getpid()):
        _gate = _OutputGate()
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO)


def operational_event(event, *, error=None, **metadata):
    if error is not None:
        metadata['error_type'] = type(error).__name__
    level = logging.ERROR if event == 'privacy_controlled_error' else logging.INFO
    logging.getLogger('agent.operations').log(level, event, extra=metadata)
