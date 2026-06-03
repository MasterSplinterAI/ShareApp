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


if __name__ == "__main__":
    unittest.main()
