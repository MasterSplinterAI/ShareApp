"""Measure application audio accepted by one STT stream."""


class MeteredSttInput:
    """Count accepted PCM, including silence, without counting idle wall time.

    This measures application input, not a provider's final billed quantity:
    provider plugins may buffer or replay audio internally. Each replacement
    stream gets its own counter, so provider fallback retains separate usage.
    """

    def __init__(self, stream):
        self._stream = stream
        self.duration_seconds = 0.0

    def push_frame(self, frame) -> None:
        self._stream.push_frame(frame)
        self.duration_seconds += frame.samples_per_channel / frame.sample_rate
