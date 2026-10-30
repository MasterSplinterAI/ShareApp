"""Test-only stubs for optional LiveKit SDK imports.

Most helper tests do not exercise the LiveKit runtime, but
``transcription_only_agent`` imports SDK modules at module import time.
These lightweight stubs keep local unit tests runnable when the LiveKit
packages are not installed on the developer machine.
"""

from __future__ import annotations

import sys
import types


def _install_livekit_stubs() -> None:
    if "livekit" in sys.modules:
        return

    livekit = types.ModuleType("livekit")
    rtc = types.ModuleType("livekit.rtc")
    agents = types.ModuleType("livekit.agents")
    plugins = types.ModuleType("livekit.plugins")
    silero = types.ModuleType("livekit.plugins.silero")

    class _TrackSource:
        SOURCE_MICROPHONE = "microphone"

    class _AutoSubscribe:
        AUDIO_ONLY = "audio_only"

    class _WorkerOptions:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    rtc.TrackSource = _TrackSource
    agents.JobContext = object
    agents.WorkerOptions = _WorkerOptions
    agents.AutoSubscribe = _AutoSubscribe
    agents.cli = types.SimpleNamespace(run_app=lambda *args, **kwargs: None)
    plugins.silero = silero

    sys.modules["livekit"] = livekit
    sys.modules["livekit.rtc"] = rtc
    sys.modules["livekit.agents"] = agents
    sys.modules["livekit.plugins"] = plugins
    sys.modules["livekit.plugins.silero"] = silero

    livekit.rtc = rtc


_install_livekit_stubs()
