#!/usr/bin/env python3
"""Live end-to-end verification for the self-hosted hybrid agent on LiveKit Cloud SFU.

Creates an ephemeral LiveKit Cloud room, explicitly dispatches `translation-selfhosted-xai`,
connects an English speaker + Spanish listener, streams a spoken audio clip via ffmpeg,
and verifies xAI transcription + live Spanish translation over LiveKit data channels.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from livekit import api, rtc


AGENT_NAME = os.getenv("VERIFY_AGENT_NAME", "translation-selfhosted-xai")
SAMPLE_RATE = 48000
CHANNELS = 1
FRAME_SAMPLES = 960  # 20ms at 48kHz
FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2


def _http_url(ws_url: str) -> str:
    return ws_url.replace("wss://", "https://").replace("ws://", "http://")


def _mint_token(api_key: str, api_secret: str, room_name: str, identity: str, name: str) -> str:
    return (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_ttl(timedelta(minutes=10))
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        .to_jwt()
    )


def _decode_pcm_48k_mono(audio_path: Path) -> bytes:
    proc = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(audio_path),
            "-f",
            "s16le",
            "-acodec",
            "pcm_s16le",
            "-ac",
            str(CHANNELS),
            "-ar",
            str(SAMPLE_RATE),
            "-",
        ],
        check=True,
        capture_output=True,
    )
    return proc.stdout


async def run_verification(audio_path: Path) -> int:
    env_candidate = Path(__file__).resolve().parent.parent / ".env.selfhosted"
    if env_candidate.exists():
        load_dotenv(env_candidate)
    else:
        load_dotenv()

    ws_url = os.environ["LIVEKIT_URL"]
    api_key = os.environ["LIVEKIT_API_KEY"]
    api_secret = os.environ["LIVEKIT_API_SECRET"]

    if not audio_path.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    pcm_bytes = _decode_pcm_48k_mono(audio_path)
    duration_sec = len(pcm_bytes) / (SAMPLE_RATE * CHANNELS * 2)
    print(f"[verify] Loaded {audio_path.name} ({duration_sec:.2f}s PCM @ 48kHz mono)")

    room_name = f"selfhosted-verify-{int(time.time())}"
    lkapi = api.LiveKitAPI(url=_http_url(ws_url), api_key=api_key, api_secret=api_secret)

    speaker_room = rtc.Room()
    listener_room = rtc.Room()

    agent_joined_evt = asyncio.Event()
    agent_identity_holder: list[str] = []
    active_stt_provider: list[str] = []
    captions: list[dict] = []

    def _maybe_record_agent(p: rtc.RemoteParticipant) -> None:
        ident = getattr(p, "identity", "") or ""
        kind = getattr(p, "kind", None)
        if kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT or ident.startswith("agent-"):
            if ident not in agent_identity_holder:
                agent_identity_holder.append(ident)
            agent_joined_evt.set()

    @speaker_room.on("participant_connected")
    def _on_speaker_participant(p: rtc.RemoteParticipant) -> None:
        _maybe_record_agent(p)

    @listener_room.on("data_received")
    def _on_data(packet: rtc.DataPacket) -> None:
        try:
            msg = json.loads(packet.data.decode("utf-8"))
        except Exception:
            return
        mtype = msg.get("type")
        if mtype == "provider_status":
            prov = msg.get("activeSttProvider") or msg.get("sttProvider")
            if prov:
                active_stt_provider.append(str(prov))
        elif mtype == "transcription":
            captions.append(msg)

    try:
        room_meta = json.dumps(
            {
                "type": "conference",
                "roomMode": "multi-language",
                "stt_pipeline": "selfhosted_xai",
                "caption_config": {
                    "mode": "transcription_translation",
                    "languages": ["en", "es"],
                },
            }
        )
        await lkapi.room.create_room(
            api.CreateRoomRequest(
                name=room_name,
                empty_timeout=120,
                departure_timeout=30,
                metadata=room_meta,
            )
        )
        t_dispatch = time.monotonic()
        await lkapi.agent_dispatch.create_dispatch(
            api.CreateAgentDispatchRequest(room=room_name, agent_name=AGENT_NAME)
        )
        print(f"[verify] Created room {room_name} and dispatched {AGENT_NAME}")

        speaker_tok = _mint_token(api_key, api_secret, room_name, "verify-speaker-en", "Kenny Test")
        listener_tok = _mint_token(api_key, api_secret, room_name, "verify-listener-es", "Elena Listener")

        await asyncio.gather(
            speaker_room.connect(ws_url, speaker_tok),
            listener_room.connect(ws_url, listener_tok),
        )

        for p in speaker_room.remote_participants.values():
            _maybe_record_agent(p)

        await asyncio.wait_for(agent_joined_evt.wait(), timeout=20.0)
        agent_join_ms = round((time.monotonic() - t_dispatch) * 1000)
        print(f"[verify] Agent joined: identity={agent_identity_holder[0]} latency_ms={agent_join_ms}")

        # Let agent finish ready broadcast, then announce both participant languages
        await asyncio.sleep(0.5)
        await speaker_room.local_participant.publish_data(
            json.dumps(
                {
                    "type": "language_preference",
                    "target_language": "en",
                    "translation_enabled": True,
                    "voice_enabled": False,
                }
            ).encode("utf-8"),
            reliable=True,
        )
        await listener_room.local_participant.publish_data(
            json.dumps(
                {
                    "type": "language_preference",
                    "target_language": "es",
                    "translation_enabled": True,
                    "voice_enabled": False,
                }
            ).encode("utf-8"),
            reliable=True,
        )
        # Allow agent _update_debounce_sec + STT stream initialization
        await asyncio.sleep(1.5)

        audio_source = rtc.AudioSource(SAMPLE_RATE, CHANNELS)
        local_track = rtc.LocalAudioTrack.create_audio_track("mic", audio_source)
        await speaker_room.local_participant.publish_track(
            local_track,
            rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE),
        )
        await asyncio.sleep(0.6)

        # Pad trailing buffer and append 3.0s silence so VAD/STT finalizes cleanly
        total_pcm = pcm_bytes + bytes(SAMPLE_RATE * CHANNELS * 2 * 3)
        rem = len(total_pcm) % FRAME_BYTES
        if rem:
            total_pcm += bytes(FRAME_BYTES - rem)

        t_start = time.monotonic()
        frame_idx = 0
        for offset in range(0, len(total_pcm), FRAME_BYTES):
            chunk = total_pcm[offset : offset + FRAME_BYTES]
            frame = rtc.AudioFrame(
                data=chunk,
                sample_rate=SAMPLE_RATE,
                num_channels=CHANNELS,
                samples_per_channel=FRAME_SAMPLES,
            )
            await audio_source.capture_frame(frame)
            frame_idx += 1
            target_t = t_start + frame_idx * 0.02
            delay = target_t - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)

        # Wait up to 6s for final transcription + Spanish LLM translation packets
        deadline = time.monotonic() + 6.0
        while time.monotonic() < deadline:
            finals = [c for c in captions if c.get("final")]
            has_en = any((c.get("language") or "").startswith("en") for c in finals)
            has_es = any((c.get("language") or "").startswith("es") and c.get("hasTranslation") for c in finals)
            if has_en and has_es:
                break
            await asyncio.sleep(0.25)

        finals = [c for c in captions if c.get("final")]
        en_finals = [c for c in finals if (c.get("language") or "").startswith("en")]
        es_finals = [c for c in finals if (c.get("language") or "").startswith("es")]
        resolved_stt = (
            (finals[-1].get("sttProvider") if finals else None)
            or (active_stt_provider[-1] if active_stt_provider else None)
            or "unknown"
        )

        summary = {
            "room_name": room_name,
            "agent_name": AGENT_NAME,
            "agent_identity": agent_identity_holder[0],
            "agent_join_ms": agent_join_ms,
            "active_stt_provider": resolved_stt,
            "total_caption_packets": len(captions),
            "final_en_texts": [c.get("originalText") or c.get("text") for c in en_finals],
            "final_es_translations": [c.get("text") for c in es_finals],
        }
        print(json.dumps(summary, ensure_ascii=False, indent=2))

        ok = bool(en_finals or es_finals) and bool(es_finals)
        return 0 if ok else 2
    finally:
        await asyncio.gather(
            speaker_room.disconnect(),
            listener_room.disconnect(),
            return_exceptions=True,
        )
        try:
            await lkapi.room.delete_room(api.DeleteRoomRequest(room=room_name))
        except Exception:
            pass
        await lkapi.aclose()


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <audio_file>", file=sys.stderr)
        sys.exit(1)
    exit_code = asyncio.run(run_verification(Path(sys.argv[1])))
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
