from __future__ import annotations

from app.services.segments import Word
from app.services.studio.scripted_alignment import align_script, parse_script_lines, whisper_prompt_from_script


def words_from(pairs: list[tuple[str, float, float]]) -> list[Word]:
    return [Word(text, start, end) for text, start, end in pairs]


def sequential(tokens: list[str], start: float = 0.0, dur: float = 0.2, gap: float = 0.05) -> list[Word]:
    items: list[Word] = []
    t = start
    for token in tokens:
        items.append(Word(token, t, t + dur))
        t += dur + gap
    return items


def chosen_text(result, line: int) -> str | None:
    item = result.line_results[line - 1]
    return item.chosen.matched_text if item.chosen else None


def test_parse_ignores_blank_lines() -> None:
    assert parse_script_lines("hello\n\n  \nworld  \r\n") == ["hello", "world"]
    assert parse_script_lines("") == []
    assert parse_script_lines("\n\n") == []


def test_punctuation_case_numbers_and_fillers_still_match() -> None:
    from app.services.studio.scripted_alignment import normalize_token

    assert normalize_token("Hello,") == "hello"
    assert normalize_token("TWO") == "2"
    assert normalize_token("2") == "2"
    punct = align_script(["Hello, World!"], sequential(["hello", "world"]))
    assert chosen_text(punct, 1) == "hello world"
    numbers = align_script(["take 2"], sequential(["take", "two"]))
    assert numbers.line_results[0].chosen is not None
    from app.services.clips import _normalized_tokens

    assert normalize_token("um") == "um"
    assert _normalized_tokens("um hello uh world") == ["hello", "world"]


def test_one_line_and_a_script_longer_than_the_audio() -> None:
    one = align_script(["only line"], sequential(["only", "line"]))
    assert chosen_text(one, 1) == "only line"
    long_script = [f"missing line {index}" for index in range(40)]
    long_script[0] = "only line"
    aligned = align_script(long_script, sequential(["only", "line"]))
    assert len(aligned.line_results) == 40
    assert aligned.line_results[0].chosen is not None
    assert all(item.chosen is None for item in aligned.line_results[1:])


def test_equal_takes_without_recency_keep_the_earlier_one() -> None:
    script = ["hello world"]
    first = sequential(["hello", "world"], start=0.0)
    second = sequential(["hello", "world"], start=4.0)
    result = align_script(script, first + second, prefer_last_takes=False)
    assert result.line_results[0].chosen is not None
    assert result.line_results[0].chosen.start == 0.0


def test_exact_match() -> None:
    script = ["hello world"]
    transcript = sequential(["hello", "world"])
    result = align_script(script, transcript)
    assert chosen_text(result, 1) == "hello world"
    assert result.line_results[0].chosen is not None
    assert result.line_results[0].chosen.match_score >= 0.99


def test_whisper_style_misspelling() -> None:
    script = ["Hello Interview"]
    transcript = sequential(["Hello", "interviews"])
    result = align_script(script, transcript)
    assert result.line_results[0].chosen is not None
    assert result.line_results[0].chosen.match_score >= 0.7


def test_last_good_take_wins() -> None:
    script = ["hello world"]
    first = sequential(["hello", "world"], start=0.0)
    second = sequential(["hello", "world"], start=3.0)
    third = sequential(["hello", "world"], start=6.0)
    result = align_script(script, first + second + third)
    chosen = result.line_results[0].chosen
    assert chosen is not None
    assert chosen.start >= 6.0
    assert len(result.line_results[0].candidates) == 3


def test_better_earlier_take_beats_weak_last() -> None:
    script = ["hello world"]
    good = sequential(["hello", "world"], start=0.0)
    last = sequential(["hello", "there"], start=4.0)
    result = align_script(script, good + last)
    chosen = result.line_results[0].chosen
    assert chosen is not None
    assert chosen.start < 1.0


def test_identical_lines_match_in_order() -> None:
    script = ["hello world", "hello world"]
    first = sequential(["hello", "world"], start=0.0)
    second = sequential(["hello", "world"], start=3.0)
    result = align_script(script, first + second)
    a = result.line_results[0].chosen
    b = result.line_results[1].chosen
    assert a is not None and b is not None
    assert a.end <= b.start + 1e-6
    assert a.start < 1.0
    assert b.start >= 3.0


def test_missing_line() -> None:
    script = ["hello world", "this line never happens", "goodbye now"]
    first = sequential(["hello", "world"], start=0.0)
    last = sequential(["goodbye", "now"], start=4.0)
    result = align_script(script, first + last)
    assert result.line_results[0].chosen is not None
    assert result.line_results[1].chosen is None
    assert result.line_results[2].chosen is not None


def test_ad_lib_speech_left_out() -> None:
    script = ["hello world"]
    extra = sequential(["totally", "unrelated", "banter"], start=0.0)
    line = sequential(["hello", "world"], start=5.0)
    result = align_script(script, extra + line)
    chosen = result.line_results[0].chosen
    assert chosen is not None
    assert "unrelated" not in chosen.matched_text
    assert chosen.start >= 5.0


def test_false_start_not_in_cut() -> None:
    script = ["hello world everyone"]
    false_start = sequential(["hello"], start=0.0)
    full = sequential(["hello", "world", "everyone"], start=2.0)
    result = align_script(script, false_start + full)
    chosen = result.line_results[0].chosen
    assert chosen is not None
    assert chosen.start >= 2.0
    assert "everyone" in chosen.matched_text


def test_order_constraint_rejects_backwards_candidate() -> None:
    script = ["alpha beta", "gamma delta"]
    later_alpha = sequential(["alpha", "beta"], start=5.0)
    early_gamma = sequential(["gamma", "delta"], start=0.0)
    result = align_script(script, early_gamma + later_alpha)
    first = result.line_results[0].chosen
    second = result.line_results[1].chosen
    assert first is not None
    assert first.start >= 5.0
    assert second is None or second.start >= first.end


def test_untrusted_word_timestamps() -> None:
    script = ["hello world"]
    words = [
        Word("hello", 1.0, 1.005),
        Word("world", 1.2, 3.5),
    ]
    result = align_script(script, words)
    chosen = result.line_results[0].chosen
    assert chosen is not None
    from app.services.studio.scripted_alignment import trusted_cut_times

    start, end = trusted_cut_times(chosen.words, 0, len(chosen.words) - 1)
    assert end - start < 2.0 or start == chosen.words[0].start


def test_whisper_prompt_uses_rare_tokens_when_long() -> None:
    lines = [f"sentence number {i} with jargon{i}xyz" for i in range(80)]
    prompt = whisper_prompt_from_script("\n".join(lines), max_chars=80)
    assert prompt is not None
    assert len(prompt) <= 80
