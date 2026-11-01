from __future__ import annotations

import array
import math
import wave
from pathlib import Path

import pytest

from app.schemas import ClipItem, SourceSegment
from app.services.boundary_snap import (
    compute_envelope,
    load_envelope,
    snap_boundaries,
    snap_studio_clips,
    speech_threshold,
)
RATE = 16000


def _write_wav(path: Path, samples: list[int], rate: int = RATE) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(array.array("h", samples).tobytes())


def _tone(seconds: float, amplitude: int = 8000, rate: int = RATE) -> list[int]:
    n = int(round(seconds * rate))
    return [int(amplitude * math.sin(2 * math.pi * 440 * i / rate)) for i in range(n)]


def _silence(seconds: float, rate: int = RATE) -> list[int]:
    return [0] * int(round(seconds * rate))


def _envelope_from_wav(path: Path):
    samples = array.array("h")
    with wave.open(str(path), "rb") as wf:
        samples.frombytes(wf.readframes(wf.getnframes()))
        rate = wf.getframerate()
    envelope = compute_envelope(samples, rate)
    return envelope, speech_threshold(envelope)


def _clip(clip_id: str, start: float, end: float, ranges: list[tuple[float, float]] | None = None) -> ClipItem:
    spans = ranges or [(start, end)]
    return ClipItem(
        id=clip_id,
        index=0,
        source_start=start,
        source_end=end,
        duration=sum(right - left for left, right in spans),
        text="hello",
        group_id="g1",
        ranges=[SourceSegment(source_start=left, source_end=right) for left, right in spans],
    )


def test_loud_start_moves_to_silence_before_burst(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0) + _silence(0.5))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(1.05, 1.9)]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0][0] == pytest.approx(0.99, abs=0.03)
    assert snapped[0][0][0] < 1.0


def test_lead_in_silence_trims_to_pad(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.0, 1.9)]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0][0] == pytest.approx(0.95, abs=0.03)


def test_dead_air_trims_past_search_window(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(0.5))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.0, 1.4)]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0][0] == pytest.approx(0.95, abs=0.03)


def test_loud_end_moves_to_valley(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(0.5) + _tone(1.0) + _silence(0.8))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.5, 1.4)]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0][1] == pytest.approx(1.5, abs=0.05)


def test_tail_silence_trims_to_pad(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(0.2) + _tone(1.0) + _silence(1.0))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.2, 2.1)]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0][1] == pytest.approx(1.25, abs=0.04)


def test_shared_boundary_is_identical(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(1.0) + _silence(0.2) + _tone(1.0))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries(
        [[(0.0, 1.1)], [(1.1, 2.2)]],
        envelope,
        thr,
        neighbors=[(0, 0), (1, 0)],
        pad=0.05,
        search=0.3,
    )
    assert snapped[0][0][1] == pytest.approx(snapped[1][0][0])
    assert snapped[1][0][0] >= snapped[0][0][1] - 1e-9
    assert 1.0 <= snapped[0][0][1] <= 1.2


def test_no_overlap_or_negative_duration(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(0.4) + _silence(0.1) + _tone(0.4))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries(
        [[(0.0, 0.45)], [(0.45, 0.9)]],
        envelope,
        thr,
        neighbors=[(0, 0), (1, 0)],
        pad=0.05,
        search=0.3,
        min_duration=0.05,
    )
    assert snapped[0][0][1] <= snapped[1][0][0] + 1e-9
    assert snapped[0][0][1] - snapped[0][0][0] >= 0.05 - 1e-9
    assert snapped[1][0][1] - snapped[1][0][0] >= 0.05 - 1e-9


def test_multi_range_clip_snaps_each_span(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(0.5) + _tone(0.5) + _silence(0.5) + _tone(0.5) + _silence(0.3))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries(
        [[(0.0, 1.1), (1.4, 2.3)]],
        envelope,
        thr,
        pad=0.05,
        search=0.3,
    )
    assert len(snapped[0]) == 2
    assert snapped[0][0][0] == pytest.approx(0.45, abs=0.05)
    assert snapped[0][1][0] == pytest.approx(1.45, abs=0.05)
    assert snapped[0][0][1] <= snapped[0][1][0]


def test_short_clip_stays_unchanged(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(0.5) + _tone(1.0))
    envelope, thr = _envelope_from_wav(wav)
    original = (0.4, 0.44)
    snapped = snap_boundaries([[original]], envelope, thr, pad=0.05, search=0.3, min_duration=0.05)
    assert snapped[0][0] == original


def test_locked_range_is_not_snapped(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0))
    envelope, thr = _envelope_from_wav(wav)
    original = (0.0, 1.9)
    locked = snap_boundaries([[original]], envelope, thr, pad=0.05, search=0.3, locked={(0, 0)})
    unlocked = snap_boundaries([[original]], envelope, thr, pad=0.05, search=0.3)
    assert locked[0][0] == original
    assert unlocked[0][0][0] == pytest.approx(0.95, abs=0.04)


def test_snap_studio_clips_updates_duration(tmp_path: Path) -> None:
    wav = tmp_path / "source.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0))
    clip = _clip("c-0001", 0.0, 1.9)
    original_text = clip.text
    original_words = list(clip.words)
    snapped = snap_studio_clips([clip], wav, pad=0.05, search=0.3)
    assert snapped[0].source_start == pytest.approx(0.95, abs=0.04)
    assert snapped[0].duration == pytest.approx(snapped[0].source_end - snapped[0].source_start)
    assert snapped[0].text == original_text
    assert snapped[0].words == original_words


def test_envelope_cache_reuses_mtime(tmp_path: Path) -> None:
    wav = tmp_path / "source.wav"
    _write_wav(wav, _tone(0.2))
    first = load_envelope(wav)
    second = load_envelope(wav)
    assert first is second


def test_silent_file_stays_inside_and_positive(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(2.0))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.4, 1.2)]], envelope, thr, pad=0.05, search=0.3, min_duration=0.05)
    start, end = snapped[0][0]
    assert 0 <= start < end <= 2.0


def test_constant_noise_does_not_invent_a_valley(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(2.0, amplitude=8000))
    envelope, thr = _envelope_from_wav(wav)
    original = (0.4, 1.4)
    snapped = snap_boundaries([[original]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0] == pytest.approx(original, abs=0.02)


def test_clip_at_file_start_and_end_stays_in_range(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    samples = _tone(0.8) + _silence(0.4) + _tone(0.8)
    _write_wav(wav, samples)
    duration = len(samples) / RATE
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.0, 0.7)], [(duration - 0.7, duration)]], envelope, thr, pad=0.05, search=0.3)
    assert snapped[0][0][0] >= 0
    assert snapped[1][0][1] <= duration + 1e-6
    assert snapped[0][0][1] > snapped[0][0][0]
    assert snapped[1][0][1] > snapped[1][0][0]


def test_locked_shared_edge_stays_put(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(1.0) + _silence(0.2) + _tone(1.0))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries(
        [[(0.0, 1.1)], [(1.1, 2.2)]],
        envelope,
        thr,
        neighbors=[(0, 0), (1, 0)],
        pad=0.05,
        search=0.3,
        locked={(1, 0)},
    )
    assert snapped[1][0] == (1.1, 2.2)
    assert snapped[0][0][1] <= snapped[1][0][0] + 1e-9


def test_zero_search_does_not_hunt_for_a_valley(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0) + _silence(0.5))
    envelope, thr = _envelope_from_wav(wav)
    original = (1.05, 1.9)
    snapped = snap_boundaries([[original]], envelope, thr, pad=0.05, search=0.0)
    assert snapped[0][0][0] == pytest.approx(original[0], abs=0.02)


def test_span_between_min_duration_and_two_pads_stays_usable(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0))
    envelope, thr = _envelope_from_wav(wav)
    snapped = snap_boundaries([[(0.90, 0.98)]], envelope, thr, pad=0.05, search=0.3, min_duration=0.05)
    start, end = snapped[0][0]
    assert end - start >= 0.05 - 1e-9
    assert end > start


def test_second_snap_is_a_no_op(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0) + _silence(0.5))
    envelope, thr = _envelope_from_wav(wav)
    first = snap_boundaries([[(0.2, 1.9)]], envelope, thr, pad=0.05, search=0.3)
    second = snap_boundaries(first, envelope, thr, pad=0.05, search=0.3)
    assert second == first
    start, end = second[0][0]
    assert end > start


def test_max_trim_limits_how_far_a_loud_edge_moves(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _silence(1.0) + _tone(1.0) + _silence(0.5))
    envelope, thr = _envelope_from_wav(wav)
    free = snap_boundaries([[(1.05, 1.9)]], envelope, thr, pad=0.05, search=0.3)
    limited = snap_boundaries([[(1.05, 1.9)]], envelope, thr, pad=0.05, search=0.3, max_trim=0.02)
    assert abs(free[0][0][0] - 1.05) > 0.02
    assert abs(limited[0][0][0] - 1.05) <= 0.02 + 1e-6
