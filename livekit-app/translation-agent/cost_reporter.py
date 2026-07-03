"""
Fire-and-forget cost telemetry from agent to backend /api/cost-events.

Never raises — a cost-event failure must never interrupt the translation pipeline.
"""

import asyncio
import logging
import os

import aiohttp

logger = logging.getLogger(__name__)

# Maps STT provider name → backend event_type (per costConstants.js)
_STT_EVENT_TYPES = {
    "deepgram": "deepgram_stt_minute",
    "openai": "openai_stt_minute",
    "gladia": "gladia_stt_minute",
}

# Maps LLM provider name → (input_event_type, output_event_type)
_LLM_EVENT_TYPES = {
    "openai": ("openai_llm_input_mtok", "openai_llm_output_mtok"),
}

_TTS_EVENT_TYPES = {
    "deepgram": "deepgram_tts_char",
    "elevenlabs": "elevenlabs_tts_char",
}

_warned_once = False


class CostReporter:
    """Posts cost events to the backend. Becomes a no-op if env vars are missing."""

    def __init__(self, meeting_id: str, org_id=None):
        global _warned_once
        self.meeting_id = meeting_id
        self.org_id = org_id

        backend_url = os.getenv("BACKEND_BASE_URL", "").strip()
        secret = os.getenv("COST_EVENT_SECRET", "").strip()

        if not backend_url or not secret:
            if not _warned_once:
                _warned_once = True
                missing = [v for v, val in [("BACKEND_BASE_URL", backend_url), ("COST_EVENT_SECRET", secret)] if not val]
                logger.warning(
                    f"CostReporter: {', '.join(missing)} not set — cost events disabled for this session"
                )
            self._enabled = False
            return

        self._url = f"{backend_url.rstrip('/')}/api/cost-events"
        self._secret = secret
        self._enabled = True
        self._session: aiohttp.ClientSession | None = None

    def _get_session(self) -> aiohttp.ClientSession:
        # One session for the agent's lifetime — a fresh session per event churns
        # sockets/TLS on every turn and can exhaust file descriptors under load.
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=5)
            )
        return self._session

    async def aclose(self) -> None:
        if getattr(self, "_session", None) is not None and not self._session.closed:
            try:
                await self._session.close()
            except Exception:
                pass

    async def _post(self, event_type: str, units: float, meta: dict | None = None) -> None:
        payload: dict = {
            "meeting_id": self.meeting_id,
            "org_id": self.org_id,
            "event_type": event_type,
            "units": units,
        }
        if meta:
            payload["meta"] = meta
        try:
            session = self._get_session()
            async with session.post(
                self._url,
                json=payload,
                headers={"X-Cost-Secret": self._secret},
            ) as resp:
                if resp.status not in (200, 201):
                    body = await resp.text()
                    logger.warning(
                        f"CostReporter: {event_type} → HTTP {resp.status}: {body[:200]}"
                    )
        except Exception as exc:
            logger.warning(f"CostReporter: emit {event_type} failed: {exc}")

    async def emit_stt(
        self,
        duration_seconds: float,
        provider: str,
        participant: str,
        language: str,
    ) -> None:
        if not self._enabled or duration_seconds <= 0:
            return
        event_type = _STT_EVENT_TYPES.get(provider)
        if not event_type:
            logger.debug(f"CostReporter: no STT event type for provider={provider!r} — skipping")
            return
        await self._post(
            event_type,
            duration_seconds / 60.0,
            meta={"participant": participant, "language": language, "provider": provider},
        )

    async def emit_llm(
        self,
        input_tokens: int,
        output_tokens: int,
        provider: str,
        participant: str,
        model: str,
    ) -> None:
        if not self._enabled:
            return
        pair = _LLM_EVENT_TYPES.get(provider)
        if not pair:
            logger.debug(f"CostReporter: no LLM event type for provider={provider!r} — skipping")
            return
        in_event, out_event = pair
        meta = {"participant": participant, "model": model, "provider": provider}
        if input_tokens > 0:
            await self._post(in_event, input_tokens / 1_000_000, meta=meta)
        if output_tokens > 0:
            await self._post(out_event, output_tokens / 1_000_000, meta=meta)

    async def emit_tts(
        self,
        chars: int,
        provider: str,
        language: str,
        participant: str,
    ) -> None:
        if not self._enabled or chars <= 0:
            return
        event_type = _TTS_EVENT_TYPES.get(provider)
        if not event_type:
            logger.debug(f"CostReporter: no TTS event type for provider={provider!r} — skipping")
            return
        await self._post(
            event_type,
            float(chars),
            meta={"participant": participant, "language": language, "provider": provider},
        )
