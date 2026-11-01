from __future__ import annotations

import array
import math
import wave
from pathlib import Path

import pytest

from app.services.segments import (
    Segment,
    Word,
    build_segments_from_words,
    extend_segment_tails,
    removed_seconds,
)

RATE = 16000


def _write_wav(path: Path, samples: list[int], rate: int = RATE) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        payload = array.array("h", samples)
        wf.writeframes(payload.tobytes())


def _tone(seconds: float, amplitude: int = 8000, rate: int = RATE) -> list[int]:
    n = int(round(seconds * rate))
    return [int(amplitude * math.sin(2 * math.pi * 440 * i / rate)) for i in range(n)]


def _silence(seconds: float, rate: int = RATE) -> list[int]:
    return [0] * int(round(seconds * rate))


def test_empty_words_yields_no_segments() -> None:
    assert (
        build_segments_from_words(
            [],
            silence_threshold=0.4,
            pad=0.05,
            source_duration=10,
        )
        == []
    )


def test_nearby_words_merge_into_one_segment() -> None:
    words = [
        Word("hello", 1.0, 1.2),
        Word("world", 1.3, 1.5),
    ]
    segments = build_segments_from_words(
        words,
        silence_threshold=0.4,
        pad=0.05,
        source_duration=10,
        min_segment_seconds=0.05,
    )
    assert len(segments) == 1
    assert segments[0].source_start == pytest.approx(0.95)
    assert segments[0].source_end == pytest.approx(1.55)


def test_gap_above_threshold_splits_segments() -> None:
    words = [
        Word("hello", 1.0, 1.2),
        Word("later", 3.0, 3.2),
    ]
    segments = build_segments_from_words(
        words,
        silence_threshold=0.4,
        pad=0.05,
        source_duration=10,
        min_segment_seconds=0.05,
    )
    assert len(segments) == 2
    assert segments[0].source_end < segments[1].source_start


def test_pad_clamps_to_source_bounds() -> None:
    words = [Word("hi", 0.0, 0.1)]
    segments = build_segments_from_words(
        words,
        silence_threshold=0.4,
        pad=0.5,
        source_duration=1.0,
        min_segment_seconds=0.05,
    )
    assert len(segments) == 1
    assert segments[0].source_start == 0.0
    assert segments[0].source_end == pytest.approx(0.6)


def test_short_segments_are_dropped() -> None:
    words = [Word("x", 1.0, 1.01)]
    segments = build_segments_from_words(
        words,
        silence_threshold=0.4,
        pad=0.0,
        source_duration=10,
        min_segment_seconds=0.5,
    )
    assert segments == []


def test_removed_seconds_is_source_minus_kept() -> None:
    words = [Word("hello", 1.0, 2.0)]
    segments = build_segments_from_words(
        words,
        silence_threshold=0.4,
        pad=0.0,
        source_duration=10,
        min_segment_seconds=0.05,
    )
    assert removed_seconds(10, segments) == pytest.approx(9.0)


def test_tail_extends_when_tone_continues_past_word_end(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(1.8) + _silence(1.2))
    segments = [Segment(source_start=0.05, source_end=1.0)]
    extended = extend_segment_tails(wav, segments, 3.0, max_extend_s=2.0)
    assert extended[0].source_start == pytest.approx(0.05)
    assert extended[0].source_end == pytest.approx(1.85, abs=0.05)


def test_tail_stays_when_already_silent_at_word_end(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(1.0) + _silence(1.0))
    segments = [Segment(source_start=0.0, source_end=1.0)]
    extended = extend_segment_tails(wav, segments, 2.0, max_extend_s=2.0)
    assert extended[0].source_end == pytest.approx(1.0)


def test_tail_stops_before_next_segment(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(3.0))
    segments = [
        Segment(source_start=0.0, source_end=1.0),
        Segment(source_start=1.3, source_end=2.0),
    ]
    extended = extend_segment_tails(wav, segments, 3.0, max_extend_s=2.0)
    assert extended[0].source_end == pytest.approx(1.3)
    assert extended[0].source_end <= segments[1].source_start
    assert extended[1].source_start == pytest.approx(1.3)


def test_tail_caps_at_max_extend(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(1.8) + _silence(1.2))
    segments = [Segment(source_start=0.05, source_end=1.0)]
    extended = extend_segment_tails(wav, segments, 3.0, max_extend_s=0.3)
    assert extended[0].source_end == pytest.approx(1.3, abs=0.05)
    assert extended[0].source_end - 1.0 <= 0.35


def test_tail_stops_before_next_segment_minus_guard(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(3.0))
    segments = [
        Segment(source_start=0.0, source_end=1.0),
        Segment(source_start=1.3, source_end=2.0),
    ]
    extended = extend_segment_tails(
        wav,
        segments,
        3.0,
        max_extend_s=2.0,
        neighbor_guard_s=0.02,
    )
    assert extended[0].source_end <= segments[1].source_start - 0.02 + 1e-6
    assert extended[0].source_end == pytest.approx(1.28, abs=0.03)


def test_tail_stops_when_audio_becomes_loud_again(tmp_path: Path) -> None:
    wav = tmp_path / "take.wav"
    _write_wav(wav, _tone(1.0) + _silence(0.08) + _tone(1.0))
    segments = [Segment(source_start=0.0, source_end=0.95)]
    extended = extend_segment_tails(
        wav,
        segments,
        2.08,
        max_extend_s=2.0,
        stop_on_reloud=True,
    )
    assert extended[0].source_end < 1.2
    assert extended[0].source_end == pytest.approx(1.05, abs=0.08)


def test_missing_wav_leaves_segments_unchanged(tmp_path: Path) -> None:
    segments = [Segment(source_start=0.0, source_end=1.0)]
    extended = extend_segment_tails(tmp_path / "missing.wav", segments, 2.0)
    assert extended is segments
    assert extended[0].source_end == pytest.approx(1.0)


def test_legacy_caller_uses_two_second_tail_and_studio_uses_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.config import settings
    from app.schemas import SilenceOptions
    from app.services.analysis import analyze_silence
    from app.services.segments import LEGACY_TAIL_MAX_EXTEND_S, TAIL_MAX_EXTEND_S

    assert LEGACY_TAIL_MAX_EXTEND_S == 2.0
    assert TAIL_MAX_EXTEND_S == 0.3
    assert settings.tail_max_extend_s == pytest.approx(0.3)

    captured: dict = {}

    def fake_extend(_wav, segments, _duration, **kwargs):
        captured.update(kwargs)
        return segments

    monkeypatch.setattr("app.services.analysis.extend_segment_tails", fake_extend)
    monkeypatch.setattr("app.services.analysis.transcribe_words", lambda *_a, **_k: [Word("hi", 0.2, 0.4)])
    monkeypatch.setattr(
        "app.services.analysis.probe_media",
        lambda _path: type("Probe", (), {"duration": 2.0, "fps": 30.0})(),
    )
    source = tmp_path / "talk.wav"
    source.write_bytes(b"x")
    analyze_silence(source, SilenceOptions())
    assert captured["max_extend_s"] == 2.0
    assert captured["neighbor_guard_s"] == 0.0
    assert captured["stop_on_reloud"] is False

    studio: dict = {}

    def fake_studio(_wav, segments, _duration, **kwargs):
        studio.update(kwargs)
        return segments

    monkeypatch.setattr("app.services.studio.analyze.extend_segment_tails", fake_studio)
    monkeypatch.setattr("app.services.studio.analyze.ensure_wav", lambda *_a, **_k: False)
    monkeypatch.setattr("app.services.studio.analyze.ensure_words", lambda *_a, **_k: False)
    monkeypatch.setattr("app.services.studio.analyze.load_words", lambda _path: [Word("hi", 0.2, 0.4)])
    monkeypatch.setattr(
        "app.services.studio.analyze.probe_media",
        lambda _path: type("Probe", (), {"duration": 2.0, "fps": 30.0})(),
    )
    monkeypatch.setattr("app.services.studio.analyze.snap_studio_clips", lambda clips, *_a, **_k: clips)
    from app.services.studio.analyze import run_transcript_pipeline
    from app.services.studio.common.project import PipelineOptions, ProjectAudio

    analysis = tmp_path / "analysis"
    analysis.mkdir()
    (analysis / "words.json").write_text('{"words":[]}')
    run_transcript_pipeline(
        ProjectAudio(source=source, analysis_dir=analysis),
        PipelineOptions(silence_threshold=0.4, pad=0.05, similarity_threshold=0.7, snap_to_audio=False),
    )
    assert studio["max_extend_s"] == pytest.approx(0.3)
    assert studio["neighbor_guard_s"] == pytest.approx(0.02)
    assert studio["stop_on_reloud"] is True
