from __future__ import annotations

import array
import math
import wave
from dataclasses import dataclass
from pathlib import Path

from app.config import settings

TAIL_WINDOW_S = 0.02
TAIL_SPEECH_LOOKBACK_S = 0.3
TAIL_MAX_EXTEND_S = 0.3
LEGACY_TAIL_MAX_EXTEND_S = 2.0
TAIL_NEIGHBOR_GUARD_S = 0.02
TAIL_FLOOR_RATIO = 0.12
TAIL_ABS_FLOOR = 400.0
TAIL_QUIET_HOLD_S = 0.18
TAIL_RELEASE_S = 0.05


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Segment:
    source_start: float
    source_end: float

    @property
    def duration(self) -> float:
        return self.source_end - self.source_start


def build_segments_from_words(
    words: list[Word],
    *,
    silence_threshold: float,
    pad: float,
    source_duration: float,
    min_segment_seconds: float | None = None,
) -> list[Segment]:
    if not words:
        return []

    min_len = min_segment_seconds if min_segment_seconds is not None else settings.min_segment_seconds

    padded: list[tuple[float, float]] = []
    for word in words:
        start = max(0.0, word.start - pad)
        end = min(source_duration, word.end + pad)
        if not padded or start > padded[-1][1] + silence_threshold:
            padded.append((start, end))
        else:
            prev_start, prev_end = padded[-1]
            padded[-1] = (prev_start, max(prev_end, end))

    segments: list[Segment] = []
    for source_start, source_end in padded:
        if source_end - source_start < min_len:
            continue
        segments.append(Segment(source_start=source_start, source_end=source_end))
    return segments


def _load_mono_pcm16(wav_path: Path) -> tuple[array.array, int] | None:
    try:
        with wave.open(str(wav_path), "rb") as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
                return None
            rate = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
        samples = array.array("h")
        samples.frombytes(frames)
        return samples, rate
    except Exception:
        return None


def _rms(samples: array.array, start: int, end: int) -> float:
    start = max(0, start)
    end = min(len(samples), end)
    if end <= start:
        return 0.0
    total = 0.0
    for index in range(start, end):
        value = samples[index]
        total += value * value
    return math.sqrt(total / (end - start))


def _extend_one_end(
    samples: array.array,
    rate: int,
    source_end: float,
    cap: float,
    *,
    stop_on_reloud: bool = False,
) -> float:
    window = max(1, int(round(TAIL_WINDOW_S * rate)))
    start_sample = int(round(source_end * rate))
    cap_sample = int(round(cap * rate))
    if start_sample >= cap_sample or start_sample >= len(samples):
        return source_end

    lookback = max(window, int(round(TAIL_SPEECH_LOOKBACK_S * rate)))
    speech_rms = _rms(samples, start_sample - lookback, start_sample)
    floor = max(TAIL_ABS_FLOOR, speech_rms * TAIL_FLOOR_RATIO)
    if _rms(samples, start_sample, start_sample + window) < floor:
        return source_end

    quiet_needed = max(1, int(round(TAIL_QUIET_HOLD_S / TAIL_WINDOW_S)))
    quiet_run = 0
    quiet_started: int | None = None
    cursor = start_sample
    release = int(round(TAIL_RELEASE_S * rate))
    while cursor + window <= cap_sample:
        level = _rms(samples, cursor, cursor + window)
        if level >= floor:
            if stop_on_reloud and quiet_started is not None:
                cut = min(quiet_started + release, cap_sample, len(samples))
                return cut / rate
            quiet_run = 0
            quiet_started = None
        else:
            if quiet_started is None:
                quiet_started = cursor
            quiet_run += 1
            if quiet_run >= quiet_needed:
                cut = min(quiet_started + release, cap_sample, len(samples))
                return cut / rate
        cursor += window

    return min(cap, len(samples) / rate)


def extend_segment_tails(
    wav_path: Path,
    segments: list[Segment],
    source_duration: float,
    *,
    max_extend_s: float | None = None,
    neighbor_guard_s: float = 0.0,
    stop_on_reloud: bool = False,
) -> list[Segment]:
    if not segments or not wav_path.is_file():
        return segments

    loaded = _load_mono_pcm16(wav_path)
    if loaded is None:
        return segments
    samples, rate = loaded
    if rate <= 0 or not samples:
        return segments

    extend_s = settings.tail_max_extend_s if max_extend_s is None else max_extend_s
    file_end = min(source_duration, len(samples) / rate)
    extended: list[Segment] = []
    for index, segment in enumerate(segments):
        next_start = segments[index + 1].source_start if index + 1 < len(segments) else file_end
        neighbor_cap = next_start - neighbor_guard_s if neighbor_guard_s > 0 else next_start
        cap = min(segment.source_end + extend_s, neighbor_cap, file_end)
        cap = max(cap, segment.source_end)
        source_end = _extend_one_end(
            samples,
            rate,
            segment.source_end,
            cap,
            stop_on_reloud=stop_on_reloud,
        )
        extended.append(Segment(source_start=segment.source_start, source_end=source_end))
    return extended


def removed_seconds(source_duration: float, segments: list[Segment]) -> float:
    kept = sum(seg.duration for seg in segments)
    return max(0.0, source_duration - kept)
