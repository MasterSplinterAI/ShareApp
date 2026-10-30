import unittest

from transcript_assembler import (
    TimedTranscriptAssembler,
    segment_delta_from_words,
    segment_delta_string,
    stitch_committed_and_open,
    words_from_text,
)


class FakeTimedString(str):
    """Mimics LiveKit TimedString: str subclass with start/end times, no .text attr."""

    def __new__(cls, text: str, *, start_time: float, end_time: float):
        obj = str.__new__(cls, text)
        obj.start_time = start_time
        obj.end_time = end_time
        return obj


def timed_words_from_text(text: str, *, start: float = 0.0, step: float = 0.2) -> list[FakeTimedString]:
    words: list[FakeTimedString] = []
    t = start
    for word in text.split():
        words.append(FakeTimedString(word, start_time=t, end_time=t + step))
        t += step
    return words


class TimedTranscriptAssemblerTest(unittest.TestCase):
    def test_timed_string_words_are_read_not_dropped(self):
        assembler = TimedTranscriptAssembler()
        assembler.commit(timed_words_from_text("hello world", start=0.0, step=0.2))
        self.assertEqual(assembler.text(), "hello world")

    def test_overlapping_chunk_finals_replace_by_word_time_not_append(self):
        assembler = TimedTranscriptAssembler()

        assembler.commit(words_from_text("Okay very good so on the", start=0.0, step=0.2))
        assembler.commit(words_from_text("Okay very good so when the person's speaking", start=0.0, step=0.2))

        self.assertEqual(
            assembler.text(),
            "Okay very good so when the person's speaking",
        )

    def test_overlapping_timed_string_chunk_finals_do_not_duplicate(self):
        assembler = TimedTranscriptAssembler()

        assembler.commit(timed_words_from_text("Okay very good so on the", start=0.0, step=0.2))
        assembler.commit(
            timed_words_from_text("Okay very good so when the person's speaking", start=0.0, step=0.2)
        )

        self.assertEqual(
            assembler.text(),
            "Okay very good so when the person's speaking",
        )
        self.assertNotIn("Okay Okay", assembler.text())

    def test_commit_with_delta_returns_new_tail_after_overlap(self):
        assembler = TimedTranscriptAssembler()

        assembler.commit(words_from_text("Okay very good so on the", start=0.0, step=0.2))
        full, delta = assembler.commit_with_delta(
            words_from_text("Okay very good so when the person's speaking", start=0.0, step=0.2),
            "Okay very good so when the person's speaking",
        )

        self.assertEqual(full, "Okay very good so when the person's speaking")
        self.assertEqual(delta, "when the person's speaking")

    def test_live_interim_replaces_open_chunk_without_poisoning_committed_text(self):
        assembler = TimedTranscriptAssembler()

        assembler.commit(words_from_text("Let's check it out", start=0.0, step=0.2))
        self.assertEqual(
            assembler.live_text(words_from_text("Let's check it out one more time", start=0.0, step=0.2)),
            "Let's check it out one more time",
        )
        self.assertEqual(
            assembler.live_text(words_from_text("We're going to talk about financing", start=1.0, step=0.2)),
            "Let's check it out We're going to talk about financing",
        )
        self.assertEqual(assembler.text(), "Let's check it out")

    def test_repeated_phrase_later_in_turn_is_not_collapsed_when_time_is_new(self):
        assembler = TimedTranscriptAssembler()

        assembler.commit(words_from_text("Let's check it out", start=0.0, step=0.2))
        assembler.commit(words_from_text("Let's check it out", start=2.0, step=0.2))

        self.assertEqual(
            assembler.text(),
            "Let's check it out Let's check it out",
        )


class StitchAndDeltaTest(unittest.TestCase):
    def test_stitch_committed_and_open_overlapping_chunk_interim(self):
        committed = "Okay very good so on the"
        open_text = "Okay very good so when the person's speaking"
        self.assertEqual(
            stitch_committed_and_open(committed, open_text),
            "Okay very good so when the person's speaking",
        )

    def test_stitch_does_not_duplicate_full_phrase(self):
        committed = "Okay very good so on the"
        open_text = "Okay very good so when the person's speaking"
        stitched = stitch_committed_and_open(committed, open_text)
        self.assertNotIn("Okay very good so on the Okay", stitched)

    def test_segment_delta_string_suffix(self):
        self.assertEqual(
            segment_delta_string(
                "Okay very good so on the",
                "Okay very good so when the person's speaking",
                "Okay very good so when the person's speaking",
            ),
            "when the person's speaking",
        )


if __name__ == "__main__":
    unittest.main()
