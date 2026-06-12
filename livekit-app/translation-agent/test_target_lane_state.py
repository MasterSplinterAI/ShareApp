"""Tests for TargetLaneState display semantics (frozen + tail + interim precedence)."""

from transcription_only_agent import TargetLaneState


def make_lane(**kwargs) -> TargetLaneState:
    defaults = dict(
        target_lang="es",
        is_same_language=False,
        llm_instance=None,
        target_lang_name="Spanish",
    )
    defaults.update(kwargs)
    return TargetLaneState(**defaults)


class TestDisplayTranslation:
    def test_empty_lane(self):
        assert make_lane().display_translation() == ""

    def test_tail_only(self):
        lane = make_lane()
        lane.tail_translation = "Hola a todos."
        assert lane.display_translation() == "Hola a todos."

    def test_frozen_plus_tail(self):
        lane = make_lane()
        lane.frozen_tgt = "Hola a todos."
        lane.tail_translation = "¿Cómo están?"
        assert lane.display_translation() == "Hola a todos. ¿Cómo están?"

    def test_interim_shown_when_no_tail(self):
        lane = make_lane()
        lane.interim_stable = "Hola a"
        assert lane.display_translation() == "Hola a"

    def test_longer_interim_wins_over_shorter_streaming_tail(self):
        # While a FINAL re-translation streams from scratch, the already-displayed
        # interim text must not disappear (captions never shrink).
        lane = make_lane()
        lane.interim_stable = "Hola a todos los"
        lane.tail_translation = "Hola"
        assert lane.display_translation() == "Hola a todos los"

    def test_longer_tail_wins_over_interim(self):
        lane = make_lane()
        lane.interim_stable = "Hola"
        lane.tail_translation = "Hola a todos."
        assert lane.display_translation() == "Hola a todos."


class TestResetTurn:
    def test_clears_turn_state_keeps_context(self):
        lane = make_lane()
        lane.frozen_src = "Hello."
        lane.frozen_tgt = "Hola."
        lane.tail_translation = "x"
        lane.interim_candidate = "y"
        lane.interim_stable = "z"
        lane.last_interim_src = "w"
        lane.context_pairs.append(("Hello.", "Hola."))
        lane.reset_turn()
        assert lane.display_translation() == ""
        assert lane.frozen_src == "" and lane.frozen_tgt == ""
        # Rolling cross-turn context survives turn resets by design.
        assert list(lane.context_pairs) == [("Hello.", "Hola.")]
