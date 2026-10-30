def compute_caption_targets(participant_languages, translation_enabled, caption_languages=None):
    """Return every enabled participant caption language.

    `caption_languages` is accepted only for backward compatibility with older room
    metadata. Participant choices are the source of truth; hosts should not have to
    pre-enable languages for guests.
    """
    return {
        lang
        for participant_id, lang in (participant_languages or {}).items()
        if lang and (translation_enabled or {}).get(participant_id, False)
    }
