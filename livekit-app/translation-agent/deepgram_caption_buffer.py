"""
Deepgram streaming caption assembly (canonical model).

Per Deepgram docs (interim_results + endpointing):
- is_final=false  → preliminary text for the open segment; update live UI only.
- is_final=true   → append segment to the utterance buffer.
- speech_final      → utterance complete (LiveKit: END_OF_SPEECH); commit buffer.

https://developers.deepgram.com/docs/understand-endpointing-interim-results
"""

from __future__ import annotations

from dataclasses import dataclass, field

from transcript_assembler import stitch_committed_and_open


@dataclass
class DeepgramCaptionBuffer:
    """Per-speaker utterance buffer aligned with Deepgram is_final / speech_final."""

    final_segments: list[str] = field(default_factory=list)
    open_interim: str = ""
    last_final_end_time: float = -1.0

    def clear(self) -> None:
        self.final_segments.clear()
        self.open_interim = ""
        self.last_final_end_time = -1.0

    def committed_text(self) -> str:
        return " ".join(s for s in self.final_segments if s).strip()

    def live_text(self) -> str:
        committed = self.committed_text()
        open_text = self.open_interim.strip()
        if not open_text:
            return committed
        if not committed:
            return open_text
        return stitch_committed_and_open(committed, open_text)

    def has_content(self) -> bool:
        return bool(self.live_text().strip())

    def on_interim(self, text: str) -> str:
        """Store is_final=false hypothesis; return full live line for UI."""
        self.open_interim = text.strip()
        return self.live_text()

    def on_final_segment(
        self,
        text: str,
        *,
        start_time: float = 0.0,
        end_time: float = 0.0,
    ) -> tuple[str, int, str]:
        """
        Append an is_final=true segment. Returns (live_text, seg_idx, segment_for_translation).
        seg_idx is -1 when the segment is deduplicated.
        """
        text = text.strip()
        if not text:
            return self.live_text(), -1, ""

        committed = self.committed_text()

        if committed == text:
            self.open_interim = ""
            return self.live_text(), -1, ""

        segment = text
        if committed and text.startswith(committed + " "):
            segment = text[len(committed) :].strip()
            if not segment:
                self.open_interim = ""
                return self.live_text(), -1, ""
        elif committed and text.startswith(committed):
            segment = text[len(committed) :].strip()
            if not segment:
                self.open_interim = ""
                return self.live_text(), -1, ""

        if self.final_segments and self.final_segments[-1] == segment:
            self.open_interim = ""
            return self.live_text(), -1, ""

        if self.final_segments and (
            segment.startswith(self.final_segments[-1] + " ")
            or segment.startswith(self.final_segments[-1])
        ):
            self.final_segments[-1] = segment
            seg_idx = len(self.final_segments) - 1
        else:
            self.final_segments.append(segment)
            seg_idx = len(self.final_segments) - 1

        self.open_interim = ""
        if end_time > 0:
            self.last_final_end_time = end_time
        elif start_time > 0:
            self.last_final_end_time = max(self.last_final_end_time, start_time)

        return self.live_text(), seg_idx, segment

    def on_speech_final(self) -> str:
        """speech_final / END_OF_SPEECH — drop open interim; committed text is the utterance."""
        self.open_interim = ""
        return self.committed_text()

    def on_utterance_final(self, text: str) -> tuple[str, int, str]:
        """
        Gladia-style finals: one full utterance per event (not Deepgram incremental segments).
        Replaces the buffer with the utterance text.
        """
        text = text.strip()
        if not text:
            return self.live_text(), -1, ""

        committed = self.committed_text()
        if committed == text:
            self.open_interim = ""
            return self.live_text(), -1, ""

        self.final_segments = [text]
        self.open_interim = ""
        return self.committed_text(), 0, text
