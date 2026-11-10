"""xAI streaming STT with language auto-detect.

`livekit.plugins.xai.STT` defaults `language="en"` and always puts that value
on the WebSocket query string. xAI's grok-voice-transcribe-2.0 only follows
mid-stream language switches when `language` is omitted. This module builds
the query without that parameter unless multilingual mode is turned off.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import aiohttp


def xai_stt_multilingual_enabled() -> bool:
    """True unless XAI_STT_MULTILINGUAL is explicitly disabled."""
    raw = os.getenv("XAI_STT_MULTILINGUAL", "true").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def xai_websocket_params(
    *,
    sample_rate: int,
    interim_results: bool,
    diarize: bool,
    endpointing: int,
    language: str | None = None,
    multilingual: bool = True,
) -> list[tuple[str, str]]:
    """Query params for wss://api.x.ai/v1/stt.

    Multilingual mode omits `language` so the model detects the spoken
    language and can switch mid-stream. A fixed language is only sent when
    multilingual mode is off. A list of pairs matches livekit-plugins-xai
    1.8.11, which repeats `keyterm`.
    """
    params = [
        ("encoding", "pcm"),
        ("sample_rate", str(sample_rate)),
        ("interim_results", str(bool(interim_results)).lower()),
        ("diarize", str(bool(diarize)).lower()),
        ("endpointing", str(endpointing)),
    ]
    if not multilingual and language:
        params.append(("language", str(language)))
    return params


def build_xai_streaming_stt(
    *,
    endpointing: int = 800,
    multilingual: bool | None = None,
    language: str | None = None,
) -> Any:
    """Return an xAI STT instance whose stream omits `language` when multilingual."""
    from livekit.agents import APIConnectOptions, APIConnectionError, DEFAULT_API_CONNECT_OPTIONS
    from livekit.agents.types import NOT_GIVEN, NotGivenOr
    from livekit.plugins.xai.stt import STT, SpeechStream, XAI_WEBSOCKET_URL

    auto_detect = xai_stt_multilingual_enabled() if multilingual is None else multilingual

    class _AutoDetectStream(SpeechStream):
        async def _connect_ws(self) -> aiohttp.ClientWebSocketResponse:
            # livekit-plugins-xai 1.8.11 SpeechStream._run calls this method.
            # The stock implementation always appends language=en. Drop that
            # pair in multilingual mode and keep the rest of the plugin params.
            from livekit.agents import APIStatusError
            from livekit.agents.utils import is_given

            params = xai_websocket_params(
                sample_rate=self._opts.sample_rate,
                interim_results=self._opts.enable_interim_results,
                diarize=self._opts.enable_diarization,
                endpointing=self._opts.endpointing,
                language=str(self._opts.language) if self._opts.language else None,
                multilingual=auto_detect,
            )
            if is_given(getattr(self._opts, "vad_threshold", NOT_GIVEN)):
                params.append(("vad_threshold", str(self._opts.vad_threshold)))
            if is_given(getattr(self._opts, "smart_turn", NOT_GIVEN)):
                params.append(("smart_turn", str(self._opts.smart_turn)))
            if is_given(getattr(self._opts, "smart_turn_timeout", NOT_GIVEN)):
                params.append(("smart_turn_timeout", str(self._opts.smart_turn_timeout)))
            if is_given(getattr(self._opts, "keyterm", NOT_GIVEN)):
                params.extend(("keyterm", term) for term in self._opts.keyterm)
            try:
                return await asyncio.wait_for(
                    self._session.ws_connect(
                        XAI_WEBSOCKET_URL,
                        headers={"Authorization": f"Bearer {self._api_key}"},
                        params=params,
                        autoping=False,
                    ),
                    self._conn_options.timeout,
                )
            except asyncio.TimeoutError as exc:
                raise APIConnectionError("failed to connect to xAI") from exc
            except aiohttp.ClientResponseError as exc:
                raise APIStatusError(
                    message=exc.message,
                    status_code=exc.status,
                    request_id=None,
                    body=None,
                ) from None
            except aiohttp.ClientConnectorError as exc:
                raise APIConnectionError("failed to connect to xAI") from exc

    class _AutoDetectSTT(STT):
        def stream(
            self,
            *,
            language: NotGivenOr[str] = NOT_GIVEN,
            conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        ) -> SpeechStream:
            config = self._sanitize_options(language=language)
            stream = _AutoDetectStream(
                stt=self,
                conn_options=conn_options,
                opts=config,
                api_key=self._api_key,
                http_session=self._ensure_session(),
            )
            self._streams.add(stream)
            return stream

    # The plugin constructor requires a language string. Multilingual streams
    # ignore it and leave the query parameter off.
    kwargs: dict[str, Any] = dict(
        sample_rate=16000,
        enable_interim_results=True,
        endpointing=endpointing,
        language=(language or "en") if not auto_detect else "en",
    )
    try:
        return _AutoDetectSTT(**kwargs)
    except TypeError:
        kwargs.pop("endpointing", None)
        return _AutoDetectSTT(**kwargs)
