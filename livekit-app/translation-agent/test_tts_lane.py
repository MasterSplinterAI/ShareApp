"""Queue behavior tests for per-language TTS lanes."""

from __future__ import annotations

import asyncio
import json
import time

from cost_reporter import _TTS_EVENT_TYPES
from tts_lane import (
    TtsLane,
    _ELEVENLABS_DEFAULT_VOICE,
    classify_tts_api_error,
    participant_may_set_tts,
    resolve_tts_provider,
    resolve_xai_voice_id,
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


def test_chunked_enqueues_from_one_turn_all_speak_in_order() -> None:
    """Frozen-sentence chunks (supersede=False) must not drop each other."""
    async def _run() -> None:
        room = _FakeRoom()
        spoken: list[str] = []

        async def synth(text: str, language: str, playback_rate: float):
            spoken.append(text)
            await asyncio.sleep(0.02)
            return []

        lane = TtsLane(
            room=room,
            language="es",
            publish_track=False,
            synthesize_hook=synth,
        )
        await lane.start()
        await lane.enqueue_final("speaker-a", "Primera frase.", supersede=False)
        await lane.enqueue_final("speaker-a", "Segunda frase.", supersede=False)
        await lane.enqueue_final("speaker-a", "Tercera frase.", supersede=False)

        await _wait_for(lambda: len(spoken) == 3)
        await lane.aclose()

        assert spoken == ["Primera frase.", "Segunda frase.", "Tercera frase."]

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
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("TTS_PROVIDER", raising=False)
    # No xAI key: Aura languages stay on Deepgram; other languages need another voice.
    assert resolve_tts_provider("es") == "deepgram"
    assert resolve_tts_provider("ko") == "deepgram"

    monkeypatch.setenv("ELEVENLABS_API_KEY", "test-key")
    assert resolve_tts_provider("es") == "deepgram"
    assert resolve_tts_provider("uk") == "elevenlabs"

    # xAI key: covered languages use xAI, including when the env says auto.
    monkeypatch.setenv("XAI_API_KEY", "xai-test")
    monkeypatch.setenv("TTS_PROVIDER", "auto")
    assert resolve_tts_provider("es") == "xai"
    assert resolve_tts_provider("pt-BR") == "xai"
    assert resolve_tts_provider("uk") == "elevenlabs"

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


def test_start_prewarms_http_session_and_aclose_closes_it() -> None:
    async def _run() -> None:
        room = _FakeRoom()
        lane = TtsLane(room=room, language="es", publish_track=False)
        assert lane._http_session is None
        await lane.start()
        assert lane._http_session is not None
        assert not lane._http_session.closed
        await lane.aclose()
        assert lane._http_session is None

    asyncio.run(_run())


def test_multilingual_fallback_uses_openai_for_non_aura_language(monkeypatch) -> None:
    async def _run() -> None:
        monkeypatch.setenv("ELEVENLABS_API_KEY", "test-eleven-key")
        monkeypatch.setenv("OPENAI_API_KEY", "test-openai-key")
        room = _FakeRoom()
        lane = TtsLane(room=room, language="ru", provider="elevenlabs", publish_track=False)
        ladder = lane._build_provider_ladder()
        # Russian is not in Aura-2's 7 languages, so OpenAI must be the fallback (not English Aura-2)
        assert ladder == ["elevenlabs", "openai"]

        called_providers: list[str] = []

        async def fake_eleven(text: str, rate: float):
            called_providers.append("elevenlabs")
            raise RuntimeError("elevenlabs 429 rate limited")
            yield b""  # pragma: no cover

        async def fake_openai(text: str, rate: float):
            called_providers.append("openai")
            yield b"\x00\x00" * 480

        monkeypatch.setattr(lane, "_synthesize_elevenlabs", fake_eleven)
        monkeypatch.setattr(lane, "_synthesize_openai", fake_openai)

        frames = []
        async for f in lane._synthesize_with_fallback("Привет мир", 1.0):
            frames.append(f)

        assert called_providers == ["elevenlabs", "openai"]
        await lane.aclose()

    asyncio.run(_run())


class _FakeHttpResponse:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self._body = body
        self.content = self

    async def text(self) -> str:
        return self._body.decode("utf-8", errors="replace")

    async def iter_chunked(self, _size: int):
        yield self._body

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args) -> bool:
        return False


class _FakeHttpSession:
    def __init__(self, status: int = 200, body: bytes = b"\x00\x00" * 480) -> None:
        self.status = status
        self.body = body
        self.closed = False
        self.posts: list[tuple] = []

    def post(self, url, json=None, headers=None):
        self.posts.append((url, json, headers))
        return _FakeHttpResponse(self.status, self.body)


def test_xai_provider_resolution_and_runtime_switch(monkeypatch) -> None:
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("TTS_PROVIDER", raising=False)

    monkeypatch.setenv("XAI_API_KEY", "xai-test")
    monkeypatch.setenv("TTS_PROVIDER", "xai")
    assert resolve_tts_provider("es") == "xai"
    assert resolve_tts_provider("ko", preferred_provider="xai") == "xai"

    # Missing key: Aura languages stay on Deepgram; other languages use OpenAI.
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "openai-test")
    assert resolve_tts_provider("es", preferred_provider="xai") == "deepgram"
    assert resolve_tts_provider("uk", preferred_provider="xai") == "openai"
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert resolve_tts_provider("es", preferred_provider="xai") == "deepgram"

    room = _FakeRoom()
    lane = TtsLane(room=room, language="es", publish_track=False, provider="deepgram")
    track = object()
    lane._publication = track
    monkeypatch.setenv("XAI_API_KEY", "xai-test")
    assert lane.set_provider("xai", voice_id="Ara") == "xai"
    assert lane.provider == "xai"
    assert lane.xai_voice_id == "ara"
    assert lane._publication is track
    assert lane._build_provider_ladder() == ["xai", "deepgram"]

    monkeypatch.setenv("OPENAI_API_KEY", "openai-test")
    assert lane._build_provider_ladder() == ["xai", "deepgram", "openai"]
    assert _TTS_EVENT_TYPES["xai"] == "xai_tts_char"
    assert resolve_xai_voice_id("nope voice") == "eve"


def test_xai_synthesis_posts_pcm_request(monkeypatch) -> None:
    async def _run() -> None:
        monkeypatch.setenv("XAI_API_KEY", "xai-test")
        room = _FakeRoom()
        lane = TtsLane(room=room, language="pt-BR", provider="xai", publish_track=False)
        lane.xai_voice_id = "rex"
        session = _FakeHttpSession()
        lane._http_session = session

        frames = []
        async for frame in lane._synthesize_xai("olá", 1.8):
            frames.append(frame)

        assert frames
        url, body, headers = session.posts[0]
        assert url == "https://api.x.ai/v1/tts"
        assert headers["Authorization"] == "Bearer xai-test"
        assert body["voice_id"] == "rex"
        assert body["language"] == "pt-BR"
        assert body["speed"] == 1.5
        assert body["output_format"] == {"codec": "pcm", "sample_rate": 24000}
        assert body["optimize_streaming_latency"] == 2
        lane._http_session = None
        await lane.aclose()

    asyncio.run(_run())


def test_xai_synthesis_falls_back_to_openai(monkeypatch) -> None:
    async def _run() -> None:
        monkeypatch.setenv("XAI_API_KEY", "xai-test")
        monkeypatch.setenv("OPENAI_API_KEY", "openai-test")
        room = _FakeRoom()
        lane = TtsLane(room=room, language="es", provider="xai", publish_track=False)
        called: list[str] = []

        async def fail_xai(text: str, rate: float):
            called.append("xai")
            raise RuntimeError("xai down")
            yield b""  # pragma: no cover

        async def ok_openai(text: str, rate: float):
            called.append("openai")
            yield b"\x00\x00" * 480

        monkeypatch.setattr(lane, "_synthesize_xai", fail_xai)
        monkeypatch.setattr(lane, "_synthesize_openai", ok_openai)

        async for _frame in lane._synthesize_with_fallback("hola", 1.0):
            pass
        assert called == ["xai", "openai"]
        await lane.aclose()

    asyncio.run(_run())


def test_participant_tts_admin_metadata() -> None:
    assert participant_may_set_tts('{"ttsAdmin": true}')
    assert participant_may_set_tts('{"orgRole": "admin"}')
    assert participant_may_set_tts('{"orgRole": "owner"}')
    assert participant_may_set_tts('{"role": "host"}')
    assert not participant_may_set_tts('{"role": "guest"}')
    assert not participant_may_set_tts('{"ttsAdmin": false, "role": "admin"}')
    assert participant_may_set_tts('{}', type('P', (), {'permissions': type('Perm', (), {'can_update_metadata': True})()})())
    assert not participant_may_set_tts("not-json")

