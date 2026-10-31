from __future__ import annotations

from app.services.studio.common.project import PipelineOptions, ProjectAudio, StudioAnalysis


def resolve_pipeline(options: PipelineOptions, script: str | None) -> str:
    from app.services.studio.scripted_alignment import parse_script_lines
    mode = options.pipeline or "auto"
    if mode == "auto":
        return "scripted" if parse_script_lines(script or "") else "transcript"
    if mode == "scripted" and not parse_script_lines(script or ""):
        return "transcript"
    return mode


def run_transcript_pipeline(project: ProjectAudio, options: PipelineOptions, on_progress=None) -> StudioAnalysis:
    from app.services.studio.analyze import run_transcript_pipeline as impl

    return impl(project, options, on_progress=on_progress)


def run_scripted_pipeline(
    project: ProjectAudio,
    script: str,
    options: PipelineOptions,
    on_progress=None,
) -> StudioAnalysis:
    from app.services.studio.scripted_pipeline import execute_scripted_pipeline

    return execute_scripted_pipeline(project, script, options, on_progress=on_progress)


def run_pipeline(
    project: ProjectAudio,
    options: PipelineOptions,
    script: str | None = None,
    on_progress=None,
) -> StudioAnalysis:
    mode = resolve_pipeline(options, script)
    if mode == "scripted":
        return run_scripted_pipeline(project, script or "", options, on_progress=on_progress)
    return run_transcript_pipeline(project, options, on_progress=on_progress)
