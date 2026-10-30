"""Demo room AI teammate orchestration — runs inside the translation agent process."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Any, Awaitable, Callable, Optional

import aiohttp

logger = logging.getLogger(__name__)

PublishFn = Callable[[dict, bool], Awaitable[None]]
GetTtsLaneFn = Callable[[str], Any]
PhaseFn = Callable[[str, Optional[str]], Awaitable[None]]


def _backend_url() -> str:
    return (os.getenv("BACKEND_BASE_URL") or "http://127.0.0.1:3001").rstrip("/")


def _orchestrator_secret() -> str:
    return os.getenv("DEMO_ORCHESTRATOR_SECRET", "").strip()


def _split_partials(text: str, steps: int = 4) -> list[str]:
    if not text or len(text) < 10:
        return [text]
    words = text.split()
    if len(words) <= steps:
        return [" ".join(words[: i + 1]) for i in range(len(words))]
    chunk = max(1, len(words) // steps)
    out: list[str] = []
    for i in range(1, steps + 1):
        out.append(" ".join(words[: i * chunk]))
    deduped: list[str] = []
    for part in out:
        if part and (not deduped or deduped[-1] != part):
            deduped.append(part)
    return deduped or [text]


class DemoRoomOrchestrator:
    """Calls backend LLM orchestrator and publishes agent captions + pipeline TTS."""

    def __init__(
        self,
        *,
        demo_session_id: str,
        read_lang: str,
        publish_caption: PublishFn,
        get_tts_lane: GetTtsLaneFn,
        on_phase: Optional[PhaseFn] = None,
        agent_names: Optional[set[str]] = None,
    ) -> None:
        self.demo_session_id = demo_session_id
        self.read_lang = (read_lang or "en").split("-")[0].lower()
        self.publish_caption = publish_caption
        self.get_tts_lane = get_tts_lane
        self.on_phase = on_phase
        self.agent_names = {n.lower() for n in (agent_names or set())}
        self._busy = False
        self._opening_sent = False
        self._processed_turns: set[str] = set()

    async def _set_phase(self, phase: str, active_speaker: Optional[str] = None) -> None:
        if self.on_phase:
            await self.on_phase(phase, active_speaker)

    async def schedule_opening(self, delay_sec: float = 2.5) -> None:
        if self._opening_sent:
            return

        async def _run() -> None:
            await asyncio.sleep(delay_sec)
            if self._opening_sent:
                return
            self._opening_sent = True
            await self._set_phase("opening", None)
            await self._orchestrate(trigger="opening")

        asyncio.create_task(_run())

    async def on_user_final(self, speaker_id: str, text: str, transcription_id: Optional[str]) -> None:
        if self._busy:
            return
        if not text or not text.strip():
            return
        sid = (speaker_id or "").lower()
        if sid in self.agent_names:
            return

        tid = transcription_id or f"{speaker_id}-{text[:32]}"
        if tid in self._processed_turns:
            return
        self._processed_turns.add(tid)

        await self._orchestrate(user_text=text.strip())

    async def _orchestrate(self, *, user_text: Optional[str] = None, trigger: Optional[str] = None) -> None:
        if self._busy:
            return
        self._busy = True
        if trigger != "opening":
            await self._set_phase("processing", None)

        url = f"{_backend_url()}/api/demo/orchestrate"
        headers = {"Content-Type": "application/json"}
        secret = _orchestrator_secret()
        if secret:
            headers["X-Demo-Orchestrator-Secret"] = secret

        payload = {"demoSessionId": self.demo_session_id}
        if user_text:
            payload["userText"] = user_text
        if trigger:
            payload["trigger"] = trigger

        try:
            timeout = aiohttp.ClientTimeout(total=35)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, json=payload, headers=headers) as resp:
                    if resp.status >= 400:
                        body = await resp.text()
                        logger.warning("Demo orchestrate failed %s: %s", resp.status, body[:200])
                        await self._set_phase("your_turn", None)
                        return
                    data = await resp.json()

            agent_lines = data.get("agentLines") or []
            if agent_lines:
                await self._play_agent_lines(agent_lines)
            elif not data.get("complete"):
                await self._set_phase("your_turn", None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Demo orchestrate request error: %s", exc)
            await self._set_phase("your_turn", None)
        finally:
            self._busy = False

    async def _play_agent_lines(self, agent_lines: list[dict]) -> None:
        await self._set_phase("agent_speaking", None)
        for line in agent_lines:
            speaker = line.get("speaker") or "Agent"
            original = (line.get("originalText") or "").strip()
            primary = (line.get("primary") or original).strip()
            source_lang = (line.get("sourceLang") or "en").split("-")[0].lower()
            target_lang = self.read_lang
            if not original:
                continue

            await self._set_phase("agent_speaking", speaker)
            await self._publish_agent_sequence(
                speaker_id=speaker,
                original_text=original,
                translated_text=primary,
                source_lang=source_lang,
                target_lang=target_lang,
            )

            tts_lane = self.get_tts_lane(target_lang)
            if tts_lane is not None and primary:
                try:
                    await tts_lane.enqueue_final(speaker_id=speaker, text=primary)
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Demo TTS enqueue failed for %s: %s", speaker, exc)

            await asyncio.sleep(0.25)

        await self._set_phase("your_turn", None)

    async def _publish_agent_sequence(
        self,
        *,
        speaker_id: str,
        original_text: str,
        translated_text: str,
        source_lang: str,
        target_lang: str,
    ) -> None:
        transcription_id = f"{speaker_id}-demo-{int(time.time() * 1000)}"
        has_translation = (
            source_lang != target_lang
            and original_text
            and translated_text
            and original_text.strip() != translated_text.strip()
        )

        orig_steps = _split_partials(original_text)
        trans_steps = _split_partials(translated_text) if has_translation else orig_steps

        for i, orig_part in enumerate(orig_steps):
            trans_part = trans_steps[i] if i < len(trans_steps) else trans_steps[-1]
            await self.publish_caption(
                {
                    "type": "transcription",
                    "participant_id": speaker_id,
                    "originalText": orig_part,
                    "text": trans_part if has_translation else orig_part,
                    "language": target_lang,
                    "sourceLanguage": source_lang,
                    "partial": True,
                    "final": False,
                    "timestamp": asyncio.get_event_loop().time(),
                    "transcriptionId": transcription_id,
                    "sttProvider": "demo",
                },
                False,
            )
            await asyncio.sleep(0.14)

        await self.publish_caption(
            {
                "type": "transcription",
                "participant_id": speaker_id,
                "originalText": original_text,
                "text": translated_text if has_translation else original_text,
                "language": target_lang,
                "sourceLanguage": source_lang,
                "partial": False,
                "final": True,
                "hasTranslation": has_translation,
                "timestamp": asyncio.get_event_loop().time(),
                "transcriptionId": transcription_id,
                "sttProvider": "demo",
            },
            True,
        )
