from __future__ import annotations

import array
import math
import wave
from dataclasses import dataclass
from pathlib import Path

from app.config import settings
from app.schemas import ClipItem, SourceSegment

ENVELOPE_HOP_S = 0.01
NOISE_PERCENTILE = 10.0
SPEECH_PERCENTILE = 90.0
NOISE_FLOOR_MULT = 3.0
SPEECH_LEVEL_RATIO = 0.08
SHARED_BOUNDARY_EPS_S = 0.001

Range = tuple[float, float]
RangeId = tuple[int, int]


@dataclass(frozen=True)
class Envelope:
    hop_s: float
    rms: tuple[float, ...]

    @property
    def duration(self) -> float:
        return len(self.rms) * self.hop_s

    def index_at(self, time_s: float) -> int:
        if not self.rms:
            return 0
        return max(0, min(len(self.rms) - 1, int(round(time_s / self.hop_s))))

    def time_at(self, index: int) -> float:
        return index * self.hop_s

    def value_at(self, time_s: float) -> float:
        if not self.rms:
            return 0.0
        return self.rms[self.index_at(time_s)]


_envelope_cache: dict[tuple[str, int, int], Envelope] = {}


def _percentile(values: tuple[float, ...], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * (pct / 100.0)
    lo = int(math.floor(rank))
    hi = min(len(ordered) - 1, int(math.ceil(rank)))
    if lo == hi:
        return float(ordered[lo])
    frac = rank - lo
    return ordered[lo] * (1.0 - frac) + ordered[hi] * frac


def speech_threshold(envelope: Envelope) -> float:
    noise = _percentile(envelope.rms, NOISE_PERCENTILE)
    speech = _percentile(envelope.rms, SPEECH_PERCENTILE)
    return max(noise * NOISE_FLOOR_MULT, speech * SPEECH_LEVEL_RATIO)


def compute_envelope(samples: array.array, rate: int, hop_s: float = ENVELOPE_HOP_S) -> Envelope:
    if rate <= 0 or not samples:
        return Envelope(hop_s=hop_s, rms=())
    hop = max(1, int(round(hop_s * rate)))
    actual_hop = hop / rate
    rms: list[float] = []
    n = len(samples)
    cursor = 0
    while cursor < n:
        end = min(cursor + hop, n)
        total = 0.0
        for index in range(cursor, end):
            value = samples[index]
            total += value * value
        rms.append(math.sqrt(total / (end - cursor)))
        cursor += hop
    return Envelope(hop_s=actual_hop, rms=tuple(rms))


def load_envelope(wav_path: Path) -> Envelope | None:
    try:
        stat = wav_path.stat()
    except OSError:
        return None
    key = (str(wav_path.resolve()), int(stat.st_mtime_ns), int(stat.st_size))
    cached = _envelope_cache.get(key)
    if cached is not None:
        return cached
    try:
        with wave.open(str(wav_path), "rb") as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
                return None
            rate = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
    except Exception:
        return None
    samples = array.array("h")
    samples.frombytes(frames)
    envelope = compute_envelope(samples, rate)
    _envelope_cache[key] = envelope
    return envelope


def _window_indices(envelope: Envelope, center: float, search: float) -> range:
    lo = envelope.index_at(center - search)
    hi = envelope.index_at(center + search)
    return range(lo, hi + 1)


def _quietest_time(
    envelope: Envelope,
    center: float,
    search: float,
    thr: float,
    *,
    prefer_earlier: bool,
) -> float | None:
    best_index: int | None = None
    best_rms = 0.0
    best_dist = 0.0
    for index in _window_indices(envelope, center, search):
        level = envelope.rms[index]
        if level >= thr:
            continue
        dist = abs(envelope.time_at(index) - center)
        better = False
        if best_index is None or level < best_rms - 1e-9:
            better = True
        elif abs(level - best_rms) <= 1e-9:
            if dist < best_dist - 1e-9:
                better = True
            elif abs(dist - best_dist) <= 1e-9:
                better = index < best_index if prefer_earlier else index > best_index
        if better:
            best_index = index
            best_rms = level
            best_dist = dist
    if best_index is None:
        return None
    return envelope.time_at(best_index)


def _first_loud(envelope: Envelope, start: float, thr: float) -> float | None:
    for index in range(envelope.index_at(start), len(envelope.rms)):
        if envelope.rms[index] >= thr:
            return envelope.time_at(index)
    return None


def _last_loud(envelope: Envelope, end: float, thr: float) -> float | None:
    for index in range(envelope.index_at(end), -1, -1):
        if envelope.rms[index] >= thr:
            return envelope.time_at(index)
    return None


def _apply_max_trim(original: float, proposed: float, max_trim: float | None) -> float:
    if max_trim is None:
        return proposed
    delta = proposed - original
    if abs(delta) <= max_trim:
        return proposed
    return original + math.copysign(max_trim, delta)


def _snap_start(
    start: float,
    envelope: Envelope,
    thr: float,
    *,
    pad: float,
    search: float,
    max_trim: float | None,
    loud_adjust: bool = True,
) -> float:
    if loud_adjust and envelope.value_at(start) >= thr:
        quiet = _quietest_time(envelope, start, search, thr, prefer_earlier=True)
        if quiet is not None:
            start = _apply_max_trim(start, quiet, max_trim)
    if envelope.value_at(start) >= thr:
        return start
    loud = _first_loud(envelope, start, thr)
    if loud is None:
        return start
    if not loud_adjust and loud - start <= search:
        return start
    proposed = max(0.0, loud - pad)
    if proposed <= start:
        return start
    return _apply_max_trim(start, proposed, max_trim)


def _snap_end(
    end: float,
    envelope: Envelope,
    thr: float,
    *,
    pad: float,
    search: float,
    max_trim: float | None,
    loud_adjust: bool = True,
) -> float:
    if loud_adjust and envelope.value_at(end) >= thr:
        quiet = _quietest_time(envelope, end, search, thr, prefer_earlier=False)
        if quiet is not None:
            end = _apply_max_trim(end, quiet, max_trim)
    if envelope.value_at(end) >= thr:
        return end
    loud = _last_loud(envelope, end, thr)
    if loud is None:
        return end
    if not loud_adjust and end - loud <= search:
        return end
    proposed = loud + pad
    if proposed >= end:
        return end
    return _apply_max_trim(end, proposed, max_trim)


def _range_ok(start: float, end: float, min_duration: float) -> bool:
    return end - start >= min_duration - 1e-9


def _flatten(clip_ranges: list[list[Range]]) -> list[RangeId]:
    items: list[tuple[float, int, int]] = []
    for clip_index, ranges in enumerate(clip_ranges):
        for range_index, (start, _end) in enumerate(ranges):
            items.append((start, clip_index, range_index))
    items.sort()
    return [(clip_index, range_index) for _start, clip_index, range_index in items]


def snap_boundaries(
    clip_ranges: list[list[Range]],
    envelope: Envelope,
    thr: float,
    *,
    neighbors: list[RangeId] | None = None,
    pad: float = 0.05,
    search: float = 0.3,
    max_trim: float | None = None,
    min_duration: float = 0.05,
    locked: set[RangeId] | tuple[RangeId, ...] = (),
) -> list[list[Range]]:
    locked_set = set(locked)
    order = list(neighbors) if neighbors is not None else _flatten(clip_ranges)
    snapped: list[list[list[float]]] = [[list(span) for span in ranges] for ranges in clip_ranges]
    originals = [[tuple(span) for span in ranges] for ranges in clip_ranges]
    shared_edges: set[tuple[RangeId, str]] = set()

    def get(rid: RangeId) -> list[float]:
        return snapped[rid[0]][rid[1]]

    def original_of(rid: RangeId) -> Range:
        return originals[rid[0]][rid[1]]

    for prev_id, next_id in zip(order, order[1:]):
        prev_end = get(prev_id)[1]
        next_start = get(next_id)[0]
        if abs(prev_end - next_start) > SHARED_BOUNDARY_EPS_S:
            continue
        shared_edges.add((prev_id, "end"))
        shared_edges.add((next_id, "start"))
        if prev_id in locked_set or next_id in locked_set:
            continue
        meet = (prev_end + next_start) / 2.0
        quiet = _quietest_time(envelope, meet, search, thr, prefer_earlier=True)
        if quiet is None:
            continue
        prev_start = get(prev_id)[0]
        next_end = get(next_id)[1]
        if not _range_ok(prev_start, quiet, min_duration) or not _range_ok(quiet, next_end, min_duration):
            continue
        get(prev_id)[1] = quiet
        get(next_id)[0] = quiet

    for rid in order:
        if rid in locked_set:
            continue
        start, end = get(rid)
        orig_start, orig_end = original_of(rid)
        if (rid, "start") not in shared_edges:
            start = _snap_start(start, envelope, thr, pad=pad, search=search, max_trim=max_trim)
        else:
            start = _snap_start(
                start,
                envelope,
                thr,
                pad=pad,
                search=search,
                max_trim=max_trim,
                loud_adjust=False,
            )
        if (rid, "end") not in shared_edges:
            end = _snap_end(end, envelope, thr, pad=pad, search=search, max_trim=max_trim)
        else:
            end = _snap_end(
                end,
                envelope,
                thr,
                pad=pad,
                search=search,
                max_trim=max_trim,
                loud_adjust=False,
            )
        if not _range_ok(start, end, min_duration):
            start, end = orig_start, orig_end
        get(rid)[0] = start
        get(rid)[1] = end

    for prev_id, next_id in zip(order, order[1:]):
        prev_span = get(prev_id)
        next_span = get(next_id)
        if next_span[0] + 1e-9 >= prev_span[1]:
            continue
        if next_id in locked_set and prev_id not in locked_set:
            prev_span[1] = min(prev_span[1], next_span[0])
        elif prev_id in locked_set and next_id not in locked_set:
            next_span[0] = max(next_span[0], prev_span[1])
        else:
            meet = (prev_span[1] + next_span[0]) / 2.0
            if prev_id not in locked_set:
                prev_span[1] = meet
            if next_id not in locked_set:
                next_span[0] = meet
        if not _range_ok(prev_span[0], prev_span[1], min_duration):
            prev_span[0], prev_span[1] = original_of(prev_id)
        if not _range_ok(next_span[0], next_span[1], min_duration):
            next_span[0], next_span[1] = original_of(next_id)
        if next_span[0] + 1e-9 < prev_span[1]:
            prev_span[0], prev_span[1] = original_of(prev_id)
            next_span[0], next_span[1] = original_of(next_id)

    return [[(span[0], span[1]) for span in ranges] for ranges in snapped]


def _clip_spans(clip: ClipItem) -> list[Range]:
    if clip.ranges:
        return [(span.source_start, span.source_end) for span in clip.ranges]
    return [(clip.source_start, clip.source_end)]


def snap_studio_clips(
    clips: list[ClipItem],
    wav_path: Path,
    *,
    pad: float = 0.05,
    search: float = 0.3,
    min_duration: float | None = None,
    locked_ids: set[str] | tuple[str, ...] = (),
) -> list[ClipItem]:
    if not clips:
        return clips
    envelope = load_envelope(wav_path)
    if envelope is None or not envelope.rms:
        return clips
    min_len = settings.min_segment_seconds if min_duration is None else min_duration
    locked_id_set = set(locked_ids)
    clip_ranges = [_clip_spans(clip) for clip in clips]
    locked: set[RangeId] = set()
    for clip_index, clip in enumerate(clips):
        if clip.id in locked_id_set:
            for range_index in range(len(clip_ranges[clip_index])):
                locked.add((clip_index, range_index))
    snapped = snap_boundaries(
        clip_ranges,
        envelope,
        speech_threshold(envelope),
        pad=pad,
        search=search,
        min_duration=min_len,
        locked=locked,
    )
    updated: list[ClipItem] = []
    for clip, ranges in zip(clips, snapped, strict=True):
        spans = [SourceSegment(source_start=start, source_end=end) for start, end in ranges]
        duration = sum(max(0.0, end - start) for start, end in ranges)
        source_start = min(start for start, _end in ranges)
        source_end = max(end for _start, end in ranges)
        updated.append(
            clip.model_copy(
                update={
                    "source_start": source_start,
                    "source_end": source_end,
                    "duration": duration,
                    "ranges": spans,
                }
            )
        )
    return updated
