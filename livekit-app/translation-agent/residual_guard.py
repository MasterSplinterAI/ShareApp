"""Post-finalize residual guard (pure logic, no livekit deps).

Deepgram re-emits the just-committed utterance as trailing is_final/interim
events after speech_final. Those must be dropped so they don't open a duplicate
turn. But a brand-new utterance whose opening word happens to be a prefix/suffix
of the previous utterance must NOT be dropped — otherwise the first word of the
next sentence disappears within the residual window.
"""

from __future__ import annotations

# Overlap fragments shorter than this are treated as new-utterance openers, not
# residual re-emissions. ~12 chars keeps single short words (and most 2-word
# openers) flowing while still catching longer duplicated tails/heads.
_MIN_RESIDUAL_FRAGMENT_CHARS = 12


def is_residual_repeat(candidate: str, prev_finalized: str) -> bool:
    """True only when `candidate` is a trailing duplicate of `prev_finalized`.

    Treats as residual when the candidate is an exact match, or a prefix/suffix
    of the prior utterance that is long enough to be a real re-emitted fragment.
    Short openers (e.g. "okay", "now", "so") fall under the length floor and pass
    through so their turn can start — which is what fixes the first-word drop.
    """
    norm = " ".join(candidate.strip().lower().split())
    prev_n = " ".join(prev_finalized.split())
    if not prev_n:
        return False
    if not norm:
        return True
    if norm == prev_n:
        return True
    overlap = (
        prev_n.startswith(norm)
        or prev_n.endswith(norm)
        or norm.startswith(prev_n)
        or norm.endswith(prev_n)
    )
    # Fixed length floor: a 1-3 word opener is never residual; a longer exact
    # prefix/suffix of the previous utterance is Deepgram re-emitting committed text.
    return overlap and len(norm) >= _MIN_RESIDUAL_FRAGMENT_CHARS
