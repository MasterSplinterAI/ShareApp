"""STT usage measures accepted PCM duration, including silent audio."""
import asyncio
from types import SimpleNamespace

import pytest

from stt_audio_meter import MeteredSttInput


class Sink:
    def __init__(self):
        self.frames = []
        self.reject = False

    def push_frame(self, frame):
        if self.reject:
            raise RuntimeError("stream closed")
        self.frames.append(frame)


def frame(samples, rate, channels=1, silent=False):
    return SimpleNamespace(samples_per_channel=samples, sample_rate=rate,
                           num_channels=channels,
                           data=bytes(samples * channels * 2) if silent else b"speech")


def test_received_silence_counts_as_streamed_audio():
    sink = Sink()
    meter = MeteredSttInput(sink)
    audio = frame(16000, 16000, silent=True)
    meter.push_frame(audio)
    assert sink.frames == [audio]
    assert meter.duration_seconds == 1.0


def test_duration_uses_each_frames_sample_rate_without_multiplying_channels():
    meter = MeteredSttInput(Sink())
    meter.push_frame(frame(160, 16000))
    meter.push_frame(frame(480, 48000, channels=2))
    meter.push_frame(frame(24000, 24000))
    assert meter.duration_seconds == pytest.approx(1.02)


def test_no_frame_gaps_add_no_usage():
    async def run():
        meter = MeteredSttInput(Sink())
        await asyncio.sleep(0.01)
        assert meter.duration_seconds == 0.0
        meter.push_frame(frame(160, 16000))
        await asyncio.sleep(0.01)
        assert meter.duration_seconds == 0.01
    asyncio.run(run())


def test_rejected_push_does_not_add_usage():
    sink = Sink()
    meter = MeteredSttInput(sink)
    meter.push_frame(frame(16000, 16000))
    sink.reject = True
    with pytest.raises(RuntimeError, match="stream closed"):
        meter.push_frame(frame(32000, 16000))
    assert len(sink.frames) == 1
    assert meter.duration_seconds == 1.0


def test_restart_or_provider_fallback_starts_a_separate_counter():
    first = MeteredSttInput(Sink())
    first.push_frame(frame(16000, 16000))
    replacement = MeteredSttInput(Sink())
    assert replacement.duration_seconds == 0.0
    replacement.push_frame(frame(8000, 16000))
    assert first.duration_seconds + replacement.duration_seconds == 1.5
