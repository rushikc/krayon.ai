from __future__ import annotations

from app.schemas import ClipGroup, ClipItem, SourceSegment, WordTiming
from app.services.boundary_snap import snap_studio_clips
from app.services.ffmpeg import probe_media
from app.services.studio.common.project import (
    WHISPER_PROMPT_MAX_CHARS,
    PipelineOptions,
    ProjectAudio,
    StudioAnalysis,
    write_checkpoint,
)
from app.services.studio.scripted_alignment import (
    AlignmentResult,
    Candidate,
    align_script,
    parse_script_lines,
    trusted_cut_times,
    whisper_prompt_from_script,
)
from app.services.studio.transcribe_resume import ensure_wav, ensure_words, load_words


def execute_scripted_pipeline(
    project: ProjectAudio,
    script: str,
    options: PipelineOptions,
    on_progress=None,
) -> StudioAnalysis:
    analysis_dir = project.analysis_dir
    source = project.source
    analysis_dir.mkdir(parents=True, exist_ok=True)
    wav_path = analysis_dir / "source.wav"
    words_path = analysis_dir / "words.json"

    def progress(phase: str, ratio: float, message: str) -> None:
        write_checkpoint(analysis_dir, phase, message, ratio)
        if on_progress:
            on_progress(phase, ratio, message)

    progress("extracting", 0.0, "Extracting audio…" if not wav_path.is_file() else "Reusing cached audio")
    extracted = ensure_wav(source, wav_path)
    progress("extracting", 1.0, "Extracted audio" if extracted else "Cached audio")

    def whisper_progress(ratio: float, message: str) -> None:
        progress("transcribing", ratio, message)

    prompt = options.initial_prompt
    if prompt is None and options.script_whisper_prompt and not words_path.is_file():
        prompt = whisper_prompt_from_script(script, WHISPER_PROMPT_MAX_CHARS)

    if words_path.is_file():
        progress("transcribing", 1.0, "Reusing cached transcript")
    else:
        progress("transcribing", 0.0, "Transcribing…")
    ensure_words(
        wav_path,
        words_path,
        language=options.language,
        on_progress=whisper_progress,
        initial_prompt=prompt,
    )
    words = load_words(words_path)
    probe = probe_media(source)
    source_duration = float(probe.duration or 0.0)

    progress("segmenting", 0.2, "Aligning script…")
    lines = parse_script_lines(script)
    aligned = align_script(
        lines,
        words,
        match_threshold=options.script_match_threshold,
        prefer_last_takes=options.script_prefer_last_takes,
    )
    clips, groups, clip_meta, group_meta, scores = build_scripted_clips(aligned, options)
    if options.snap_to_audio and wav_path.is_file():
        progress("snapping", 0.2, "Snapping cuts to the waveform…")
        clips = snap_studio_clips(clips, wav_path, pad=options.pad, search=options.snap_search_seconds)
        clips = clamp_clips_to_matches(clips, aligned, words)
        progress("snapping", 1.0, "Snapped cuts")
    clips = drop_overlapping_rejects(clips, clip_meta)
    progress("grouping", 1.0, f"Matched {sum(1 for item in aligned.line_results if item.chosen)} lines")
    progress("saving", 1.0, "Save clips")

    timings = [WordTiming(text=word.text, start=word.start, end=word.end) for word in words]
    selected = [clip for clip in clips if clip_meta.get(clip.id, {}).get("status") == "selected"]
    return StudioAnalysis(
        source_duration=source_duration,
        fps=float(probe.fps or 30.0),
        words=timings,
        clips=clips,
        groups=groups,
        scores=scores,
        removed_seconds=max(0.0, source_duration - sum(clip.duration for clip in selected)),
        pipeline="scripted",
        clip_meta=clip_meta,
        group_meta=group_meta,
    )


def build_scripted_clips(
    aligned: AlignmentResult,
    options: PipelineOptions,
) -> tuple[list[ClipItem], list[ClipGroup], dict[str, dict], dict[str, dict], dict[str, dict]]:
    clips: list[ClipItem] = []
    groups: list[ClipGroup] = []
    clip_meta: dict[str, dict] = {}
    group_meta: dict[str, dict] = {}
    scores: dict[str, dict] = {}
    index = 0
    for result in aligned.line_results:
        group_id = f"script_g{result.line:04d}"
        clip_ids: list[str] = []
        chosen = result.chosen
        takes = sorted(result.candidates, key=lambda item: item.start)
        take_count = len(takes)
        recommended: str | None = None
        for take_no, cand in enumerate(takes, start=1):
            index += 1
            clip_id = f"script_l{result.line:04d}_t{take_no:02d}"
            start, end = trusted_cut_times(cand.words, 0, len(cand.words) - 1) if cand.words else (cand.start, cand.end)
            # trusted_cut_times expects full word list indices; adjust using candidate word list
            start, end = _candidate_bounds(cand)
            words = [WordTiming(text=word.text, start=word.start, end=word.end) for word in cand.words]
            clip = ClipItem(
                id=clip_id,
                index=index - 1,
                source_start=start,
                source_end=end,
                duration=max(0.0, end - start),
                text=cand.matched_text,
                group_id=group_id,
                words=words,
                false_start=False,
                delivery_issue=None,
                ranges=[SourceSegment(source_start=start, source_end=end)],
            )
            clips.append(clip)
            clip_ids.append(clip_id)
            selected = chosen is not None and cand.start_index == chosen.start_index and cand.end_index == chosen.end_index
            if selected:
                recommended = clip_id
                reason = f"best match {cand.match_score:.2f} for line {result.line} (take {take_no} of {take_count})"
                status = "selected"
            else:
                reason = f"retake of line {result.line}, match {cand.match_score:.2f}"
                status = "rejected"
            clip_meta[clip_id] = {
                "status": status,
                "decidedBy": "algorithm",
                "statusReason": reason,
                "script": {"line": result.line, "text": result.text, "score": round(cand.match_score, 4)},
            }
            scores[clip_id] = {"score": cand.match_score, "reasons": [reason]}
        groups.append(
            ClipGroup(
                id=group_id,
                label=result.text,
                clip_ids=clip_ids,
                reference_clip_id=recommended,
            )
        )
        group_meta[group_id] = {"scriptLine": result.line}
    return clips, groups, clip_meta, group_meta, scores


def _candidate_bounds(cand: Candidate) -> tuple[float, float]:
    if not cand.words:
        return cand.start, cand.end
    local = [
        type("W", (), {"text": w.text, "start": w.start, "end": w.end, "index": i})()
        for i, w in enumerate(cand.words)
    ]
    return trusted_cut_times(local, 0, len(local) - 1)


def clamp_clips_to_matches(clips: list[ClipItem], aligned: AlignmentResult, words) -> list[ClipItem]:
    windows: dict[str, tuple[float, float, set[int]]] = {}
    for result in aligned.line_results:
        takes = sorted(result.candidates, key=lambda item: item.start)
        for take_no, cand in enumerate(takes, start=1):
            clip_id = f"script_l{result.line:04d}_t{take_no:02d}"
            inside = set(range(cand.start_index, cand.end_index + 1))
            windows[clip_id] = (cand.start, cand.end, inside)

    updated: list[ClipItem] = []
    for clip in clips:
        window = windows.get(clip.id)
        if not window:
            updated.append(clip)
            continue
        _match_start, _match_end, inside = window
        start, end = clip.source_start, clip.source_end
        for index, word in enumerate(words):
            if index in inside:
                continue
            if word.end <= start + 1e-4 or word.start >= end - 1e-4:
                continue
            if index < min(inside, default=index):
                start = max(start, getattr(words[min(inside)], "start"))
            elif index > max(inside, default=index):
                end = min(end, getattr(words[max(inside)], "end"))
        if end <= start:
            updated.append(clip)
            continue
        updated.append(
            clip.model_copy(
                update={
                    "source_start": start,
                    "source_end": end,
                    "duration": end - start,
                    "ranges": [SourceSegment(source_start=start, source_end=end)],
                }
            )
        )
    return updated


def drop_overlapping_rejects(clips: list[ClipItem], clip_meta: dict[str, dict]) -> list[ClipItem]:
    selected = [clip for clip in clips if clip_meta.get(clip.id, {}).get("status") == "selected"]
    selected.sort(key=lambda clip: clip.source_start)
    for prev, curr in zip(selected, selected[1:]):
        if curr.source_start < prev.source_end:
            meet = (prev.source_end + curr.source_start) / 2.0
            prev.source_end = meet
            prev.duration = prev.source_end - prev.source_start
            prev.ranges = [SourceSegment(source_start=prev.source_start, source_end=prev.source_end)]
            curr.source_start = meet
            curr.duration = curr.source_end - curr.source_start
            curr.ranges = [SourceSegment(source_start=curr.source_start, source_end=curr.source_end)]

    kept: list[ClipItem] = []
    selected_spans = [(clip.source_start, clip.source_end, clip.id) for clip in selected]
    for clip in clips:
        meta = clip_meta.get(clip.id, {})
        if meta.get("status") == "selected":
            kept.append(clip)
            continue
        overlaps = any(
            clip.source_start < end - 1e-4 and clip.source_end > start + 1e-4
            for start, end, _sid in selected_spans
        )
        if overlaps:
            clip_meta.pop(clip.id, None)
            continue
        kept.append(clip)
    return kept
