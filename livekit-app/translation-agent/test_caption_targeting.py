from caption_targeting import compute_caption_targets


def test_caption_targets_ignore_host_language_allow_list():
    participant_languages = {
        "host": "en",
        "guest-es": "es",
        "guest-fr": "fr",
        "guest-ru": "ru",
    }
    translation_enabled = {
        "host": True,
        "guest-es": True,
        "guest-fr": True,
        "guest-ru": True,
    }

    assert compute_caption_targets(
        participant_languages,
        translation_enabled,
        caption_languages=["en"],
    ) == {"en", "es", "fr", "ru"}


def test_caption_targets_only_include_enabled_participants():
    assert compute_caption_targets(
        {"host": "en", "guest-es": "es"},
        {"host": True, "guest-es": False},
        caption_languages=[],
    ) == {"en"}
