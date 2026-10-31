from __future__ import annotations

from app.schemas import ClipItem
from app.services.clips import _normalized_tokens, _reference_key, pick_group_reference


def score_clips(clips: list[ClipItem]) -> dict[str, dict]:
    """Attach a numeric score and reasons using the existing reference-take ranking."""
    grouped: dict[str, list[ClipItem]] = {}
    for clip in clips:
        grouped.setdefault(clip.group_id, []).append(clip)

    scores: dict[str, dict] = {}
    for members in grouped.values():
        reference = pick_group_reference(members)
        tokenized = {clip.id: _normalized_tokens(clip.text) for clip in members}
        for clip in members:
            reasons: list[str] = []
            if clip.false_start:
                reasons.append("false start")
            if reference is not None and clip.id == reference.id:
                reasons.append("reference take")
            others = [
                tokenized[other.id]
                for other in members
                if other.id != clip.id and not other.false_start
            ]
            key = _reference_key(clip, tokenized[clip.id], others) if others else None
            score = float(key[0]) if key is not None else float(len(tokenized[clip.id]))
            if key is not None:
                reasons.append(f"matched {key[0]} tokens")
                if key[1] < 0:
                    reasons.append(f"run-on penalty {-key[1]}")
            elif len(members) == 1:
                reasons.append("only take in group")
            if clip.delivery_issue:
                reasons.append(clip.delivery_issue.replace("_", " "))
            if not reasons:
                reasons.append("no delivery issue")
            scores[clip.id] = {"score": score, "reasons": reasons}
    return scores
