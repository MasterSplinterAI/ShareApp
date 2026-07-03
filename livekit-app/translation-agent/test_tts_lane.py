"""Queue behavior tests for per-language TTS lanes."""

from __future__ import annotations

import asyncio
import json
import time

from tts_lane import TtsLane


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
