from __future__ import annotations

import array
import shutil
import tempfile
import wave
from collections.abc import Callable
from pathlib import Path

from app.config import settings
from app.schemas import ClipItem
from app.services.clips import play_ranges
from app.services.editor_state import version_dir
from app.services.ffmpeg import krayon_cache_dir, run_command
from app.services.pipeline_log import PipelineContext

ProgressFn = Callable[[int, int, str], None]


def clip_audio_dir(source: Path, version_id: str) -> Path:
    return version_dir(source, version_id) / "audio"


def clip_audio_path(source: Path, version_id: str, clip_id: str) -> Path:
    return clip_audio_dir(source, version_id) / f"{clip_id}.wav"


def cached_source_wav(source: Path) -> Path:
    return krayon_cache_dir(source.parent) / f"{source.stem}.wav"


def _slice_wav(source_wav: Path, output: Path, ranges: list[tuple[float, float]]) -> None:
    with wave.open(str(source_wav), "rb") as src:
        channels = src.getnchannels()
        sample_width = src.getsampwidth()
        rate = src.getframerate()
        nframes = src.getnframes()
        payload = array.array("h")
        src.rewind()
        raw = src.readframes(nframes)
        payload.frombytes(raw)

        if channels != 1 or sample_width != 2:
            raise ValueError("cached wav must be 16-bit mono")

        chunks = array.array("h")
        for start, end in ranges:
            if start < 0:
                n = max(0, int(round(end * rate)))
                chunks.extend(array.array("h", [0] * n))
                continue
            start_i = max(0, int(round(start * rate)))
            end_i = min(len(payload), int(round(end * rate)))
            if end_i > start_i:
                chunks.extend(payload[start_i:end_i])

    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as dst:
        dst.setnchannels(1)
        dst.setsampwidth(2)
        dst.setframerate(rate)
        dst.writeframes(chunks.tobytes())


def _ffmpeg_extract_ranges(source: Path, output: Path, ranges: list[tuple[float, float]]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if len(ranges) == 1:
        start, end = ranges[0]
        run_command(
            [
                settings.ffmpeg,
                "-y",
                "-ss",
                str(start),
                "-to",
                str(end),
                "-i",
                str(source),
                "-vn",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(output),
            ]
        )
        return

    with tempfile.TemporaryDirectory() as tmp:
        parts: list[Path] = []
        for index, (start, end) in enumerate(ranges):
            part = Path(tmp) / f"p{index:03d}.wav"
            run_command(
                [
                    settings.ffmpeg,
                    "-y",
                    "-ss",
                    str(start),
                    "-to",
                    str(end),
                    "-i",
                    str(source),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    str(part),
                ]
            )
            parts.append(part)
        chunks = array.array("h")
        rate = 16000
        for part in parts:
            with wave.open(str(part), "rb") as src:
                rate = src.getframerate()
                frames = array.array("h")
                frames.frombytes(src.readframes(src.getnframes()))
                chunks.extend(frames)
        with wave.open(str(output), "wb") as dst:
            dst.setnchannels(1)
            dst.setsampwidth(2)
            dst.setframerate(rate)
            dst.writeframes(chunks.tobytes())


def extract_clip_audio(
    source: Path,
    version_id: str,
    clips: list[ClipItem],
    *,
    on_progress: ProgressFn | None = None,
    pipeline: PipelineContext | None = None,
    wav_path: Path | None = None,
) -> None:
    audio_dir = clip_audio_dir(source, version_id)
    tmp_dir = audio_dir.with_name(f"{audio_dir.name}.tmp")
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    total = len(clips)
    cache_wav = wav_path or cached_source_wav(source)
    use_wav = cache_wav.is_file()

    if pipeline:
        pipeline.phase("extracting_audio", "extract clip audio start", clip_count=total)

    try:
        for index, clip in enumerate(clips):
            output = tmp_dir / f"{clip.id}.wav"
            ranges = play_ranges(clip)
            if use_wav:
                _slice_wav(cache_wav, output, ranges)
            else:
                _ffmpeg_extract_ranges(source, output, ranges)

            if on_progress:
                on_progress(index + 1, total, f"Extracting audio {index + 1}/{total}")

            if pipeline and ((index + 1) % 5 == 0 or index + 1 == total):
                pipeline.phase(
                    "extracting_audio",
                    "extract clip audio progress",
                    clip_index=index + 1,
                    clip_total=total,
                )

        if audio_dir.exists():
            shutil.rmtree(audio_dir)
        tmp_dir.rename(audio_dir)
    except Exception:
        if tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    if pipeline:
        pipeline.phase_complete(
            "extracting_audio",
            clips_extracted=total,
        )
