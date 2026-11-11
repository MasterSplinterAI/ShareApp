"""Regression coverage for room controls and direct-provider authentication."""
import asyncio
import json
import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

import transcription_codeswitch_agent as codeswitch
import transcription_only_agent as stable


@pytest.mark.parametrize("message_type", ["language_update", "language_preference"])
@pytest.mark.parametrize("field", ["ttsVoiceId", "tts_voice_id"])
@pytest.mark.parametrize("is_host", [False, True])
def test_legacy_voice_change_requires_room_admin(monkeypatch, message_type, field, is_host):
    async def run():
        for name in ("DataPacket", "RemoteParticipant", "RemoteTrackPublication"):
            monkeypatch.setattr(codeswitch.rtc, name, object, raising=False)
        reporter = SimpleNamespace(aclose=AsyncMock())
        monkeypatch.setattr(codeswitch, "CostReporter", lambda **kwargs: reporter)
        handlers = {}
        registered = asyncio.Event()

        def on(event, callback):
            handlers[event] = callback
            if event == "participant_disconnected":
                registered.set()

        room = SimpleNamespace(name="test-room", metadata="", on=on,
                               remote_participants={},
                               local_participant=SimpleNamespace(publish_data=AsyncMock()))
        callbacks = []
        ctx = SimpleNamespace(room=room, connect=AsyncMock(), add_shutdown_callback=callbacks.append)
        agent = codeswitch.TranscriptionOnlyAgent()
        monkeypatch.setattr(agent, "update_assistants", AsyncMock())
        lane = SimpleNamespace(set_voice_id=lambda value: changed.append(value), aclose=AsyncMock())
        changed = []
        agent.tts_lanes["en"] = lane
        task = asyncio.create_task(agent.entrypoint(ctx))
        try:
            await asyncio.wait_for(registered.wait(), timeout=1)
            participant = SimpleNamespace(identity="host" if is_host else "guest",
                                          metadata=json.dumps({"role": "host" if is_host else "guest"}),
                                          name="Test", permissions=None)
            voice_id = "21m00Tcm4TlvDq8ikWAM"
            prior_tasks = set(agent._bg_tasks)
            handlers["data_received"](SimpleNamespace(
                participant=participant,
                data=json.dumps({"type": message_type, "language": "en", field: voice_id}).encode(),
            ))
            await asyncio.gather(*(agent._bg_tasks - prior_tasks))
            assert agent.room_tts_voice == (voice_id if is_host else None)
            assert changed == ([voice_id] if is_host else [])
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            for callback in callbacks:
                await callback()
    asyncio.run(run())


@pytest.mark.parametrize("module", [stable, codeswitch])
@pytest.mark.parametrize("provider", ["deepgram", "gladia", "openai"])
@pytest.mark.parametrize("key_value", [None, "   ", "test-key"])
def test_direct_stt_requires_its_provider_key(monkeypatch, module, provider, key_value):
    calls = []
    for name in ("DEEPGRAM_API_KEY", "GLADIA_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    if key_value is not None:
        monkeypatch.setenv(f"{provider.upper()}_API_KEY", key_value)
    monkeypatch.setenv("LIVEKIT_CLOUD", "true")
    monkeypatch.setenv("STT_PROVIDER", provider)
    monkeypatch.setattr(module, "PLUGINS_AVAILABLE", True)
    monkeypatch.setattr(module, "GLADIA_AVAILABLE", True)
    for name in ("deepgram", "gladia", "openai"):
        def create(name=name, **kwargs):
            calls.append(name)
            return object()
        monkeypatch.setattr(module, name, SimpleNamespace(STT=create))
    instance, actual = module.TranscriptionOnlyAgent()._create_stt_instance("speaker", "en")
    if key_value and key_value.strip():
        assert instance is not None
        assert actual == provider
        assert calls == [provider]
    else:
        assert instance is None
        assert calls == []


@pytest.mark.parametrize("module", [stable, codeswitch])
@pytest.mark.parametrize("key_value", [None, "   ", "test-key"])
def test_direct_llm_requires_openai_key(monkeypatch, module, key_value):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    if key_value is not None:
        monkeypatch.setenv("OPENAI_API_KEY", key_value)
    monkeypatch.setenv("LIVEKIT_CLOUD", "true")
    monkeypatch.setattr(module, "PLUGINS_AVAILABLE", True)
    calls = []
    monkeypatch.setattr(module, "openai", SimpleNamespace(LLM=lambda **kwargs: calls.append(kwargs) or object()))
    instance = module.TranscriptionOnlyAgent()._create_openai_llm_instance("test-model", "test")
    assert (instance is not None) == bool(key_value and key_value.strip())
    assert bool(calls) == bool(key_value and key_value.strip())


@pytest.mark.parametrize("module", [stable, codeswitch])
def test_config_logs_do_not_claim_cloud_supplies_provider_keys(monkeypatch, caplog, module):
    monkeypatch.setenv("LIVEKIT_CLOUD", "true")
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-appear-in-logs")
    with caplog.at_level(logging.INFO):
        module.log_resolved_inference_config()
    assert "must-not-appear-in-logs" not in caplog.text
    assert "direct provider plugins require their own API keys" in caplog.text
    assert "Cloud-injected Deepgram" not in caplog.text


@pytest.mark.parametrize("selected", [None, "transcription_only_agent", "transcription_codeswitch_agent"])
def test_docker_command_executes_selected_worker_as_main_process(tmp_path, monkeypatch, selected):
    """Run the real CMD with fixture agents; check argv, PID, and SIGTERM."""
    import os
    from pathlib import Path
    import shutil
    import subprocess
    import sys

    root = Path(__file__).parent
    command = json.loads(next(line[4:] for line in (root / "Dockerfile").read_text().splitlines() if line.startswith("CMD ")))
    shutil.copy(root / "agent_launcher.py", tmp_path)
    (tmp_path / "python").symlink_to(sys.executable)
    for name in ("transcription_only_agent", "transcription_codeswitch_agent"):
        (tmp_path / f"{name}.py").write_text(
            "import json, os, signal, sys, time\n"
            "from pathlib import Path\n"
            "signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))\n"
            "print(json.dumps({'pid':os.getpid(), 'module':Path(__file__).stem, 'args':sys.argv[1:]}), flush=True)\n"
            "while True: time.sleep(1)\n"
        )
    monkeypatch.delenv("AGENT_MODULE", raising=False)
    if selected is not None:
        monkeypatch.setenv("AGENT_MODULE", selected)
    monkeypatch.setenv("OPENAI_API_KEY", "never-log-provider-key")
    monkeypatch.setenv("AGENT_BUILD_REF", "abc1234")
    monkeypatch.setenv("PATH", str(tmp_path) + os.pathsep + os.environ["PATH"])
    process = subprocess.Popen(command + ["--log-level", "debug"], cwd=tmp_path,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    output = []
    try:
        while True:
            line = process.stdout.readline()
            assert line, "Worker did not start"
            output.append(line)
            if line.startswith("{"):
                result = json.loads(line)
                break
        assert result == {"pid": process.pid, "module": selected or "transcription_only_agent",
                          "args": ["start", "--log-level", "debug"]}
        assert "abc1234" in "".join(output)
        assert "never-log-provider-key" not in "".join(output)
        process.terminate()
        assert process.wait(timeout=3) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


@pytest.mark.parametrize("selected", ["", " ", "evil", "../evil", "transcription_codeswitch_agent.py", "transcription_codeswitch_agent;echo bad"])
def test_launcher_rejects_unknown_module_without_executing_it(tmp_path, monkeypatch, selected):
    from pathlib import Path
    import shutil
    import subprocess
    import sys

    shutil.copy(Path(__file__).with_name("agent_launcher.py"), tmp_path)
    for name in ("evil", "transcription_only_agent", "transcription_codeswitch_agent"):
        (tmp_path / f"{name}.py").write_text("raise RuntimeError('MUST_NOT_EXECUTE')\n")
    monkeypatch.setenv("AGENT_MODULE", selected)
    result = subprocess.run([sys.executable, str(tmp_path / "agent_launcher.py"), "start"],
                            cwd=tmp_path, capture_output=True, text=True, timeout=3)
    assert result.returncode == 2
    assert "Invalid AGENT_MODULE" in result.stderr
    assert "MUST_NOT_EXECUTE" not in result.stdout + result.stderr


@pytest.mark.parametrize("module", [stable, codeswitch])
def test_entrypoint_registers_shutdown_and_returns(monkeypatch, module):
    async def run():
        for name in ("DataPacket", "RemoteParticipant", "RemoteTrackPublication"):
            monkeypatch.setattr(module.rtc, name, object, raising=False)
        reporter = SimpleNamespace(aclose=AsyncMock())
        monkeypatch.setattr(module, "CostReporter", lambda **kwargs: reporter)
        callbacks = []
        registered = asyncio.Event()
        def on(event, callback):
            if event == "participant_disconnected":
                registered.set()
        room = SimpleNamespace(name="test-room", metadata="", on=on,
                               remote_participants={}, local_participant=SimpleNamespace(publish_data=AsyncMock()))
        ctx = SimpleNamespace(room=room, connect=AsyncMock(), add_shutdown_callback=callbacks.append)
        agent = module.TranscriptionOnlyAgent()
        close_pipelines = AsyncMock()
        monkeypatch.setattr(agent, "_shutdown_all_assistants", close_pipelines)
        task = asyncio.create_task(agent.entrypoint(ctx))
        try:
            await asyncio.wait_for(registered.wait(), 1)
            assert len(callbacks) == 1
            await asyncio.wait_for(asyncio.shield(task), 1)
            # A pending language-update debounce must not create pipelines after close.
            resumed = []
            async def pending_update():
                await asyncio.sleep(60)
                resumed.append(True)
            agent._update_debounce_task = asyncio.create_task(pending_update())
            await callbacks[0]()
            await callbacks[0]()  # repeat shutdown is harmless
            assert agent._update_debounce_task.cancelled()
            assert not resumed
            close_pipelines.assert_awaited_once_with(ctx)
            reporter.aclose.assert_awaited_once()
            assert all(t.done() for t in agent._bg_tasks)
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            for callback in callbacks:
                await callback()
    asyncio.run(run())


def test_shutdown_bounds_stalled_pipeline_cleanup(monkeypatch, caplog):
    import agent_lifecycle

    async def run():
        monkeypatch.setattr(agent_lifecycle, "SHUTDOWN_TIMEOUT_SEC", 0.01, raising=False)
        callbacks = []
        reporter = SimpleNamespace(aclose=AsyncMock())
        cancelled = asyncio.Event()
        async def stalled_close(ctx):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()
        agent = SimpleNamespace(_bg_tasks=set(), _update_debounce_task=None,
                                _agent_ready_ping_task=None, cost_reporter=reporter,
                                _shutdown_all_assistants=stalled_close)
        ctx = SimpleNamespace(add_shutdown_callback=callbacks.append)
        agent_lifecycle.register_shutdown(ctx, agent)
        with caplog.at_level(logging.WARNING):
            await asyncio.wait_for(callbacks[0](), timeout=0.2)
        assert cancelled.is_set()
        reporter.aclose.assert_awaited_once()
        assert "shutdown cleanup exceeded" in caplog.text
    asyncio.run(run())


@pytest.mark.parametrize("module", [stable, codeswitch])
def test_shutdown_drains_reports_created_by_pipeline_finalization(module):
    import agent_lifecycle

    async def run():
        agent = module.TranscriptionOnlyAgent()
        callbacks, order = [], []
        started = asyncio.Event()

        async def report(label):
            await asyncio.sleep(0.01)
            order.append(label)

        async def close_reporter():
            order.append("reporter_closed")

        async def pipeline():
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                agent._spawn_bg(report("final_report"), during_shutdown=True)

        agent.cost_reporter = SimpleNamespace(aclose=close_reporter)
        agent.speaker_pipelines["speaker"] = asyncio.create_task(pipeline())
        await started.wait()
        agent._spawn_bg(report("existing_report"), during_shutdown=True)
        ctx = SimpleNamespace(add_shutdown_callback=callbacks.append)
        agent_lifecycle.register_shutdown(ctx, agent)
        await callbacks[0]()
        assert order == ["existing_report", "final_report", "reporter_closed"]
        assert not agent.speaker_pipelines
        assert all(task.done() for task in agent._bg_tasks)
    asyncio.run(run())


@pytest.mark.parametrize("module", [stable, codeswitch])
def test_shutdown_rejects_new_room_work(monkeypatch, module):
    async def run():
        for name in ("DataPacket", "RemoteParticipant", "RemoteTrackPublication"):
            monkeypatch.setattr(module.rtc, name, object, raising=False)
        monkeypatch.setattr(module, "CostReporter", lambda **kwargs: SimpleNamespace(aclose=AsyncMock()))
        callbacks, handlers = [], {}
        room = SimpleNamespace(name="test-room", metadata="", on=handlers.__setitem__,
                               remote_participants={}, local_participant=SimpleNamespace(publish_data=AsyncMock()))
        ctx = SimpleNamespace(room=room, connect=AsyncMock(), add_shutdown_callback=callbacks.append)
        agent = module.TranscriptionOnlyAgent()
        reconcile = AsyncMock()
        monkeypatch.setattr(agent, "_update_assistants_locked", reconcile)
        await agent.entrypoint(ctx)

        async def close_pipelines(ctx):
            participant = SimpleNamespace(identity="late-guest", name="Late", metadata="")
            handlers["participant_connected"](participant)
            handlers["data_received"](SimpleNamespace(participant=participant, data=json.dumps(
                {"type": "language_update", "language": "es", "enabled": True}).encode()))
            handlers["room_metadata_changed"]("", '{"caption_config":{"mode":"off"}}')
            await agent.update_assistants(ctx)
            await asyncio.sleep(0)

        monkeypatch.setattr(agent, "_shutdown_all_assistants", close_pipelines)
        await callbacks[0]()
        assert not agent.participant_languages
        assert not agent.participant_display_names
        assert agent.caption_mode == "transcription_translation"
        reconcile.assert_not_awaited()
        assert agent._update_debounce_task is None
        assert agent._agent_ready_ping_task is None
        assert all(task.done() for task in agent._bg_tasks)
    asyncio.run(run())


def test_shutdown_cancels_stalled_final_report_before_reporter_close(monkeypatch, caplog):
    import agent_lifecycle

    async def run():
        monkeypatch.setattr(agent_lifecycle, "SHUTDOWN_TIMEOUT_SEC", 0.01)
        agent = stable.TranscriptionOnlyAgent()
        callbacks, order = [], []
        async def report():
            try:
                await asyncio.Event().wait()
            finally:
                order.append("report_cancelled")
        async def close_pipelines(ctx):
            agent._spawn_bg(report(), during_shutdown=True)
        async def close_reporter():
            order.append("reporter_closed")
        agent._shutdown_all_assistants = close_pipelines
        agent.cost_reporter = SimpleNamespace(aclose=close_reporter)
        agent_lifecycle.register_shutdown(SimpleNamespace(add_shutdown_callback=callbacks.append), agent)
        with caplog.at_level(logging.WARNING):
            await asyncio.wait_for(callbacks[0](), 0.2)
        assert order == ["report_cancelled", "reporter_closed"]
        assert all(task.done() for task in agent._bg_tasks)
        assert "shutdown cleanup exceeded" in caplog.text
    asyncio.run(run())
