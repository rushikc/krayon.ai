from __future__ import annotations

from app.services.studio.common.project import StudioAnalysis


def analysis_payload(result: StudioAnalysis) -> dict:
    clips = []
    for clip in result.clips:
        payload = clip.model_dump(by_alias=True)
        extra = result.clip_meta.get(clip.id)
        if extra:
            payload.update(extra)
        clips.append(payload)
    groups = []
    for group in result.groups:
        payload = group.model_dump(by_alias=True)
        extra = result.group_meta.get(group.id)
        if extra:
            payload.update(extra)
        groups.append(payload)
    return {
        "sourceDuration": result.source_duration,
        "fps": result.fps,
        "removedSeconds": result.removed_seconds,
        "words": [word.model_dump() for word in result.words],
        "clips": clips,
        "groups": groups,
        "scores": result.scores,
        "scope": "full",
        "rangeStart": None,
        "rangeEnd": None,
        "pipeline": result.pipeline,
    }
