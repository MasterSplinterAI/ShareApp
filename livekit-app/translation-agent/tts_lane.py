"""Per-language TTS lane: queue finalized translations and publish `tts-{lang}` audio."""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Deque, Optional

import aiohttp

from livekit import rtc

try:
    from livekit.plugins import deepgram

    DEEPGRAM_AVAILABLE = True
except ImportError:  # pragma: no cover - local test stubs often omit plugin packages
    DEEPGRAM_AVAILABLE = False
    deepgram = None

logger = logging.getLogger(__name__)

# Aura-2 voices verified against the Deepgram /v1/speak API (2026-07).
# Aura-2 supports en/es/fr/de/it/ja/nl only; other languages (e.g. pt, zh)
# fall back to the English voice, which is degraded but still audible.
_AURA_VOICE_BY_LANG = {
    "en": "aura-2-thalia-en",
    "es": "aura-2-celeste-es",
    "fr": "aura-2-agathe-fr",
    "de": "aura-2-julius-de",
    "it": "aura-2-livia-it",
    "ja": "aura-2-izanami-ja",
    "nl": "aura-2-daphne-nl",
}
_AURA_SUPPORTED_LANGS = set(_AURA_VOICE_BY_LANG)

# ElevenLabs Flash v2.5: one multilingual voice covers all 32 supported languages.
_ELEVENLABS_MODEL = "eleven_flash_v2_5"
_ELEVENLABS_DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb"  # "George" — neutral multilingual
# ISO 639-1 codes Flash v2.5 accepts as language_code (per ElevenLabs docs).
_ELEVENLABS_LANGS = {
    "en", "es", "fr", "de", "it", "pt", "pl", "nl", "sv", "da", "no", "fi",
    "cs", "sk", "uk", "ru", "ro", "bg", "hr", "el", "hu", "tr", "ar", "hi",
    "ja", "ko", "zh", "vi", "id", "ms", "ta", "fil",
}


class TtsApiError(RuntimeError):
    """Structured TTS provider failure for debug telemetry."""

    def __init__(
        self,
        *,
        provider: str,
        message: str,
        code: str = "unknown",
        http_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.provider = provider
        self.code = code
        self.http_status = http_status
        self.message = message


def classify_tts_api_error(
    provider: str,
    http_status: int | None,
    detail: str = "",
) -> tuple[str, str]:
    """Map provider HTTP failures to short debug codes + human messages."""
    detail_l = (detail or "").lower()
    provider_label = "ElevenLabs" if provider == "elevenlabs" else "Deepgram"

    if http_status == 401 or "invalid api key" in detail_l or "unauthorized" in detail_l:
        return (
            "auth_failed",
            f"{provider_label} API key invalid or unauthorized",
        )
    if http_status == 402 or any(
        token in detail_l
        for token in ("quota", "credit", "payment", "subscription", "billing", "insufficient")
    ):
        return (
            "credits_exhausted",
            f"{provider_label} credits or quota exhausted — check billing",
        )
    if http_status == 429 or "rate limit" in detail_l or "too many requests" in detail_l:
        return (
            "rate_limited",
            f"{provider_label} rate limit exceeded — retry shortly",
        )
    if http_status == 403:
        return ("forbidden", f"{provider_label} request forbidden — check account permissions")
    if http_status == 400:
        return ("bad_request", f"{provider_label} rejected request — voice or language may be invalid")
    if http_status is not None and http_status >= 500:
        return ("provider_error", f"{provider_label} server error (HTTP {http_status})")
    if http_status is not None:
        return ("http_error", f"{provider_label} HTTP {http_status}")
    return ("unknown", f"{provider_label} synthesis failed")


def resolve_tts_provider(language: str) -> str:
    """Pick the TTS provider for a target language.

    Honors TTS_PROVIDER env ("elevenlabs" | "deepgram" | "auto", default auto).
    Auto prefers ElevenLabs (broader coverage, faster) when a key is configured,
    keeping Deepgram for its 7 natively supported languages if no key exists.
    """
    base = (language or "en").split("-")[0].lower()
    pref = os.getenv("TTS_PROVIDER", "auto").strip().lower()
    has_eleven = bool(os.getenv("ELEVENLABS_API_KEY", "").strip())

    if pref == "deepgram":
        return "deepgram"
    if pref == "elevenlabs":
        return "elevenlabs" if has_eleven else "deepgram"
    # auto
    if has_eleven and (base in _ELEVENLABS_LANGS or base not in _AURA_SUPPORTED_LANGS):
        return "elevenlabs"
    return "deepgram"


@dataclass
class _QueuedSentence:
    speaker_id: str
    text: str
    enqueued_at: float
    sequence: int


class TtsLane:
    """Serialized speech lane for one target language."""

    def __init__(
        self,
        room: Any,
        language: str,
        *,
        stale_after_sec: float = 8.0,
        provider: str = "deepgram",
        sample_rate: int = 24000,
        num_channels: int = 1,
        publish_track: bool = True,
        now_fn: Callable[[], float] = time.monotonic,
        synthesize_hook: Optional[Callable[[str, str, float], Any]] = None,
        emit_cost_hook: Optional[
            Callable[[int, str, str, str], Awaitable[None] | None]
        ] = None,
    ) -> None:
        self.room = room
        self.language = language
        self.provider = provider
        self.sample_rate = sample_rate
        self.num_channels = num_channels
        self.track_name = f"tts-{language}"
        self.stale_after_sec = stale_after_sec
        self.publish_track = publish_track

        self._now = now_fn
        self._synthesize_hook = synthesize_hook
        self._emit_cost_hook = emit_cost_hook

        self._queue: Deque[_QueuedSentence] = deque()
        self._queue_lock = asyncio.Lock()
        self._queue_event = asyncio.Event()
        self._worker_task: asyncio.Task | None = None
        self._closed = False

        self._sequence = 0
        self._latest_sequence_by_speaker: dict[str, int] = {}
        self._last_error_sig: str | None = None
        self._last_error_at: float = 0.0

        self._deepgram_tts: Any = None
        self._http_session: aiohttp.ClientSession | None = None
        self._audio_source: Any = None
        self._local_track: Any = None
        self._publication: Any = None

    async def start(self) -> None:
        if self._closed:
            return
        if self.publish_track:
            await self._ensure_track_published()
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(
                self._run_worker(),
                name=f"tts-lane-{self.language}",
            )

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._queue_event.set()
        if self._worker_task and not self._worker_task.done():
            self._worker_task.cancel()
            await asyncio.gather(self._worker_task, return_exceptions=True)

        async with self._queue_lock:
            self._queue.clear()

        await self._unpublish_track()
        await self._close_audio_source()
        if self._http_session is not None and not self._http_session.closed:
            await self._http_session.close()
        self._http_session = None

    async def enqueue_final(self, speaker_id: str, text: str) -> None:
        clean_text = " ".join((text or "").split())
        if self._closed or not clean_text:
            return

        async with self._queue_lock:
            self._sequence += 1
            seq = self._sequence
            self._latest_sequence_by_speaker[speaker_id] = seq
            # New turn supersedes queued but not-yet-spoken items from this speaker.
            self._queue = deque(x for x in self._queue if x.speaker_id != speaker_id)
            self._queue.append(
                _QueuedSentence(
                    speaker_id=speaker_id,
                    text=clean_text,
                    enqueued_at=self._now(),
                    sequence=seq,
                )
            )
            self._queue_event.set()

    @property
    def queue_depth(self) -> int:
        return len(self._queue)

    async def _run_worker(self) -> None:
        while not self._closed:
            item = await self._pop_next_item()
            if item is None:
                continue

            if self._is_stale(item):
                logger.info(
                    "[TTS:%s] dropping stale sentence speaker=%s age=%.2fs",
                    self.language,
                    item.speaker_id,
                    self._now() - item.enqueued_at,
                )
                continue

            latest_seq = self._latest_sequence_by_speaker.get(item.speaker_id)
            if latest_seq is not None and item.sequence < latest_seq:
                continue

            await self._emit_tts_event("tts_start", item.speaker_id)
            try:
                await self._speak_item(item)
            except asyncio.CancelledError:
                raise
            except TtsApiError as exc:
                logger.warning(
                    "[TTS:%s] provider error speaker=%s code=%s: %s",
                    self.language,
                    item.speaker_id,
                    exc.code,
                    exc.message,
                )
                await self._emit_tts_error(
                    speaker_id=item.speaker_id,
                    provider=exc.provider,
                    code=exc.code,
                    message=exc.message,
                    http_status=exc.http_status,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[TTS:%s] synthesis/playback failed for speaker=%s: %s",
                    self.language,
                    item.speaker_id,
                    exc,
                )
                await self._emit_tts_error(
                    speaker_id=item.speaker_id,
                    provider=self.provider,
                    code="synthesis_failed",
                    message=str(exc),
                )
            finally:
                await self._emit_tts_event("tts_end", item.speaker_id)

    async def _pop_next_item(self) -> _QueuedSentence | None:
        while not self._closed:
            async with self._queue_lock:
                if self._queue:
                    return self._queue.popleft()
                self._queue_event.clear()
            await self._queue_event.wait()
        return None

    def _is_stale(self, item: _QueuedSentence) -> bool:
        return (self._now() - item.enqueued_at) > self.stale_after_sec

    def _playback_rate_for_depth(self, depth: int) -> float:
        # Mild catch-up when queue backs up; keep speech understandable.
        if depth >= 6:
            return 1.25
        if depth >= 3:
            return 1.12
        return 1.0

    async def _speak_item(self, item: _QueuedSentence) -> None:
        async with self._queue_lock:
            backlog_depth = len(self._queue)
        playback_rate = self._playback_rate_for_depth(backlog_depth)

        if self._emit_cost_hook is not None:
            try:
                maybe = self._emit_cost_hook(
                    len(item.text),
                    self.provider,
                    self.language,
                    item.speaker_id,
                )
                if inspect.isawaitable(maybe):
                    await maybe
            except Exception as exc:  # noqa: BLE001
                logger.debug(
                    "[TTS:%s] cost hook failed speaker=%s: %s",
                    self.language,
                    item.speaker_id,
                    exc,
                )

        synthesis = self._synthesize(item.text, playback_rate)
        async for frame in self._iter_audio_frames(synthesis):
            if self._audio_source is not None:
                await self._capture_frame(frame)

    def _synthesize(self, text: str, playback_rate: float) -> Any:
        if self._synthesize_hook is not None:
            return self._synthesize_hook(text, self.language, playback_rate)

        if self.provider == "elevenlabs":
            return self._synthesize_elevenlabs(text, playback_rate)

        if not DEEPGRAM_AVAILABLE or deepgram is None:
            raise RuntimeError("Deepgram plugin unavailable for TTS lane")

        if self._deepgram_tts is None:
            voice = _AURA_VOICE_BY_LANG.get(
                self.language.split("-")[0].lower(),
                os.getenv("DEEPGRAM_AURA_FALLBACK_VOICE", "aura-2-thalia-en"),
            )
            self._deepgram_tts = self._create_deepgram_tts(voice)

        if hasattr(self._deepgram_tts, "synthesize"):
            for kwargs in (
                {
                    "text": text,
                    "language": self.language,
                    "encoding": "linear16",
                    "sample_rate": self.sample_rate,
                    "speed": playback_rate,
                },
                {
                    "text": text,
                    "language": self.language,
                    "encoding": "linear16",
                    "sample_rate": self.sample_rate,
                },
                {"text": text, "language": self.language},
                {"text": text},
            ):
                try:
                    return self._deepgram_tts.synthesize(**kwargs)
                except TypeError:
                    continue
        raise RuntimeError("Deepgram TTS instance does not expose synthesize()")

    def _create_deepgram_tts(self, voice: str) -> Any:
        for kwargs in (
            {
                "model": voice,
                "encoding": "linear16",
                "sample_rate": self.sample_rate,
            },
            {"voice": voice, "encoding": "linear16", "sample_rate": self.sample_rate},
            {"model": voice},
            {"voice": voice},
            {},
        ):
            try:
                return deepgram.TTS(**kwargs)
            except TypeError:
                continue
        return deepgram.TTS()

    def _http(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30, sock_connect=5)
            )
        return self._http_session

    async def _synthesize_elevenlabs(self, text: str, playback_rate: float):
        """Stream raw PCM from ElevenLabs Flash v2.5, yielding frame-aligned byte blocks."""
        api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
        if not api_key:
            raise TtsApiError(
                provider="elevenlabs",
                code="missing_api_key",
                message="ElevenLabs API key not configured on agent",
            )

        voice = os.getenv("ELEVENLABS_VOICE_ID", _ELEVENLABS_DEFAULT_VOICE).strip()
        base_lang = self.language.split("-")[0].lower()

        body: dict[str, Any] = {"text": text, "model_id": _ELEVENLABS_MODEL}
        if base_lang in _ELEVENLABS_LANGS:
            body["language_code"] = base_lang
        # ElevenLabs supports 0.7-1.2 speed; used for mild backlog catch-up.
        speed = max(0.7, min(playback_rate, 1.2))
        if abs(speed - 1.0) > 0.01:
            body["voice_settings"] = {"speed": speed}

        url = (
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}/stream"
            f"?output_format=pcm_{self.sample_rate}"
        )
        # Yield only whole 20ms frames so _frames_from_chunk never zero-pads
        # mid-stream (padding inside the stream causes audible clicks).
        frame_bytes = max(1, int(self.sample_rate * 0.02)) * self.num_channels * 2
        buf = bytearray()

        async with self._http().post(
            url, json=body, headers={"xi-api-key": api_key}
        ) as resp:
            if resp.status != 200:
                detail = (await resp.text())[:200]
                code, message = classify_tts_api_error("elevenlabs", resp.status, detail)
                raise TtsApiError(
                    provider="elevenlabs",
                    code=code,
                    message=message,
                    http_status=resp.status,
                )
            async for chunk in resp.content.iter_chunked(4096):
                buf.extend(chunk)
                aligned = len(buf) - (len(buf) % frame_bytes)
                if aligned:
                    yield bytes(buf[:aligned])
                    del buf[:aligned]
        if buf:
            yield bytes(buf)

    async def _iter_audio_frames(self, synthesis: Any):
        value = await synthesis if inspect.isawaitable(synthesis) else synthesis
        if value is None:
            return

        if hasattr(value, "__aiter__"):
            async for chunk in value:
                async for frame in self._frames_from_chunk(chunk):
                    yield frame
            return

        if hasattr(value, "__iter__") and not isinstance(value, (bytes, bytearray, memoryview)):
            for chunk in value:
                async for frame in self._frames_from_chunk(chunk):
                    yield frame
            return

        async for frame in self._frames_from_chunk(value):
            yield frame

    async def _frames_from_chunk(self, chunk: Any):
        frame_cls = getattr(rtc, "AudioFrame", None)
        if frame_cls is not None and isinstance(chunk, frame_cls):
            yield chunk
            return

        maybe_frame = getattr(chunk, "frame", None)
        if frame_cls is not None and maybe_frame is not None and isinstance(maybe_frame, frame_cls):
            yield maybe_frame
            return

        audio_attr = getattr(chunk, "audio", None)
        if frame_cls is not None and audio_attr is not None and isinstance(audio_attr, frame_cls):
            yield audio_attr
            return

        if isinstance(chunk, (bytes, bytearray, memoryview)):
            for frame in self._pcm_to_frames(bytes(chunk)):
                if frame is not None:
                    yield frame
            return

        # Unknown chunk type: ignore quietly to keep lane resilient.
        logger.debug("[TTS:%s] ignoring unsupported synth chunk type=%s", self.language, type(chunk).__name__)

    def _pcm_to_frames(self, payload: bytes):
        frame_cls = getattr(rtc, "AudioFrame", None)
        if frame_cls is None or not payload:
            return

        samples_per_channel = max(1, int(self.sample_rate * 0.02))  # 20ms frames
        frame_bytes = samples_per_channel * self.num_channels * 2
        for offset in range(0, len(payload), frame_bytes):
            chunk = payload[offset : offset + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + (b"\x00" * (frame_bytes - len(chunk)))
            frame = self._make_audio_frame(chunk, samples_per_channel)
            if frame is not None:
                yield frame

    def _make_audio_frame(self, data: bytes, samples_per_channel: int):
        frame_cls = getattr(rtc, "AudioFrame", None)
        if frame_cls is None:
            return None
        for kwargs in (
            {
                "data": data,
                "sample_rate": self.sample_rate,
                "num_channels": self.num_channels,
                "samples_per_channel": samples_per_channel,
            },
            {
                "data": data,
                "sample_rate": self.sample_rate,
                "num_channels": self.num_channels,
            },
        ):
            try:
                return frame_cls(**kwargs)
            except TypeError:
                continue
        try:
            return frame_cls(data, self.sample_rate, self.num_channels, samples_per_channel)
        except Exception:  # noqa: BLE001
            return None

    async def _capture_frame(self, frame: Any) -> None:
        if self._audio_source is None:
            return
        result = self._audio_source.capture_frame(frame)
        if inspect.isawaitable(result):
            await result

    async def _emit_tts_event(self, event_type: str, speaker_id: str) -> None:
        await self._publish_tts_data(
            {
                "type": event_type,
                "speaker_id": speaker_id,
                "language": self.language,
            }
        )

    async def _emit_tts_error(
        self,
        *,
        speaker_id: str,
        provider: str,
        code: str,
        message: str,
        http_status: int | None = None,
    ) -> None:
        sig = f"{provider}:{code}:{http_status}"
        now = self._now()
        if sig == self._last_error_sig and (now - self._last_error_at) < 10.0:
            return
        self._last_error_sig = sig
        self._last_error_at = now
        await self._publish_tts_data(
            {
                "type": "tts_error",
                "speaker_id": speaker_id,
                "language": self.language,
                "provider": provider,
                "code": code,
                "message": message,
                "http_status": http_status,
                "timestamp": time.time(),
            }
        )

    async def _publish_tts_data(self, payload_dict: dict[str, Any]) -> None:
        if self.room is None or getattr(self.room, "local_participant", None) is None:
            return
        payload = json.dumps(payload_dict).encode("utf-8")
        try:
            await self.room.local_participant.publish_data(
                payload,
                topic="transcription",
                reliable=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("[TTS:%s] data event emit failed: %s", self.language, exc)

    async def _ensure_track_published(self) -> None:
        if self.room is None or getattr(self.room, "local_participant", None) is None:
            raise RuntimeError("TTS lane cannot publish without room.local_participant")
        if self._publication is not None:
            return

        audio_source_cls = getattr(rtc, "AudioSource", None)
        local_track_cls = getattr(rtc, "LocalAudioTrack", None)
        if audio_source_cls is None or local_track_cls is None:
            raise RuntimeError("LiveKit rtc.AudioSource/LocalAudioTrack unavailable")

        try:
            self._audio_source = audio_source_cls(
                sample_rate=self.sample_rate,
                num_channels=self.num_channels,
            )
        except TypeError:
            self._audio_source = audio_source_cls(self.sample_rate, self.num_channels)

        if hasattr(local_track_cls, "create_audio_track"):
            self._local_track = local_track_cls.create_audio_track(
                self.track_name,
                self._audio_source,
            )
        else:
            self._local_track = local_track_cls(self.track_name, self._audio_source)

        publish_fn = self.room.local_participant.publish_track
        track_opts_cls = getattr(rtc, "TrackPublishOptions", None)
        if track_opts_cls is not None:
            try:
                opts = track_opts_cls(
                    source=getattr(rtc.TrackSource, "SOURCE_MICROPHONE", None),
                    name=self.track_name,
                )
                self._publication = await publish_fn(self._local_track, opts)
                return
            except TypeError:
                pass
            except Exception:
                # Fall through to call without options.
                pass

        self._publication = await publish_fn(self._local_track)

    async def _unpublish_track(self) -> None:
        if self.room is None or self._local_track is None:
            return
        local_participant = getattr(self.room, "local_participant", None)
        if local_participant is None:
            return

        sid = getattr(self._local_track, "sid", None)
        for method_name in ("unpublish_track", "unpublish"):
            fn = getattr(local_participant, method_name, None)
            if fn is None:
                continue
            try:
                if sid:
                    result = fn(sid)
                else:
                    result = fn(self._local_track)
                if inspect.isawaitable(result):
                    await result
                break
            except Exception:  # noqa: BLE001
                continue

    async def _close_audio_source(self) -> None:
        src = self._audio_source
        self._audio_source = None
        if src is None:
            return
        for method_name in ("aclose", "close"):
            method = getattr(src, method_name, None)
            if method is None:
                continue
            try:
                result = method()
                if inspect.isawaitable(result):
                    await result
            except Exception:  # noqa: BLE001
                pass
            break
