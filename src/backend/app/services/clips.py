from __future__ import annotations

import re
from collections.abc import Callable
from difflib import SequenceMatcher

from app.config import settings
from app.schemas import ClipGroup, ClipItem, DeliveryIssue, SourceSegment, WordTiming
from app.services.segments import Segment, Word


FILLER_TOKENS = {"um", "uh", "ah"}
FILLER_PHRASES = {("you", "know"), ("i", "mean")}
LEADING_FILLERS = {"like", "so", "well", "okay", "ok"}
FUNCTION_WORDS = {"a", "an", "the", "in", "on", "of", "to", "and", "or", "for"}

# Retakes often share the opening line then diverge — 4+ matching words is a strong same-take signal.
MIN_SHARED_PREFIX_WORDS = 4
MIN_SHARED_SUFFIX_WORDS = 4
MIN_CONTAINMENT_WORDS = 3
MAX_CONTINUATION_GAP_SECONDS = 5.0
MIN_SHORT_PREFIX_WORDS = 3
MIN_FUZZY_WORD_COUNT = 4
UNTRUSTED_WORD_MIN_S = 0.02
UNTRUSTED_WORD_MAX_S = 1.0
_WORD_MARKERS = {"'", "’", "-"}


def word_timing_untrusted(word: Word | WordTiming) -> bool:
    duration = word.end - word.start
    return duration < UNTRUSTED_WORD_MIN_S or duration > UNTRUSTED_WORD_MAX_S


def _is_latin_letter(char: str) -> bool:
    return "A" <= char <= "Z" or "a" <= char <= "z"


def transcript_is_latin(words: list[Word] | list[WordTiming], language: str | None = None) -> bool:
    if language and language.lower().startswith("en"):
        return True
    latin = 0
    other = 0
    for word in words:
        for char in word.text:
            if not char.isalpha():
                continue
            if _is_latin_letter(char):
                latin += 1
            else:
                other += 1
    return latin >= other


def is_junk_token(text: str, *, latin_transcript: bool = True) -> bool:
    token = text.strip()
    if not token:
        return True
    letters = 0
    punct = 0
    other_script = 0
    for char in token:
        if char in _WORD_MARKERS:
            continue
        if char.isalnum():
            letters += 1
            if char.isalpha() and not _is_latin_letter(char) and not char.isdigit():
                other_script += 1
        else:
            punct += 1
    if letters == 0:
        return True
    if punct >= letters:
        return True
    if latin_transcript and other_script:
        return True
    return False


def filter_clip_words(
    words: list[Word] | list[WordTiming],
    *,
    drop_junk: bool,
    latin_transcript: bool,
) -> list:
    if not drop_junk:
        return list(words)
    return [word for word in words if not is_junk_token(word.text, latin_transcript=latin_transcript)]


def normalize_text(text: str) -> str:
    lowered = text.lower()
    cleaned = re.sub(r"[^\w\s]", " ", lowered)
    tokens = [t for t in cleaned.split() if t]
    stripped: list[str] = []
    i = 0
    while i < len(tokens):
        if i + 1 < len(tokens) and (tokens[i], tokens[i + 1]) in FILLER_PHRASES:
            i += 2
            continue
        if tokens[i] in FILLER_TOKENS:
            i += 1
            continue
        stripped.append(tokens[i])
        i += 1
    while stripped and stripped[0] in LEADING_FILLERS:
        stripped.pop(0)
    return " ".join(stripped)


def shared_prefix_word_count(a: str, b: str) -> int:
    wa, wb = a.split(), b.split()
    count = 0
    for x, y in zip(wa, wb, strict=False):
        if x == y:
            count += 1
        else:
            break
    return count


def shared_suffix_word_count(a: str, b: str) -> int:
    wa, wb = a.split(), b.split()
    count = 0
    for x, y in zip(reversed(wa), reversed(wb), strict=False):
        if x == y:
            count += 1
        else:
            break
    return count


def prefix_word_ratio(a: str, b: str) -> float:
    wa, wb = a.split(), b.split()
    if not wa or not wb:
        return 0.0
    shared = shared_prefix_word_count(a, b)
    return shared / min(len(wa), len(wb))


def _containment_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    shorter, longer = (a, b) if len(a.split()) <= len(b.split()) else (b, a)
    if len(shorter.split()) < MIN_CONTAINMENT_WORDS:
        return False
    return shorter in longer


def _is_word_prefix(short: str, long: str) -> bool:
    sw, lw = short.split(), long.split()
    if len(sw) < MIN_CONTAINMENT_WORDS or len(sw) > len(lw):
        return False
    if lw[: len(sw)] == sw:
        return True
    return shared_prefix_word_count(short, long) >= MIN_CONTAINMENT_WORDS and prefix_word_ratio(short, long) >= 0.8


def _is_word_suffix(short: str, long: str) -> bool:
    sw, lw = short.split(), long.split()
    if len(sw) < MIN_CONTAINMENT_WORDS or len(sw) > len(lw):
        return False
    return lw[-len(sw) :] == sw


def _entire_shorter_is_prefix(a: str, b: str) -> bool:
    wa, wb = a.split(), b.split()
    if not wa or not wb:
        return False
    shorter, longer = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    if len(shorter) < MIN_SHORT_PREFIX_WORDS:
        return False
    return longer[: len(shorter)] == shorter


def _entire_shorter_is_suffix(a: str, b: str) -> bool:
    wa, wb = a.split(), b.split()
    if not wa or not wb:
        return False
    shorter, longer = (wa, wb) if len(wa) <= len(wb) else (wb, wa)
    if len(shorter) < MIN_CONTAINMENT_WORDS:
        return False
    return longer[-len(shorter) :] == shorter


def similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if shared_prefix_word_count(a, b) >= MIN_SHARED_PREFIX_WORDS:
        return 1.0
    if shared_suffix_word_count(a, b) >= MIN_SHARED_SUFFIX_WORDS:
        return 1.0
    if _containment_match(a, b):
        return 1.0
    if _entire_shorter_is_prefix(a, b) or _entire_shorter_is_suffix(a, b):
        return 1.0
    wa, wb = a.split(), b.split()
    if len(wa) < MIN_FUZZY_WORD_COUNT or len(wb) < MIN_FUZZY_WORD_COUNT:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _short_match_score(short: str, other: str) -> float:
    if not short or not other:
        return 0.0
    sw, ow = short.split(), other.split()
    if len(sw) < 2 or len(sw) >= MIN_CONTAINMENT_WORDS:
        return 0.0
    if ow[: len(sw)] == sw:
        return float(len(sw))
    if ow[-len(sw) :] == sw:
        return float(len(sw)) * 0.9
    shared = shared_prefix_word_count(short, other)
    return float(shared) if shared else 0.0


def group_clips_by_text(
    clip_texts: list[tuple[str, str]],
    *,
    threshold: float | None = None,
    stem: str = "take",
    indices: dict[str, int] | None = None,
) -> dict[str, str]:
    limit = threshold if threshold is not None else settings.clip_similarity_threshold
    ids = [clip_id for clip_id, _ in clip_texts]
    norms = {clip_id: normalize_text(text) for clip_id, text in clip_texts}
    index_of = indices or {clip_id: i for i, clip_id in enumerate(ids)}

    parent = {clip_id: clip_id for clip_id in ids}

    def find(clip_id: str) -> str:
        while parent[clip_id] != clip_id:
            parent[clip_id] = parent[parent[clip_id]]
            clip_id = parent[clip_id]
        return clip_id

    def union(left: str, right: str) -> None:
        root_left, root_right = find(left), find(right)
        if root_left != root_right:
            parent[root_right] = root_left

    long_ids = [clip_id for clip_id in ids if len(norms[clip_id].split()) >= MIN_CONTAINMENT_WORDS]
    short_ids = [clip_id for clip_id in ids if clip_id not in set(long_ids)]

    for i, id_a in enumerate(long_ids):
        for id_b in long_ids[i + 1 :]:
            if similarity(norms[id_a], norms[id_b]) >= limit:
                union(id_a, id_b)

    for sid in short_ids:
        best_id: str | None = None
        best_key: tuple[float, int] | None = None
        for oid in ids:
            if oid == sid:
                continue
            score = _short_match_score(norms[sid], norms[oid])
            if score <= 0:
                continue
            key = (score, len(norms[oid].split()))
            if best_key is None or key > best_key:
                best_key = key
                best_id = oid
        if best_id is not None:
            union(sid, best_id)

    members: dict[str, list[str]] = {}
    for clip_id in ids:
        members.setdefault(find(clip_id), []).append(clip_id)

    mapping: dict[str, str] = {}
    for root, group_ids in members.items():
        first_index = min(index_of.get(cid, 0) for cid in group_ids)
        group_id = f"{stem}_g{first_index:03d}"
        for clip_id in group_ids:
            mapping[clip_id] = group_id
        _ = root
    return mapping


def words_in_segment(words: list[Word], seg: Segment) -> list[Word]:
    return [w for w in words if w.end > seg.source_start and w.start < seg.source_end]


def play_ranges(clip: ClipItem) -> list[tuple[float, float]]:
    if clip.ranges:
        return [(span.source_start, span.source_end) for span in clip.ranges]
    return [(clip.source_start, clip.source_end)]


def _ranges_duration(ranges: list[SourceSegment]) -> float:
    return sum(max(0.0, span.source_end - span.source_start) for span in ranges)


def _clip_ranges(clip: ClipItem) -> list[SourceSegment]:
    if clip.ranges:
        return list(clip.ranges)
    return [SourceSegment(source_start=clip.source_start, source_end=clip.source_end)]


def _combine_clips(left: ClipItem, right: ClipItem) -> ClipItem:
    text = f"{left.text} {right.text}".strip()
    combined_words = list(left.words or []) + list(right.words or [])
    ranges = _clip_ranges(left) + _clip_ranges(right)
    return ClipItem(
        id=left.id,
        index=left.index,
        source_start=left.source_start,
        source_end=right.source_end,
        duration=_ranges_duration(ranges),
        text=text,
        group_id="pending",
        words=combined_words,
        false_start=False,
        delivery_issue=None,
        ranges=ranges,
    )


def _has_reconstruction_anchor(left_norm: str, right_norm: str, other_norms: list[str]) -> bool:
    if len(right_norm.split()) < MIN_CONTAINMENT_WORDS:
        return False
    left_len = len(left_norm.split())
    right_len = len(right_norm.split())
    for other in other_norms:
        if len(other.split()) <= max(left_len, right_len):
            continue
        if _is_word_prefix(left_norm, other) and _is_word_suffix(right_norm, other):
            return True
    return False


def merge_continuation_clips(clips: list[ClipItem], stem: str) -> list[ClipItem]:
    if len(clips) < 2:
        return clips

    merged: list[ClipItem] = []
    i = 0
    while i < len(clips):
        current = clips[i]
        j = i + 1
        while j < len(clips):
            gap = clips[j].source_start - current.source_end
            if gap < 0 or gap > MAX_CONTINUATION_GAP_SECONDS:
                break
            left_norm = normalize_text(current.text)
            right_norm = normalize_text(clips[j].text)
            others = [
                normalize_text(clip.text)
                for k, clip in enumerate(clips)
                if k < i or k > j
            ]
            if not _has_reconstruction_anchor(left_norm, right_norm, others):
                break
            current = _combine_clips(current, clips[j])
            j += 1
        merged.append(current)
        i = j

    return _reindex_clips(merged, stem)


def find_restart_index(words: list[WordTiming]) -> int | None:
    tokens: list[tuple[int, str]] = []
    for index, word in enumerate(words):
        token = normalize_text(word.text)
        if token:
            tokens.append((index, token))

    token_list = [token for _, token in tokens]
    n = len(token_list)
    if n < MIN_SHARED_PREFIX_WORDS * 2:
        return None

    for start in range(MIN_SHARED_PREFIX_WORDS, n - MIN_SHARED_PREFIX_WORDS + 1):
        match = 0
        while (
            match < start
            and start + match < n
            and token_list[match] == token_list[start + match]
        ):
            match += 1
        if match < MIN_SHARED_PREFIX_WORDS:
            continue
        if start < MIN_CONTAINMENT_WORDS or n - start < MIN_CONTAINMENT_WORDS:
            continue
        return tokens[start][0]
    return None


def _clip_slice(
    clip: ClipItem,
    words: list[WordTiming],
    *,
    source_start: float,
    source_end: float,
    false_start: bool,
    drop_junk: bool = False,
    latin_transcript: bool = True,
) -> ClipItem:
    kept = filter_clip_words(words, drop_junk=drop_junk, latin_transcript=latin_transcript)
    text = " ".join(word.text for word in kept).strip()
    span = SourceSegment(source_start=source_start, source_end=source_end)
    return ClipItem(
        id=clip.id,
        index=clip.index,
        source_start=source_start,
        source_end=source_end,
        duration=max(0.0, source_end - source_start),
        text=text or clip.text,
        group_id=clip.group_id,
        words=kept,
        false_start=false_start,
        delivery_issue=None,
        ranges=[span],
    )


def _nearest_trusted_end(words: list[WordTiming]) -> float:
    for word in reversed(words):
        if not word_timing_untrusted(word):
            return word.end
    return words[-1].end


def _nearest_trusted_start(words: list[WordTiming]) -> float:
    for word in words:
        if not word_timing_untrusted(word):
            return word.start
    return words[0].start


def _split_clip_at_restarts(
    clip: ClipItem,
    pad: float,
    *,
    avoid_untrusted_cuts: bool = False,
    drop_junk: bool = False,
    latin_transcript: bool = True,
) -> list[ClipItem]:
    words = list(clip.words or [])
    restart_at = find_restart_index(words)
    if restart_at is None:
        return [clip]

    left_words = words[:restart_at]
    right_words = words[restart_at:]
    if not left_words or not right_words:
        return [clip]

    if avoid_untrusted_cuts and (
        word_timing_untrusted(left_words[-1]) or word_timing_untrusted(right_words[0])
    ):
        cut = (_nearest_trusted_end(left_words) + _nearest_trusted_start(right_words)) / 2.0
        left_end = min(max(clip.source_start, cut), clip.source_end)
        right_start = left_end
    else:
        raw_left_end = left_words[-1].end + pad
        raw_right_start = max(0.0, right_words[0].start - pad)
        left_end = min(raw_left_end, right_words[0].start)
        right_start = max(raw_right_start, left_end)

    left = _clip_slice(
        clip,
        left_words,
        source_start=clip.source_start,
        source_end=left_end,
        false_start=True,
        drop_junk=drop_junk,
        latin_transcript=latin_transcript,
    )
    right = _clip_slice(
        clip,
        right_words,
        source_start=right_start,
        source_end=clip.source_end,
        false_start=False,
        drop_junk=drop_junk,
        latin_transcript=latin_transcript,
    )
    return [
        left,
        *_split_clip_at_restarts(
            right,
            pad,
            avoid_untrusted_cuts=avoid_untrusted_cuts,
            drop_junk=drop_junk,
            latin_transcript=latin_transcript,
        ),
    ]


def _reindex_clips(clips: list[ClipItem], stem: str) -> list[ClipItem]:
    return [
        clip.model_copy(update={"id": f"{stem}_seg_{index:03d}", "index": index})
        for index, clip in enumerate(clips)
    ]


def split_restart_clips(
    clips: list[ClipItem],
    stem: str,
    *,
    pad: float | None = None,
    avoid_untrusted_cuts: bool = False,
    drop_junk: bool = False,
    latin_transcript: bool = True,
) -> list[ClipItem]:
    edge_pad = settings.silence_pad if pad is None else pad
    split: list[ClipItem] = []
    for clip in clips:
        split.extend(
            _split_clip_at_restarts(
                clip,
                edge_pad,
                avoid_untrusted_cuts=avoid_untrusted_cuts,
                drop_junk=drop_junk,
                latin_transcript=latin_transcript,
            )
        )
    return _reindex_clips(split, stem)


def _normalized_tokens(text: str) -> list[str]:
    normalized = normalize_text(text)
    return normalized.split() if normalized else []


def _content_tokens(text: str) -> list[str]:
    return [token for token in _normalized_tokens(text) if token not in FUNCTION_WORDS]


def _matched_indices(candidate: list[str], other: list[str]) -> set[int]:
    matched: set[int] = set()
    matcher = SequenceMatcher(None, candidate, other, autojunk=False)
    for tag, i1, i2, _j1, _j2 in matcher.get_opcodes():
        if tag == "equal":
            matched.update(range(i1, i2))
    return matched


def _trailing_unmatched_count(token_count: int, matched: set[int]) -> int:
    trailing = 0
    for index in range(token_count - 1, -1, -1):
        if index in matched:
            break
        trailing += 1
    return trailing


def _run_on_extra(text: str, tokens: list[str], matched: set[int]) -> int:
    trailing = _trailing_unmatched_count(len(tokens), matched)
    if trailing == 0:
        return 0
    raw_words = [word for word in text.split() if re.sub(r"[^\w]", "", word)]
    if trailing > len(raw_words):
        return trailing
    first_extra = re.sub(r"[^\w]", "", raw_words[-trailing])
    if first_extra and first_extra[0].isupper():
        return trailing
    return 0


def _reference_key(clip: ClipItem, tokens: list[str], others: list[list[str]]) -> tuple[int, int, int, float] | None:
    matched: set[int] = set()
    for other in others:
        matched |= _matched_indices(tokens, other)
    score = len(matched)
    if score <= 0:
        return None
    run_on = _run_on_extra(clip.text, tokens, matched)
    return (score, -run_on, len(tokens), clip.source_start)


def pick_group_reference(clips: list[ClipItem]) -> ClipItem | None:
    candidates = [clip for clip in clips if not clip.false_start]
    if len(candidates) < 2:
        return None

    tokenized = {clip.id: _normalized_tokens(clip.text) for clip in candidates}
    best: ClipItem | None = None
    best_key: tuple[int, int, int, float] | None = None
    for clip in candidates:
        others = [tokens for clip_id, tokens in tokenized.items() if clip_id != clip.id]
        key = _reference_key(clip, tokenized[clip.id], others)
        if key is None:
            continue
        if best_key is None or key > best_key:
            best = clip
            best_key = key
    return best


def classify_delivery_issue(clip_text: str, reference_text: str) -> DeliveryIssue | None:
    clip_tokens = _content_tokens(clip_text)
    ref_tokens = _content_tokens(reference_text)
    if not clip_tokens or not ref_tokens:
        return None

    matcher = SequenceMatcher(None, clip_tokens, ref_tokens, autojunk=False)
    opcodes = matcher.get_opcodes()
    if any(tag == "replace" for tag, *_ in opcodes):
        return "misstatement"

    ref_equal_spans: list[tuple[int, int]] = []
    inserts: list[tuple[int, int]] = []
    for tag, _i1, _i2, j1, j2 in opcodes:
        if tag == "equal":
            ref_equal_spans.append((j1, j2))
        elif tag == "insert":
            inserts.append((j1, j2))

    ref_matched = sum(end - start for start, end in ref_equal_spans)
    if ref_matched == len(ref_tokens):
        return None

    missing_interior = any(start > 0 and end < len(ref_tokens) for start, end in inserts)
    missing_start = any(start == 0 for start, end in inserts)
    missing_end = any(end == len(ref_tokens) for start, end in inserts)

    if missing_interior or (missing_start and missing_end):
        return "missing_words"
    if missing_start and not missing_end:
        return "starts_late"
    if missing_end and not missing_start:
        return "cut_off"
    return None


def flag_incomplete_takes(clips: list[ClipItem]) -> dict[str, ClipItem]:
    members: dict[str, list[ClipItem]] = {}
    for clip in clips:
        members.setdefault(clip.group_id, []).append(clip)

    references: dict[str, ClipItem] = {}
    for group_id, group_clips in members.items():
        reference = pick_group_reference(group_clips)
        if reference is None:
            continue
        references[group_id] = reference
        for clip in group_clips:
            if clip.false_start or clip.id == reference.id:
                continue
            clip.delivery_issue = classify_delivery_issue(clip.text, reference.text)
    return references


def _groups_from_clips(
    clips: list[ClipItem],
    references: dict[str, ClipItem] | None = None,
) -> list[ClipGroup]:
    members: dict[str, list[ClipItem]] = {}
    for clip in clips:
        members.setdefault(clip.group_id, []).append(clip)

    groups: list[ClipGroup] = []
    for gid, group_clips in members.items():
        label_clip = (references or {}).get(gid) or max(group_clips, key=lambda item: len(item.text))
        groups.append(
            ClipGroup(
                id=gid,
                label=label_clip.text,
                clip_ids=[item.id for item in group_clips],
                reference_clip_id=label_clip.id if (references or {}).get(gid) else None,
            )
        )
    return groups


def build_segment_clips(
    stem: str,
    segments: list[Segment],
    words: list[Word],
    *,
    similarity_threshold: float | None = None,
    pad: float | None = None,
    on_progress: Callable[[int, int, str], None] | None = None,
    drop_junk_tokens: bool = False,
    avoid_untrusted_cuts: bool = False,
    language: str | None = None,
) -> tuple[list[ClipItem], list[ClipGroup]]:
    raw_clips: list[ClipItem] = []
    total = len(segments)
    edge_pad = settings.silence_pad if pad is None else pad
    latin_transcript = transcript_is_latin(words, language)

    for index, segment in enumerate(segments):
        clip_id = f"{stem}_seg_{index:03d}"
        seg_words = filter_clip_words(
            words_in_segment(words, segment),
            drop_junk=drop_junk_tokens,
            latin_transcript=latin_transcript,
        )
        text = " ".join(w.text for w in seg_words).strip()
        duration = segment.source_end - segment.source_start

        item = ClipItem(
            id=clip_id,
            index=index,
            source_start=segment.source_start,
            source_end=segment.source_end,
            duration=duration,
            text=text or f"Segment {index + 1}",
            group_id="pending",
            words=[WordTiming(text=w.text, start=w.start, end=w.end) for w in seg_words],
        )
        raw_clips.append(item)

        if on_progress:
            on_progress(index + 1, total, f"Building segment {index + 1}/{total}")

    raw_clips = merge_continuation_clips(raw_clips, stem)
    clip_text_pairs = [(clip.id, clip.text) for clip in raw_clips]
    group_map = group_clips_by_text(
        clip_text_pairs,
        threshold=similarity_threshold,
        stem=stem,
        indices={clip.id: clip.index for clip in raw_clips},
    )
    for clip in raw_clips:
        clip.group_id = group_map[clip.id]

    raw_clips = split_restart_clips(
        raw_clips,
        stem,
        pad=edge_pad,
        avoid_untrusted_cuts=avoid_untrusted_cuts,
        drop_junk=drop_junk_tokens,
        latin_transcript=latin_transcript,
    )
    references = flag_incomplete_takes(raw_clips)
    return raw_clips, _groups_from_clips(raw_clips, references)
