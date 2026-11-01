from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.segments import Word
from app.services.studio.transcribe_resume import ensure_wav, ensure_words, load_words, save_words, words_are_cached


def test_cached_words_skip_whisper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    wav = tmp_path / "source.wav"
    wav.write_bytes(b"RIFF" + b"\0" * 80)
    words = tmp_path / "words.json"
    save_words(words, [Word("alpha", 0.1, 0.4), Word("beta", 0.5, 0.8)])

    def boom(*_args, **_kwargs):
        raise AssertionError("Whisper ran")

    monkeypatch.setattr("app.services.studio.transcribe_resume.transcribe_wav", boom)
    assert ensure_words(wav, words) is False
    assert [word.text for word in load_words(words)] == ["alpha", "beta"]


def test_corrupt_words_json_is_still_treated_as_cached(tmp_path: Path) -> None:
    path = tmp_path / "words.json"
    path.write_text("{")
    assert words_are_cached(path) is True
    with pytest.raises(json.JSONDecodeError):
        load_words(path)


def test_missing_wav_extracts_and_a_missing_source_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "talk.wav"
    source.write_bytes(b"source")
    dest = tmp_path / "analysis" / "source.wav"
    calls: list[Path] = []

    def fake_extract(src: Path, wav_path: Path) -> None:
        calls.append(src)
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        wav_path.write_bytes(b"RIFF" + b"\0" * 80)

    monkeypatch.setattr("app.services.studio.transcribe_resume.extract_audio", fake_extract)
    assert ensure_wav(source, dest) is True
    assert calls == [source]
    assert ensure_wav(source, dest) is False

    missing = tmp_path / "gone.mp4"
    other = tmp_path / "other.wav"

    def missing_extract(src: Path, _wav: Path) -> None:
        raise FileNotFoundError(src)

    monkeypatch.setattr("app.services.studio.transcribe_resume.extract_audio", missing_extract)
    with pytest.raises(FileNotFoundError):
        ensure_wav(missing, other)
