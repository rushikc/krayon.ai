from __future__ import annotations

from pathlib import Path

from app.schemas import ClipGroup, ClipItem, WordTiming
from app.services.clips import (
    _groups_from_clips,
    build_segment_clips,
    flag_incomplete_takes,
    group_clips_by_text,
)
from app.services.ffmpeg import probe_media, run_command
from app.services.segments import Word, build_segments_from_words, extend_segment_tails
from app.services.studio.scoring import score_clips
from app.services.studio.transcribe_resume import load_words, save_words, transcribe_wav
from app.config import settings


def splice_words(words: list[Word], start: float, end: float, replacement: list[Word]) -> list[Word]:
    kept = [word for word in words if word.end <= start + 1e-3 or word.start >= end - 1e-3]
    merged = kept + replacement
    merged.sort(key=lambda word: (word.start, word.end))
    return merged


def _words_overlapping(words: list[Word], start: float, end: float) -> list[Word]:
    return [word for word in words if word.end > start and word.start < end]


def _shift_words(words: list[Word], offset: float) -> list[Word]:
    return [Word(text=word.text, start=word.start + offset, end=word.end + offset) for word in words]


def transcribe_range(source: Path, start: float, end: float, *, language: str | None) -> list[Word]:
    """Whisper a source time range and return words on the source timeline."""
    from tempfile import TemporaryDirectory

    if end <= start:
        raise ValueError("range end must be after start")
    with TemporaryDirectory() as tmp:
        wav = Path(tmp) / "range.wav"
        run_command(
            [
                settings.ffmpeg,
                "-y",
                "-ss",
                f"{start:.6f}",
                "-to",
                f"{end:.6f}",
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(wav),
            ]
        )
        local = transcribe_wav(wav, language=language)
    return _shift_words(local, start)


def _clips_outside(clips: list[ClipItem], start: float, end: float) -> list[ClipItem]:
    kept: list[ClipItem] = []
    for clip in clips:
        if clip.source_end <= start + 1e-3 or clip.source_start >= end - 1e-3:
            kept.append(clip)
    return kept


def _build_range_clips(
    words: list[Word],
    *,
    start: float,
    end: float,
    source_duration: float,
    wav_path: Path,
    silence_threshold: float,
    pad: float,
    similarity_threshold: float,
) -> tuple[list[ClipItem], list[ClipGroup]]:
    inside = _words_overlapping(words, start, end)
    segments = build_segments_from_words(
        inside,
        silence_threshold=silence_threshold,
        pad=pad,
        source_duration=source_duration,
    )
    segments = [
        segment
        for segment in segments
        if segment.source_end > start and segment.source_start < end
    ]
    if wav_path.is_file():
        segments = extend_segment_tails(wav_path, segments, source_duration)
    return build_segment_clips(
        "range",
        segments,
        inside,
        similarity_threshold=similarity_threshold,
        pad=pad,
    )


def regroup_clips(clips: list[ClipItem], similarity_threshold: float) -> tuple[list[ClipItem], list[ClipGroup]]:
    pairs = [(clip.id, clip.text) for clip in clips]
    mapping = group_clips_by_text(
        pairs,
        threshold=similarity_threshold,
        stem="studio",
        indices={clip.id: clip.index for clip in clips},
    )
    updated: list[ClipItem] = []
    for clip in clips:
        updated.append(
            clip.model_copy(
                update={
                    "group_id": mapping[clip.id],
                    "delivery_issue": None,
                }
            )
        )
    references = flag_incomplete_takes(updated)
    return updated, _groups_from_clips(updated, references)


def reanalyze_project(
    source: Path,
    analysis_dir: Path,
    *,
    mode: str,
    clips: list[ClipItem],
    range_start: float | None,
    range_end: float | None,
    silence_threshold: float,
    pad: float,
    similarity_threshold: float,
    language: str | None = "en",
    on_progress=None,
) -> dict:
    words_path = analysis_dir / "words.json"
    wav_path = analysis_dir / "source.wav"
    if not words_path.is_file():
        raise FileNotFoundError("words.json is missing; run analysis first")

    words = load_words(words_path)
    probe = probe_media(source)
    source_duration = float(probe.duration or 0.0)
    scope = "full"
    affected_start = range_start
    affected_end = range_end

    if mode == "retranscribe":
        if range_start is None or range_end is None:
            raise ValueError("retranscribe requires a time range")
        if on_progress:
            on_progress("transcribing", 0.1, "Re-transcribing range…")
        replacement = transcribe_range(source, range_start, range_end, language=language)
        words = splice_words(words, range_start, range_end, replacement)
        save_words(words_path, words)
        scope = "range"
    elif mode == "resegment":
        if range_start is None or range_end is None:
            raise ValueError("resegment requires a time range")
        scope = "range"
    elif mode == "regroup":
        scope = "full" if range_start is None else "range"
    else:
        raise ValueError(f"unknown reanalyze mode {mode}")

    if mode == "regroup" and scope == "full":
        next_clips, groups = regroup_clips(clips, similarity_threshold)
    elif mode == "regroup" and range_start is not None and range_end is not None:
        inside = [
            clip
            for clip in clips
            if clip.source_end > range_start and clip.source_start < range_end
        ]
        outside = _clips_outside(clips, range_start, range_end)
        regrouped, _inside_groups = regroup_clips(inside, similarity_threshold)
        next_clips = outside + regrouped
        groups = _groups_from_clips(next_clips)
    else:
        assert range_start is not None and range_end is not None
        outside = _clips_outside(clips, range_start, range_end)
        created, _created_groups = _build_range_clips(
            words,
            start=range_start,
            end=range_end,
            source_duration=source_duration,
            wav_path=wav_path,
            silence_threshold=silence_threshold,
            pad=pad,
            similarity_threshold=similarity_threshold,
        )
        next_clips = outside + created
        groups = _groups_from_clips(next_clips)

    scores = score_clips(next_clips)
    if on_progress:
        on_progress("grouping", 1.0, f"Reanalyzed {len(next_clips)} clips")

    return {
        "sourceDuration": source_duration,
        "fps": float(probe.fps or 30.0),
        "words": [WordTiming(text=word.text, start=word.start, end=word.end).model_dump() for word in words],
        "clips": [clip.model_dump(by_alias=True) for clip in next_clips],
        "groups": [group.model_dump(by_alias=True) for group in groups],
        "scores": scores,
        "scope": scope,
        "rangeStart": affected_start,
        "rangeEnd": affected_end,
    }

