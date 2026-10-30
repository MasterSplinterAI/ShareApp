import unittest

from deepgram_caption_buffer import DeepgramCaptionBuffer


class DeepgramCaptionBufferTest(unittest.TestCase):
    def test_interim_over_committed_without_duplication(self):
        buf = DeepgramCaptionBuffer()
        buf.final_segments.append("Hello")
        live = buf.on_interim("Hello world")
        self.assertEqual(live, "Hello world")
        self.assertNotIn("Hello Hello", live)

    def test_append_final_segments_per_deepgram_docs(self):
        buf = DeepgramCaptionBuffer()
        _, i1, s1 = buf.on_final_segment("Tell me more")
        _, i2, s2 = buf.on_final_segment("about this.")
        self.assertEqual(i1, 0)
        self.assertEqual(i2, 1)
        self.assertEqual(s1, "Tell me more")
        self.assertEqual(s2, "about this.")
        self.assertEqual(buf.committed_text(), "Tell me more about this.")

    def test_cumulative_final_appends_tail_only(self):
        buf = DeepgramCaptionBuffer()
        buf.on_final_segment("Hello")
        live, idx, seg = buf.on_final_segment("Hello world")
        self.assertEqual(idx, 1)
        self.assertEqual(seg, "world")
        self.assertEqual(buf.committed_text(), "Hello world")
        self.assertEqual(live, "Hello world")

    def test_speech_final_clears_open_interim(self):
        buf = DeepgramCaptionBuffer()
        buf.on_final_segment("Done.")
        buf.on_interim("Done. extra")
        utterance = buf.on_speech_final()
        self.assertEqual(utterance, "Done.")
        self.assertEqual(buf.live_text(), "Done.")

    def test_commit_pending_interim_preserves_unfinalized_trailing_speech(self):
        buf = DeepgramCaptionBuffer()
        buf.on_final_segment("First part of the thought,")
        buf.on_interim("and the trailing words after a pause")
        utterance = buf.commit_pending_interim()
        self.assertEqual(
            utterance,
            "First part of the thought, and the trailing words after a pause",
        )
        self.assertEqual(buf.open_interim, "")

    def test_commit_pending_interim_preserves_interim_only_utterance(self):
        buf = DeepgramCaptionBuffer()
        buf.on_interim("Short reply before is_final")
        utterance = buf.commit_pending_interim()
        self.assertEqual(utterance, "Short reply before is_final")

    def test_gladia_utterance_final_replaces_buffer(self):
        buf = DeepgramCaptionBuffer()
        buf.on_interim("Hello there")
        live, idx, seg = buf.on_utterance_final("Hello there friend")
        self.assertEqual(idx, 0)
        self.assertEqual(seg, "Hello there friend")
        self.assertEqual(live, "Hello there friend")
        self.assertEqual(buf.committed_text(), "Hello there friend")

    def test_gladia_duplicate_final_is_noop(self):
        buf = DeepgramCaptionBuffer()
        buf.on_utterance_final("Same line.")
        _, idx, seg = buf.on_utterance_final("Same line.")
        self.assertEqual(idx, -1)
        self.assertEqual(seg, "")


if __name__ == "__main__":
    unittest.main()
