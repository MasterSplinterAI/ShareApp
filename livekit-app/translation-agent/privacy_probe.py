"""No-network controlled failure for image/log-drain verification.

Run inside the reviewed image. This does not change agent provider settings or
connect to a room; RTC media verification remains a separate canary step.
"""
from private_logging import install_private_logging, operational_event
install_private_logging(protect_output=True)

import logging
import os
import sys


def emit_controlled_probe():
    """Emit fixed synthetic privacy fixtures; no provider calls or job failures."""
    sentinel = 'SPEECH_SENTINEL BODY_SENTINEL Bearer TOKEN_SENTINEL https://user:PASS_SENTINEL@private.invalid'
    logging.getLogger('livekit.plugins.openai').warning(sentinel, extra={'body': sentinel})
    os.write(2, (sentinel + '\n').encode())
    try:
        raise RuntimeError(sentinel)
    except RuntimeError as error:
        operational_event('privacy_controlled_error', error=error, status_code=503)
    sys.stdout.flush()


def main():
    from livekit.agents.cli.log import setup_logging
    setup_logging('DEBUG', devmode=False, console=False)
    operational_event('worker_started', agent_module=os.getenv('AGENT_MODULE'))
    emit_controlled_probe()
    operational_event('session_stopped')


if __name__ == '__main__':
    main()
