from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.services.ffmpeg import probe_media


@dataclass
class RenderClipIn:
    clip_id: str
    ranges: list[tuple[float, float]]


@dataclass
class RenderManifestEntry:
    clip_id: str
    out_start: float
    out_end: float


def has_encoder(name: str) -> bool:
    result = subprocess.run(
        [settings.ffmpeg, "-hide_banner", "-encoders"],
        capture_output=True,
        text=True,
        check=False,
    )
    return name in (result.stdout or "")


def video_encoder_args(quality: str) -> list[str]:
    """Final renders always re-encode. Preview uses a faster, smaller encode."""
    preview = quality == "preview"
    if sys.platform == "darwin" and has_encoder("h264_videotoolbox"):
        bitrate = "1500k" if preview else "8M"
        return ["-c:v", "h264_videotoolbox", "-b:v", bitrate, "-allow_sw", "1", "-pix_fmt", "yuv420p"]
    preset = "ultrafast" if preview else "veryfast"
    crf = "30" if preview else "18"
    return ["-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p"]


def manifest_for(clips: list[RenderClipIn]) -> list[RenderManifestEntry]:
    cursor = 0.0
    entries: list[RenderManifestEntry] = []
    for clip in clips:
        start = cursor
        for begin, end in clip.ranges:
            cursor += max(0.0, end - begin)
        entries.append(RenderManifestEntry(clip_id=clip.clip_id, out_start=start, out_end=cursor))
    return entries


def _flatten(clips: list[RenderClipIn]) -> list[tuple[float, float]]:
    ranges: list[tuple[float, float]] = []
    for clip in clips:
        for begin, end in clip.ranges:
            if end - begin <= 0.01:
                raise ValueError(f"clip {clip.clip_id} has an empty range")
            ranges.append((begin, end))
    if not ranges:
        raise ValueError("render requires at least one clip range")
    return ranges


def build_filter(ranges: list[tuple[float, float]], *, preview: bool) -> tuple[str, str, str]:
    parts: list[str] = []
    for index, (start, end) in enumerate(ranges):
        duration = max(0.02, end - start)
        fade = min(0.04, duration / 4)
        fade_out = max(0.0, duration - fade)
        parts.append(
            f"[0:v]trim=start={start:.6f}:end={end:.6f},setpts=PTS-STARTPTS[v{index}]"
        )
        parts.append(
            "[0:a]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,"
            "afade=t=in:st=0:d={fade:.4f},afade=t=out:st={fade_out:.4f}:d={fade:.4f}[a{index}]".format(
                start=start,
                end=end,
                fade=fade,
                fade_out=fade_out,
                index=index,
            )
        )
    count = len(ranges)
    if count == 1:
        video = "[v0]"
        audio = "[a0]"
        if preview:
            parts.append("[v0]scale=w='min(iw,640)':h=-2[vpreview]")
            video = "[vpreview]"
        return ";".join(parts), video, audio

    joined = "".join(f"[v{index}][a{index}]" for index in range(count))
    parts.append(f"{joined}concat=n={count}:v=1:a=1[vout][aout]")
    video = "[vout]"
    if preview:
        parts.append("[vout]scale=w='min(iw,640)':h=-2[vpreview]")
        video = "[vpreview]"
    return ";".join(parts), video, "[aout]"


def render_command(source: Path, output: Path, clips: list[RenderClipIn], *, quality: str) -> list[str]:
    if quality not in {"preview", "final"}:
        raise ValueError("quality must be preview or final")
    ranges = _flatten(clips)
    script, video, audio = build_filter(ranges, preview=quality == "preview")
    filter_path = output.with_suffix(output.suffix + ".filter")
    filter_path.parent.mkdir(parents=True, exist_ok=True)
    filter_path.write_text(script)
    return [
        settings.ffmpeg,
        "-y",
        "-i",
        str(source),
        "-filter_complex_script",
        str(filter_path),
        "-map",
        video,
        "-map",
        audio,
        *video_encoder_args(quality),
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        str(output),
    ]


def render_video(
    source: Path,
    output: Path,
    clips: list[RenderClipIn],
    *,
    quality: str,
    on_progress=None,
) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = render_command(source, output, clips, quality=quality)
    if "-c:v" not in command or "copy" in command[command.index("-c:v") + 1 : command.index("-c:v") + 2]:
        raise RuntimeError("final and preview studio renders must re-encode video")
    expected = manifest_for(clips)
    expected_duration = expected[-1].out_end if expected else 0.0

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    for line in process.stdout:
        text = line.strip()
        if expected_duration > 0 and on_progress and (
            text.startswith("out_time_ms=") or text.startswith("out_time_us=")
        ):
            raw = text.split("=", 1)[1]
            try:
                ticks = int(raw)
            except ValueError:
                continue
            elapsed = ticks / 1_000_000 if text.startswith("out_time_us=") or ticks > expected_duration * 10 else ticks / 1_000
            ratio = max(0.0, min(0.99, elapsed / expected_duration))
            on_progress("rendering", ratio, f"Rendering… {int(ratio * 100)}%")
    stderr = process.stderr.read() if process.stderr else ""
    code = process.wait()
    filter_path = output.with_suffix(output.suffix + ".filter")
    if filter_path.exists():
        filter_path.unlink()
    if code != 0:
        tail = stderr[-2000:]
        raise RuntimeError(f"ffmpeg render failed ({code}): {tail}")

    probe = probe_media(output)
    manifest = [
        {"clipId": entry.clip_id, "outStart": round(entry.out_start, 3), "outEnd": round(entry.out_end, 3)}
        for entry in expected
    ]
    payload = {
        "outputPath": str(output),
        "quality": quality,
        "duration": probe.duration,
        "expectedDuration": expected_duration,
        "clips": manifest,
    }
    manifest_path = output.with_suffix(".json")
    manifest_path.write_text(json.dumps(payload, indent=2))
    if on_progress:
        on_progress("rendering", 1.0, "Render complete")
    return payload
