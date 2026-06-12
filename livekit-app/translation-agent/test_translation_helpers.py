"""Tests for translation_helpers (cache, local agreement, freeze, prompt building)."""

from translation_helpers import (
    TranslationCache,
    build_translation_messages,
    ends_sentence,
    join_nonempty,
    split_tail,
    stable_common_prefix,
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
