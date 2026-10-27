"""Tests for translation_helpers (cache, local agreement, freeze, prompt building)."""

from translation_helpers import (
    TranslationCache,
    build_translation_messages,
    context_pairs_for_translation_call,
    ends_sentence,
    join_nonempty,
    llm_completion_token_cap,
    should_break_turn,
    should_handoff_turn,
    split_tail,
    stable_common_prefix,
    stt_idle_timeout_ms,
    tts_remainder,
)


# ---------------------------------------------------------------- cache

class TestTranslationCache:
    def test_miss_then_hit(self):
        c = TranslationCache(max_size=4)
        assert c.get("en", "es", "Hello there.") is None
        c.put("en", "es", "Hello there.", "Hola.")
        assert c.get("en", "es", "Hello there.") == "Hola."

    def test_key_normalizes_whitespace_and_case(self):
        c = TranslationCache(max_size=4)
        c.put("en", "es", "  Hello   THERE. ", "Hola.")
        assert c.get("en", "es", "hello there.") == "Hola."

    def test_language_pair_isolated(self):
        c = TranslationCache(max_size=4)
        c.put("en", "es", "Hello.", "Hola.")
        assert c.get("en", "fr", "Hello.") is None

    def test_lru_eviction(self):
        c = TranslationCache(max_size=2)
        c.put("en", "es", "one", "uno")
        c.put("en", "es", "two", "dos")
        # touch "one" so "two" is the LRU entry
        assert c.get("en", "es", "one") == "uno"
        c.put("en", "es", "three", "tres")
        assert c.get("en", "es", "two") is None
        assert c.get("en", "es", "one") == "uno"
        assert c.get("en", "es", "three") == "tres"

    def test_zero_size_disables(self):
        c = TranslationCache(max_size=0)
        c.put("en", "es", "Hello.", "Hola.")
        assert c.get("en", "es", "Hello.") is None

    def test_empty_text_never_cached(self):
        c = TranslationCache(max_size=4)
        c.put("en", "es", "   ", "x")
        assert c.get("en", "es", "   ") is None


# ------------------------------------------------- local agreement (LA-2)

class TestStableCommonPrefix:
    def test_identical(self):
        assert stable_common_prefix("hola que tal", "hola que tal") == "hola que tal"

    def test_diverging_tail(self):
        assert stable_common_prefix("hola que tal amigo", "hola que tal señor") == "hola que tal"

    def test_no_agreement(self):
        assert stable_common_prefix("buenos dias", "hola") == ""

    def test_empty_previous_candidate(self):
        assert stable_common_prefix("", "hola") == ""

    def test_word_level_not_char_level(self):
        # "holas" vs "hola" share chars but not a full word
        assert stable_common_prefix("holas amigo", "hola amigo") == ""

    def test_prefix_shorter_candidate(self):
        assert stable_common_prefix("hola que", "hola que tal amigo") == "hola que"


# ------------------------------------------------------ sentence boundary

class TestEndsSentence:
    def test_period(self):
        assert ends_sentence("This is done.")

    def test_question_exclaim(self):
        assert ends_sentence("Really?") and ends_sentence("Go!")

    def test_cjk_punctuation(self):
        assert ends_sentence("こんにちは。") and ends_sentence("好的！")

    def test_trailing_quote_after_period(self):
        assert ends_sentence('He said "stop."')

    def test_mid_sentence(self):
        assert not ends_sentence("and then we")

    def test_comma(self):
        assert not ends_sentence("first of all,")

    def test_empty(self):
        assert not ends_sentence("")


# ------------------------------------------------------------- split_tail

class TestSplitTail:
    def test_no_frozen(self):
        assert split_tail("Hello there. How are you", "") == "Hello there. How are you"

    def test_frozen_prefix_removed(self):
        assert split_tail("Hello there. How are you", "Hello there.") == "How are you"

    def test_frozen_equals_committed(self):
        assert split_tail("Hello there.", "Hello there.") == ""

    def test_frozen_no_longer_prefix_falls_back_to_full(self):
        # Deepgram revised earlier text — frozen prefix invalid, translate everything
        assert split_tail("Hi there. How are you", "Hello there.") == "Hi there. How are you"


# ----------------------------------------------------------- join_nonempty

class TestJoinNonempty:
    def test_both(self):
        assert join_nonempty("Hola.", "¿Qué tal?") == "Hola. ¿Qué tal?"

    def test_one_empty(self):
        assert join_nonempty("", "Hola.") == "Hola."
        assert join_nonempty("Hola.", "") == "Hola."

    def test_strips(self):
        assert join_nonempty(" Hola. ", " ¿Qué tal? ") == "Hola. ¿Qué tal?"


# ------------------------------------------------------------ prompt build

class TestBuildTranslationMessages:
    def test_minimal(self):
        msgs = build_translation_messages(
            target_lang_name="Spanish",
            source_text="Hello there.",
            context_pairs=[],
            keyterms=[],
        )
        assert msgs[0][0] == "system"
        assert "Spanish" in msgs[0][1]
        assert msgs[-1] == ("user", "Hello there.")

    def test_context_pairs_become_fewshot_messages(self):
        msgs = build_translation_messages(
            target_lang_name="Spanish",
            source_text="And then?",
            context_pairs=[("Hello.", "Hola."), ("Good morning.", "Buenos días.")],
            keyterms=[],
        )
        roles = [r for r, _ in msgs]
        assert roles == ["system", "user", "assistant", "user", "assistant", "user"]
        assert msgs[1] == ("user", "Hello.")
        assert msgs[2] == ("assistant", "Hola.")
        assert msgs[-1] == ("user", "And then?")

    def test_keyterms_in_system_prompt(self):
        msgs = build_translation_messages(
            target_lang_name="Spanish",
            source_text="ShareApp is live.",
            context_pairs=[],
            keyterms=["ShareApp", "LiveKit"],
        )
        assert "ShareApp" in msgs[0][1] and "LiveKit" in msgs[0][1]

    def test_partial_hint(self):
        msgs = build_translation_messages(
            target_lang_name="Spanish",
            source_text="and then we went",
            context_pairs=[],
            keyterms=[],
            partial=True,
        )
        assert "incomplete" in msgs[0][1].lower() or "partial" in msgs[0][1].lower()


# ------------------------------------------------------- LLM call helpers

class TestContextPairsForTranslationCall:
    def test_final_calls_keep_context_pairs(self):
        pairs = [("Hello.", "Hola."), ("Thanks.", "Gracias.")]
        assert context_pairs_for_translation_call(pairs, partial=False) == pairs

    def test_interim_calls_drop_fewshot_context(self):
        pairs = [("Hello.", "Hola."), ("Thanks.", "Gracias.")]
        assert context_pairs_for_translation_call(pairs, partial=True) == []


class TestLlmCompletionTokenCap:
    def test_short_source_gets_safe_minimum_cap(self):
        assert llm_completion_token_cap("hello world") == 64

    def test_long_source_is_capped(self):
        assert llm_completion_token_cap("word " * 1000) == 768

    def test_empty_source_still_has_minimum_cap(self):
        assert llm_completion_token_cap("   ") == 64


# ------------------------------------------------------- turn breaking

class TestShouldBreakTurn:
    def test_no_break_for_short_young_turn(self):
        assert should_break_turn("Hello there.", age_sec=5) is False

    def test_no_break_mid_sentence_even_when_old(self):
        # Never split a bubble mid-sentence — wait for a sentence boundary.
        assert should_break_turn("and then we went to the", age_sec=120) is False

    def test_breaks_at_sentence_boundary_when_too_old(self):
        assert should_break_turn("That is the first point.", age_sec=46) is True

    def test_breaks_at_sentence_boundary_when_too_wordy(self):
        text = " ".join(["word"] * 120) + "."
        assert should_break_turn(text, age_sec=10) is True

    def test_empty_never_breaks(self):
        assert should_break_turn("  ", age_sec=999) is False


class TestTtsRemainder:
    def test_nothing_spoken_returns_full(self):
        assert tts_remainder("", "Hola mundo.") == "Hola mundo."

    def test_spoken_prefix_is_not_respoken(self):
        assert tts_remainder("Hola.", "Hola. Mundo.") == "Mundo."

    def test_diverged_text_returns_full(self):
        # Translation was revised — safest is to speak the full current text
        # only when nothing was queued from it; here prefix diverged so the
        # caller gets the full text back.
        assert tts_remainder("Hola.", "Buenas. Mundo.") == "Buenas. Mundo."

    def test_everything_spoken_returns_empty(self):
        assert tts_remainder("Hola mundo.", "Hola mundo.") == ""


class TestShouldHandoffTurn:
    """Conversational A -> B -> A turn handoff without cutting off active speech."""

    def test_handoff_when_speaker_a_paused_and_speaker_b_speaks(self):
        assert (
            should_handoff_turn(
                other_has_open_turn=True,
                other_vad_active=False,
                other_idle_sec=0.6,
                interjector_is_final=False,
                interjector_word_count=2,
            )
            is True
        )

    def test_handoff_on_short_one_word_final_from_speaker_b(self):
        assert (
            should_handoff_turn(
                other_has_open_turn=True,
                other_vad_active=False,
                other_idle_sec=0.5,
                interjector_is_final=True,
                interjector_word_count=1,
            )
            is True
        )

    def test_no_handoff_when_speaker_a_is_actively_speaking(self):
        assert (
            should_handoff_turn(
                other_has_open_turn=True,
                other_vad_active=True,
                other_idle_sec=0.1,
                interjector_is_final=True,
                interjector_word_count=3,
            )
            is False
        )

    def test_no_handoff_when_speaker_a_has_no_open_turn(self):
        assert (
            should_handoff_turn(
                other_has_open_turn=False,
                other_vad_active=False,
                other_idle_sec=2.0,
                interjector_is_final=True,
                interjector_word_count=4,
            )
            is False
        )


class TestSttIdleTimeoutMs:
    """Adaptive punctuation-aware idle timeout around 2.0s."""

    def test_sentence_complete_uses_shorter_timeout(self):
        assert stt_idle_timeout_ms("That finishes the first thought.", base_idle_ms=2000) == 1600

    def test_mid_sentence_uses_full_two_second_timeout(self):
        assert stt_idle_timeout_ms("And then we looked at", base_idle_ms=2000) == 2000

    def test_respects_custom_base_idle_ms(self):
        assert stt_idle_timeout_ms("Done!", base_idle_ms=1500) == 1200
        assert stt_idle_timeout_ms("Still going", base_idle_ms=1500) == 1500
