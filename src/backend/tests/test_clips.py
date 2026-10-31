from __future__ import annotations

import pytest

from app.services.clips import (
    build_segment_clips,
    find_restart_index,
    group_clips_by_text,
    is_junk_token,
    normalize_text,
    similarity,
    split_restart_clips,
    word_timing_untrusted,
)
from app.services.segments import Segment, Word

FULL_LINE = "increases timeout limit from 15 to 90 minutes"
PREFIX = "increases timeout limit from"
SUFFIX = "15 to 90 minutes"


def test_normalize_text_strips_fillers_and_punctuation() -> None:
    assert normalize_text("Um, hello, you know world!") == "hello world"
    assert normalize_text("you can lock the driver") == "you can lock the driver"
    assert normalize_text("Like, the timeout increased") == "the timeout increased"


def test_retake_prefix_counts_as_full_match() -> None:
    a = "the quick brown fox jumps over"
    b = "the quick brown fox sits down"
    assert similarity(a, b) == 1.0


def test_suffix_and_containment_count_as_full_match() -> None:
    assert similarity(SUFFIX, FULL_LINE) == 1.0
    assert similarity(
        "the quick brown fox jumps over the lazy dog",
        "jumps over the lazy dog",
    ) == 1.0


def test_short_fragment_does_not_containment_match() -> None:
    assert similarity("minutes", FULL_LINE) < 1.0
    mapping = group_clips_by_text(
        [
            ("a", "minutes"),
            ("b", FULL_LINE),
        ],
        threshold=0.5,
    )
    assert mapping["a"] != mapping["b"]


def test_group_clips_merges_similar_takes() -> None:
    mapping = group_clips_by_text(
        [
            ("a", "the quick brown fox jumps"),
            ("b", "the quick brown fox sits"),
            ("c", "completely different sentence here"),
        ],
        threshold=0.5,
    )
    assert mapping["a"] == mapping["b"]
    assert mapping["c"] != mapping["a"]


def test_group_clips_containment_and_order_independent() -> None:
    mapping = group_clips_by_text(
        [
            ("prefix", PREFIX),
            ("suffix", SUFFIX),
            ("full", FULL_LINE),
        ],
        threshold=0.5,
    )
    assert mapping["prefix"] == mapping["suffix"] == mapping["full"]


def test_distinct_sentences_are_not_grouped_by_shared_but() -> None:
    now_due = "now due to recent but due to recent"
    mashup = "now due to but due to but due to"
    cloud = "but due to recent changes in how cloud workloads are heavily utilized"
    wait_short = "but wait"
    wait_full = "but wait there is one important catch here"

    mapping = group_clips_by_text(
        [
            ("now", now_due),
            ("mashup", mashup),
            ("cloud", cloud),
            ("wait_short", wait_short),
            ("wait_full", wait_full),
        ],
        threshold=0.5,
    )
    assert mapping["now"] == mapping["mashup"]
    assert mapping["wait_short"] == mapping["wait_full"]
    assert mapping["cloud"] != mapping["now"]
    assert mapping["cloud"] != mapping["wait_full"]
    assert mapping["now"] != mapping["wait_full"]
    assert len({mapping["now"], mapping["cloud"], mapping["wait_full"]}) == 3


def test_short_but_wait_does_not_match_but_due_to() -> None:
    assert similarity("but wait", "but due to recent changes in how cloud workloads") == 0.0


def test_build_segment_clips_assigns_groups_and_words() -> None:
    segments = [
        Segment(source_start=0.0, source_end=1.0),
        Segment(source_start=2.0, source_end=3.0),
    ]
    words = [
        Word("hello", 0.1, 0.4),
        Word("there", 0.5, 0.8),
        Word("goodbye", 2.1, 2.6),
    ]
    clips, groups = build_segment_clips("take", segments, words, similarity_threshold=0.9)
    assert len(clips) == 2
    assert clips[0].id == "take_seg_000"
    assert clips[0].text == "hello there"
    assert clips[1].text == "goodbye"
    assert all(clip.group_id != "pending" for clip in clips)
    grouped_ids = {clip_id for group in groups for clip_id in group.clip_ids}
    assert grouped_ids == {"take_seg_000", "take_seg_001"}


def test_unrelated_neighbors_are_not_merged() -> None:
    segments = [
        Segment(source_start=0.0, source_end=1.0),
        Segment(source_start=1.2, source_end=2.0),
        Segment(source_start=8.0, source_end=10.0),
    ]
    words = [
        Word("hello", 0.1, 0.4),
        Word("there", 0.5, 0.8),
        Word("goodbye", 1.3, 1.8),
        Word("completely", 8.1, 8.4),
        Word("different", 8.5, 8.9),
        Word("sentence", 9.0, 9.5),
    ]
    clips, _groups = build_segment_clips("take", segments, words, similarity_threshold=0.5)
    assert len(clips) == 3
    assert clips[0].text == "hello there"
    assert clips[1].text == "goodbye"


def test_continuation_fragments_merge_when_full_take_exists() -> None:
    segments = [
        Segment(source_start=0.0, source_end=2.0),
        Segment(source_start=2.5, source_end=4.0),
        Segment(source_start=10.0, source_end=14.0),
    ]
    words = [
        Word("increases", 0.1, 0.4),
        Word("timeout", 0.5, 0.8),
        Word("limit", 0.9, 1.2),
        Word("from", 1.3, 1.6),
        Word("15", 2.6, 2.8),
        Word("to", 2.9, 3.0),
        Word("90", 3.1, 3.3),
        Word("minutes", 3.4, 3.8),
        Word("increases", 10.1, 10.4),
        Word("timeout", 10.5, 10.8),
        Word("limit", 10.9, 11.2),
        Word("from", 11.3, 11.6),
        Word("15", 11.7, 11.9),
        Word("to", 12.0, 12.1),
        Word("90", 12.2, 12.4),
        Word("minutes", 12.5, 13.0),
    ]
    clips, groups = build_segment_clips("take", segments, words, similarity_threshold=0.5)
    assert len(clips) == 2
    assert clips[0].text == FULL_LINE
    assert clips[0].source_start == 0.0
    assert clips[0].source_end == 4.0
    assert clips[0].duration == pytest.approx(3.5)
    assert [(span.source_start, span.source_end) for span in clips[0].ranges] == [
        (0.0, 2.0),
        (2.5, 4.0),
    ]
    assert clips[1].text == FULL_LINE
    assert len(groups) == 1
    assert groups[0].clip_ids == ["take_seg_000", "take_seg_001"]
    assert groups[0].label == FULL_LINE


def test_wide_gap_continuation_stays_split_but_same_group() -> None:
    segments = [
        Segment(source_start=0.0, source_end=2.0),
        Segment(source_start=8.5, source_end=10.0),
        Segment(source_start=16.0, source_end=20.0),
    ]
    words = [
        Word("increases", 0.1, 0.4),
        Word("timeout", 0.5, 0.8),
        Word("limit", 0.9, 1.2),
        Word("from", 1.3, 1.6),
        Word("15", 8.6, 8.8),
        Word("to", 8.9, 9.0),
        Word("90", 9.1, 9.3),
        Word("minutes", 9.4, 9.8),
        Word("increases", 16.1, 16.4),
        Word("timeout", 16.5, 16.8),
        Word("limit", 16.9, 17.2),
        Word("from", 17.3, 17.6),
        Word("15", 17.7, 17.9),
        Word("to", 18.0, 18.1),
        Word("90", 18.2, 18.4),
        Word("minutes", 18.5, 19.0),
    ]
    clips, groups = build_segment_clips("take", segments, words, similarity_threshold=0.5)
    assert len(clips) == 3
    assert {clip.group_id for clip in clips} == {groups[0].id}
    assert groups[0].label == FULL_LINE


def _word_timings(tokens: list[str], t0: float = 0.1, step: float = 0.3) -> list[Word]:
    words: list[Word] = []
    t = t0
    for token in tokens:
        words.append(Word(token, t, t + 0.2))
        t += step
    return words


OPENING = ["AWS", "Lambda", "has", "officially", "increased", "its", "timeout", "limit", "from"]
COMPLETED = OPENING + ["15", "to", "90", "minutes"]


def test_find_restart_index_detects_repeated_opening() -> None:
    from app.schemas import WordTiming

    words = [WordTiming(text=w.text, start=w.start, end=w.end) for w in _word_timings(OPENING + COMPLETED)]
    assert find_restart_index(words) == len(OPENING)


def test_short_echo_is_not_a_restart() -> None:
    from app.schemas import WordTiming

    words = [
        WordTiming(text=w.text, start=w.start, end=w.end)
        for w in _word_timings(["hello", "there", "goodbye", "hello", "there", "friend"])
    ]
    assert find_restart_index(words) is None


def test_restart_inside_clip_splits_and_flags_false_start() -> None:
    restart_tokens = OPENING + COMPLETED
    clean_tokens = COMPLETED
    t_clean = 20.0
    words = _word_timings(restart_tokens, t0=0.1) + _word_timings(clean_tokens, t0=t_clean)
    last_restart = 0.1 + 0.3 * (len(restart_tokens) - 1) + 0.2
    segments = [
        Segment(source_start=0.0, source_end=last_restart + 0.1),
        Segment(source_start=t_clean - 0.05, source_end=t_clean + 0.3 * len(clean_tokens)),
    ]
    clips, groups = build_segment_clips("take", segments, words, similarity_threshold=0.5)
    assert len(clips) == 3
    assert clips[0].false_start is True
    assert clips[1].false_start is False
    assert clips[2].false_start is False
    assert clips[0].group_id == clips[1].group_id == clips[2].group_id
    assert "AWS Lambda has officially" in clips[1].text
    assert len(groups) == 1
    assert groups[0].clip_ids == ["take_seg_000", "take_seg_001", "take_seg_002"]


def test_clean_take_is_not_split() -> None:
    words = _word_timings(COMPLETED)
    last = 0.1 + 0.3 * (len(COMPLETED) - 1) + 0.2
    clips, _groups = build_segment_clips(
        "take",
        [Segment(source_start=0.0, source_end=last + 0.1)],
        words,
        similarity_threshold=0.5,
    )
    assert len(clips) == 1
    assert clips[0].false_start is False
    assert clips[0].text.startswith("AWS Lambda has officially")


def test_double_restart_yields_two_false_starts() -> None:
    from app.schemas import ClipItem, WordTiming

    tokens = OPENING + OPENING + COMPLETED
    words = [WordTiming(text=w.text, start=w.start, end=w.end) for w in _word_timings(tokens)]
    clip = ClipItem(
        id="take_seg_000",
        index=0,
        source_start=0.0,
        source_end=words[-1].end + 0.1,
        duration=words[-1].end + 0.1,
        text=" ".join(t.text for t in words),
        group_id="g1",
        words=words,
    )
    split = split_restart_clips([clip], "take")
    assert len(split) == 3
    assert split[0].false_start is True
    assert split[1].false_start is True
    assert split[2].false_start is False
    assert split[0].group_id == split[1].group_id == split[2].group_id == "g1"


HELLO_LINE = "There was a mistake in Hello interview Uber system design"
HELLO_PREFIX = "There was a mistake in Hello"
HELLO_SUFFIX = "interview Uber system design"
HELLO_MISSING = "There was a mistake in Uber system design"
HELLO_MISSTATE = "There was a mistake in Hello interview Lyft system design"
HELLO_NO_ARTICLE = "There was mistake in Hello interview Uber system design"
HELLO_RUNON = "There was a mistake in Hello interview Uber system design The next topic starts here"


def _clips_from_lines(*lines: str, gap: float = 2.0):
    segments: list[Segment] = []
    words: list[Word] = []
    t = 0.1
    for line in lines:
        timed = _word_timings(line.split(), t0=t)
        words.extend(timed)
        segments.append(Segment(source_start=t - 0.05, source_end=timed[-1].end + 0.05))
        t = timed[-1].end + gap
    return build_segment_clips("take", segments, words, similarity_threshold=0.5)


def _by_text(clips):
    return {clip.text: clip for clip in clips}


def test_prefix_fragment_is_cut_off() -> None:
    clips, groups = _clips_from_lines(HELLO_PREFIX, HELLO_LINE)
    by_text = _by_text(clips)
    assert len(groups) == 1
    assert by_text[HELLO_PREFIX].delivery_issue == "cut_off"
    assert by_text[HELLO_LINE].delivery_issue is None
    assert by_text[HELLO_PREFIX].group_id == by_text[HELLO_LINE].group_id


def test_suffix_fragment_starts_late() -> None:
    clips, groups = _clips_from_lines(HELLO_SUFFIX, HELLO_LINE)
    by_text = _by_text(clips)
    assert len(groups) == 1
    assert by_text[HELLO_SUFFIX].delivery_issue == "starts_late"
    assert by_text[HELLO_LINE].delivery_issue is None


def test_interior_drop_is_missing_words() -> None:
    clips, groups = _clips_from_lines(HELLO_MISSING, HELLO_LINE)
    by_text = _by_text(clips)
    assert len(groups) == 1
    assert by_text[HELLO_MISSING].delivery_issue == "missing_words"
    assert by_text[HELLO_LINE].delivery_issue is None


def test_swapped_content_word_is_misstatement() -> None:
    clips, groups = _clips_from_lines(HELLO_MISSTATE, HELLO_LINE)
    by_text = _by_text(clips)
    assert len(groups) == 1
    assert by_text[HELLO_MISSTATE].delivery_issue == "misstatement"
    assert by_text[HELLO_LINE].delivery_issue is None


def test_function_word_only_difference_stays_clean() -> None:
    clips, groups = _clips_from_lines(HELLO_NO_ARTICLE, HELLO_LINE)
    by_text = _by_text(clips)
    assert len(groups) == 1
    assert by_text[HELLO_NO_ARTICLE].delivery_issue is None
    assert by_text[HELLO_LINE].delivery_issue is None


def test_run_on_stays_clean_and_group_uses_reference_label() -> None:
    clips, groups = _clips_from_lines(HELLO_LINE, HELLO_RUNON)
    by_text = _by_text(clips)
    assert len(groups) == 1
    assert by_text[HELLO_LINE].delivery_issue is None
    assert by_text[HELLO_RUNON].delivery_issue is None
    assert groups[0].label == HELLO_LINE


def test_false_start_is_not_also_flagged_incomplete() -> None:
    restart_tokens = HELLO_PREFIX.split() + HELLO_LINE.split()
    words = _word_timings(restart_tokens, t0=0.1) + _word_timings(HELLO_LINE.split(), t0=20.0)
    last_restart = 0.1 + 0.3 * (len(restart_tokens) - 1) + 0.2
    segments = [
        Segment(source_start=0.0, source_end=last_restart + 0.1),
        Segment(source_start=19.95, source_end=20.0 + 0.3 * len(HELLO_LINE.split())),
    ]
    clips, groups = build_segment_clips("take", segments, words, similarity_threshold=0.5)
    false_starts = [clip for clip in clips if clip.false_start]
    assert false_starts
    assert all(clip.delivery_issue is None for clip in false_starts)
    assert len(groups) == 1


def test_single_clip_group_stays_unmarked() -> None:
    clips, groups = _clips_from_lines("Completely unrelated unique sentence spoken once")
    assert len(clips) == 1
    assert len(groups) == 1
    assert clips[0].delivery_issue is None
    assert clips[0].false_start is False


def test_two_word_fragment_does_not_bridge_groups() -> None:
    mapping = group_clips_by_text(
        [
            ("a", "There was a mistake in Hello interview Uber system design"),
            ("bridge", "There was"),
            ("b", "There was another issue in the payment service"),
        ],
        threshold=0.7,
        stem="take",
    )
    assert mapping["a"] != mapping["b"]
    assert mapping["bridge"] in {mapping["a"], mapping["b"]}


def test_lower_fuzzy_threshold_groups_more_takes() -> None:
    left = "kubernetes rolling updates keep old pods until new ones pass"
    right = "kubernetes rolling upgrades keep old pods until the new ones pass"
    ratio = similarity(normalize_text(left), normalize_text(right))
    loose = group_clips_by_text([("a", left), ("b", right)], threshold=0.5, stem="t")
    tight = group_clips_by_text([("a", left), ("b", right)], threshold=0.95, stem="t")
    assert ratio < 0.95
    assert ratio >= 0.5
    assert loose["a"] == loose["b"]
    assert tight["a"] != tight["b"]


def test_group_ids_are_stable_across_rebuilds() -> None:
    segments = [
        Segment(source_start=0.0, source_end=1.0),
        Segment(source_start=2.0, source_end=3.0),
    ]
    words = [
        Word("hello", 0.1, 0.4),
        Word("there", 0.5, 0.8),
        Word("goodbye", 2.1, 2.6),
    ]
    first, groups_a = build_segment_clips("take", segments, words, similarity_threshold=0.9)
    second, groups_b = build_segment_clips("take", segments, words, similarity_threshold=0.9)
    assert [g.id for g in groups_a] == [g.id for g in groups_b]
    assert first[0].group_id == second[0].group_id
    assert first[0].group_id.startswith("take_g")


def test_false_start_split_applies_pad() -> None:
    from app.schemas import ClipItem, WordTiming

    tokens = OPENING + COMPLETED
    words = [WordTiming(text=w.text, start=w.start, end=w.end) for w in _word_timings(tokens)]
    clip = ClipItem(
        id="take_seg_000",
        index=0,
        source_start=0.0,
        source_end=words[-1].end + 0.1,
        duration=words[-1].end + 0.1,
        text=" ".join(t.text for t in words),
        group_id="g1",
        words=words,
    )
    split = split_restart_clips([clip], "take", pad=0.05)
    left_last = words[len(OPENING) - 1].end
    right_first = words[len(OPENING)].start
    assert split[0].source_end == pytest.approx(min(left_last + 0.05, right_first))
    assert split[1].source_start <= right_first
    assert split[0].source_end <= split[1].source_start


def test_junk_tokens_are_dropped_from_clip_text() -> None:
    assert is_junk_token("oミ", latin_transcript=True)
    assert is_junk_token(".C", latin_transcript=True)
    assert is_junk_token("id.?", latin_transcript=True)
    assert not is_junk_token("don't", latin_transcript=True)
    words = [
        Word("hello", 0.1, 0.4),
        Word("oミ", 0.45, 0.5),
        Word(".C", 0.52, 0.55),
        Word("id.?", 0.56, 0.6),
        Word("there", 0.7, 1.0),
    ]
    clips, _groups = build_segment_clips(
        "take",
        [Segment(source_start=0.0, source_end=1.1)],
        words,
        drop_junk_tokens=True,
        language="en",
    )
    assert clips[0].text == "hello there"
    assert [word.text for word in clips[0].words] == ["hello", "there"]
    assert clips[0].words[0].start == pytest.approx(0.1)
    assert clips[0].words[1].end == pytest.approx(1.0)


def test_untrusted_restart_cut_ignores_bad_word_times() -> None:
    from app.schemas import ClipItem, WordTiming

    tokens = OPENING + COMPLETED
    words = [WordTiming(text=w.text, start=w.start, end=w.end) for w in _word_timings(tokens)]
    boundary = words[len(OPENING)]
    words[len(OPENING)] = WordTiming(text=boundary.text, start=boundary.start, end=boundary.start)
    words[len(OPENING) - 1] = WordTiming(
        text=words[len(OPENING) - 1].text,
        start=words[len(OPENING) - 1].start,
        end=words[len(OPENING) - 1].start + 1.5,
    )
    assert word_timing_untrusted(words[len(OPENING)])
    assert word_timing_untrusted(words[len(OPENING) - 1])
    clip = ClipItem(
        id="take_seg_000",
        index=0,
        source_start=0.0,
        source_end=words[-1].end + 0.1,
        duration=words[-1].end + 0.1,
        text=" ".join(t.text for t in words),
        group_id="g1",
        words=words,
    )
    trusted_left = words[len(OPENING) - 2].end
    trusted_right = words[len(OPENING) + 1].start
    split = split_restart_clips([clip], "take", pad=0.05, avoid_untrusted_cuts=True)
    mid = (trusted_left + trusted_right) / 2.0
    assert split[0].source_end == pytest.approx(mid)
    assert split[1].source_start == pytest.approx(mid)
    assert split[0].source_end != pytest.approx(words[len(OPENING) - 1].end)
    assert split[1].source_start != pytest.approx(boundary.start)

