"""Queue behavior tests for per-language TTS lanes."""

from __future__ import annotations

import asyncio
import json
import time

from tts_lane import (
    TtsLane,
    _ELEVENLABS_DEFAULT_VOICE,
    classify_tts_api_error,
    resolve_tts_provider,
)


class _FakeLocalParticipant:
    def __init__(self) -> None:
        self.events = []

    async def publish_data(self, payload: bytes, topic: str, reliable: bool) -> None:
        self.events.append(
            {
                "topic": topic,
                "reliable": reliable,
                "payload": json.loads(payload.decode("utf-8")),
            }
        )


class _FakeRoom:
    def __init__(self) -> None:
        self.local_participant = _FakeLocalParticipant()


async def _wait_for(predicate, timeout: float = 1.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("condition not met before timeout")


def test_queue_drops_superseded_items_for_same_speaker() -> None:
    async def _run() -> None:
        room = _FakeRoom()
        spoken: list[str] = []

        async def synth(text: str, language: str, playback_rate: float):
            spoken.append(text)
            return []

        lane = TtsLane(
            room=room,
            language="es",
            publish_track=False,
            synthesize_hook=synth,
        )

        await lane.enqueue_final("speaker-a", "first sentence")
        await lane.enqueue_final("speaker-a", "replacement sentence")
        await lane.start()

        await _wait_for(lambda: len(spoken) == 1)
        await lane.aclose()

        assert spoken == ["replacement sentence"]
        event_types = [e["payload"]["type"] for e in room.local_participant.events]
        assert event_types == ["tts_start", "tts_end"]

    asyncio.run(_run())


def test_queue_drops_stale_items() -> None:
    async def _run() -> None:
        room = _FakeRoom()
        spoken: list[str] = []
        now = [0.0]

        async def synth(text: str, language: str, playback_rate: float):
            spoken.append(text)
            return []

        lane = TtsLane(
            room=room,
            language="fr",
            publish_track=False,
            stale_after_sec=8.0,
            now_fn=lambda: now[0],
            synthesize_hook=synth,
        )

        await lane.enqueue_final("speaker-a", "bonjour")
        now[0] = 9.5
        await lane.start()
        await asyncio.sleep(0.05)
        await lane.aclose()

        assert spoken == []
        assert room.local_participant.events == []

    asyncio.run(_run())


def test_lane_serializes_speakers_and_emits_cost() -> None:
    async def _run() -> None:
        room = _FakeRoom()
        spoken: list[tuple[str, str, float]] = []
        costs: list[tuple[int, str, str, str]] = []

        async def synth(text: str, language: str, playback_rate: float):
            spoken.append((text, language, playback_rate))
            await asyncio.sleep(0.01)
            return []

        async def emit_cost(chars: int, provider: str, language: str, participant: str):
            costs.append((chars, provider, language, participant))

        lane = TtsLane(
            room=room,
            language="de",
            publish_track=False,
            synthesize_hook=synth,
            emit_cost_hook=emit_cost,
        )

        await lane.enqueue_final("speaker-a", "eins")
        await lane.enqueue_final("speaker-b", "zwei")
        await lane.start()

        await _wait_for(lambda: len(spoken) == 2)
        await lane.aclose()

        assert [t for (t, _, _) in spoken] == ["eins", "zwei"]
        assert len(costs) == 2
        assert costs[0] == (4, "deepgram", "de", "speaker-a")
        assert costs[1] == (4, "deepgram", "de", "speaker-b")

        event_payloads = [e["payload"] for e in room.local_participant.events]
        assert [p["type"] for p in event_payloads] == [
            "tts_start",
            "tts_end",
            "tts_start",
            "tts_end",
        ]
        assert [p["speaker_id"] for p in event_payloads] == [
            "speaker-a",
            "speaker-a",
            "speaker-b",
            "speaker-b",
        ]

    asyncio.run(_run())


def test_resolve_tts_provider(monkeypatch) -> None:
    # No ElevenLabs key: always Deepgram, even for unsupported languages.
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("TTS_PROVIDER", raising=False)
    assert resolve_tts_provider("es") == "deepgram"
    assert resolve_tts_provider("ko") == "deepgram"

    # Key present + auto: ElevenLabs for its languages and for Aura gaps.
    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    assert resolve_tts_provider("es") == "elevenlabs"
    assert resolve_tts_provider("ko") == "elevenlabs"
    assert resolve_tts_provider("pt-BR") == "elevenlabs"

    # Explicit overrides win.
    monkeypatch.setenv("TTS_PROVIDER", "deepgram")
    assert resolve_tts_provider("es") == "deepgram"
    monkeypatch.setenv("TTS_PROVIDER", "elevenlabs")
    assert resolve_tts_provider("es") == "elevenlabs"

    # elevenlabs requested but no key: degrade to deepgram.
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    assert resolve_tts_provider("es") == "deepgram"


def test_classify_tts_api_error() -> None:
    code, msg = classify_tts_api_error("elevenlabs", 401, "invalid api key")
    assert code == "auth_failed"
    assert "invalid" in msg.lower() or "unauthorized" in msg.lower()

    code, msg = classify_tts_api_error("elevenlabs", 402, "quota exceeded")
    assert code == "credits_exhausted"
    assert "credit" in msg.lower() or "quota" in msg.lower()

    code, msg = classify_tts_api_error("elevenlabs", 429, "rate limit")
    assert code == "rate_limited"

    code, msg = classify_tts_api_error("elevenlabs", 500, "")
    assert code == "provider_error"


def test_default_voice_is_sarah() -> None:
    assert _ELEVENLABS_DEFAULT_VOICE == "EXAVITQu4vr4xnSDxMaL"


def test_voice_id_validation() -> None:
    from tts_lane import is_valid_elevenlabs_voice_id, resolve_elevenlabs_voice_id

    assert is_valid_elevenlabs_voice_id("EXAVITQu4vr4xnSDxMaL")
    assert not is_valid_elevenlabs_voice_id("../evil")
    assert not is_valid_elevenlabs_voice_id("bad?x=1")
    assert not is_valid_elevenlabs_voice_id("")
    assert resolve_elevenlabs_voice_id("../evil") == _ELEVENLABS_DEFAULT_VOICE


def test_voice_id_init_and_set() -> None:
    room = _FakeRoom()
    lane = TtsLane(room=room, language="en", publish_track=False)
    assert lane.voice_id is None

    lane2 = TtsLane(
        room=room,
        language="en",
        publish_track=False,
        voice_id="EXAVITQu4vr4xnSDxMaL",
    )
    assert lane2.voice_id == "EXAVITQu4vr4xnSDxMaL"

    lane2.set_voice_id("JBFqnCBsd6RMkjVDRZzb")
    assert lane2.voice_id == "JBFqnCBsd6RMkjVDRZzb"

    lane2.set_voice_id("../nope")
    assert lane2.voice_id == "JBFqnCBsd6RMkjVDRZzb"

    lane3 = TtsLane(room=room, language="en", publish_track=False, voice_id="bad-id!")
    assert lane3.voice_id is None


def test_tts_error_event_emitted_on_failure() -> None:
    async def _run() -> None:
        room = _FakeRoom()

        async def failing_synth(text: str, language: str, playback_rate: float):
            raise RuntimeError("boom")

        lane = TtsLane(
            room=room,
            language="es",
            publish_track=False,
            provider="elevenlabs",
            synthesize_hook=failing_synth,
        )
        await lane.enqueue_final("speaker-a", "hola")
        await lane.start()
        await _wait_for(
            lambda: any(e["payload"].get("type") == "tts_error" for e in room.local_participant.events)
        )
        await lane.aclose()

        error_events = [e for e in room.local_participant.events if e["payload"].get("type") == "tts_error"]
        assert len(error_events) == 1
        payload = error_events[0]["payload"]
        assert payload["provider"] == "elevenlabs"
        assert payload["code"] == "synthesis_failed"
        assert payload["language"] == "es"

    asyncio.run(_run())
