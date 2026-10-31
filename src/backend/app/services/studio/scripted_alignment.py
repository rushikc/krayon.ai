from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Sequence

from app.services.studio.common.project import (
    COMPLETENESS_BONUS,
    INTERNAL_PAUSE_PENALTY,
    INTERNAL_PAUSE_S,
    RECENCY_LAST,
    RECENCY_SECOND,
    RECENCY_THIRD,
)

NUMBER_WORDS = {
    "zero": "0",
    "one": "1",
    "two": "2",
    "three": "3",
    "four": "4",
    "five": "5",
    "six": "6",
    "seven": "7",
    "eight": "8",
    "nine": "9",
    "ten": "10",
    "eleven": "11",
    "twelve": "12",
}

UNTRUSTED_WORD_MIN_S = 0.02
UNTRUSTED_WORD_MAX_S = 1.0
PUNCT_RE = re.compile(r"[^\w]+", re.UNICODE)
LATIN_RE = re.compile(r"[a-z0-9]")


@dataclass
class Word:
    text: str
    start: float
    end: float
    index: int = 0


@dataclass
class Candidate:
    line: int
    start_index: int
    end_index: int
    start: float
    end: float
    match_score: float
    completeness: bool
    pause_penalty: float
    recency_bonus: float = 0.0
    matched_text: str = ""
    words: list[Word] = field(default_factory=list)

    @property
    def take_score(self) -> float:
        bonus = COMPLETENESS_BONUS if self.completeness else 0.0
        return self.match_score + bonus - self.pause_penalty + self.recency_bonus


@dataclass
class LineResult:
    line: int
    text: str
    chosen: Candidate | None
    candidates: list[Candidate]


@dataclass
class AlignmentResult:
    lines: list[str]
    line_results: list[LineResult]


def parse_script_lines(script: str) -> list[str]:
    text = (script or "").replace("\r\n", "\n").replace("\r", "\n")
    return [line.rstrip() for line in text.split("\n") if line.strip()]


def normalize_token(raw: str) -> str | None:
    folded = unicodedata.normalize("NFKC", raw).casefold()
    folded = folded.replace("’", "'").replace("`", "'")
    stripped = PUNCT_RE.sub("", folded)
    if not stripped:
        return None
    if stripped in NUMBER_WORDS:
        return NUMBER_WORDS[stripped]
    if stripped.isdigit():
        return stripped.lstrip("0") or "0"
    if not LATIN_RE.search(stripped):
        return None
    return stripped


def is_skippable(raw: str) -> bool:
    return normalize_token(raw) is None


def tokenize_script_line(line: str) -> list[str]:
    tokens: list[str] = []
    for part in line.split():
        token = normalize_token(part)
        if token:
            tokens.append(token)
    return tokens


def _token_sub_cost(a: str, b: str) -> float:
    if a == b:
        return 0.0
    ratio = SequenceMatcher(None, a, b).ratio()
    if ratio >= 0.5:
        return 1.0 - ratio
    return 1.0


def token_similarity(script_tokens: Sequence[str], window_tokens: Sequence[str]) -> tuple[float, bool]:
    if not script_tokens and not window_tokens:
        return 1.0, True
    if not script_tokens or not window_tokens:
        return 0.0, False
    n = len(script_tokens)
    m = len(window_tokens)
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = float(i)
    for j in range(1, m + 1):
        dp[0][j] = float(j)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dp[i][j] = min(
                dp[i - 1][j] + 1.0,
                dp[i][j - 1] + 1.0,
                dp[i - 1][j - 1] + _token_sub_cost(script_tokens[i - 1], window_tokens[j - 1]),
            )
    distance = dp[n][m]
    denom = max(n, m)
    score = max(0.0, 1.0 - distance / denom)
    complete = distance < 0.15 and n == m
    return score, complete


def _speech_indices(words: Sequence[Word]) -> list[int]:
    return [word.index for word in words if not is_skippable(word.text)]


def _window_tokens(words: Sequence[Word], start_i: int, end_i: int) -> list[str]:
    tokens: list[str] = []
    for word in words[start_i : end_i + 1]:
        token = normalize_token(word.text)
        if token:
            tokens.append(token)
    return tokens


def _internal_pause_penalty(words: Sequence[Word], start_i: int, end_i: int) -> float:
    speech = [word for word in words[start_i : end_i + 1] if not is_skippable(word.text)]
    for prev, curr in zip(speech, speech[1:]):
        gap = curr.start - prev.end
        if gap > INTERNAL_PAUSE_S:
            return INTERNAL_PAUSE_PENALTY
    return 0.0


def _ranges_overlap(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    return not (a_end < b_start or b_end < a_start)


def find_candidates(
    line: int,
    script_tokens: Sequence[str],
    words: Sequence[Word],
    threshold: float,
) -> list[Candidate]:
    if not script_tokens:
        return []
    speech = _speech_indices(words)
    if not speech:
        return []
    target = len(script_tokens)
    min_len = max(1, int(round(0.7 * target)))
    max_len = max(min_len, int(round(1.3 * target)))
    found: list[Candidate] = []
    first = script_tokens[0]
    anchors = [
        offset
        for offset, idx in enumerate(speech)
        if (token := normalize_token(words[idx].text))
        and SequenceMatcher(None, first, token).ratio() >= 0.5
    ]
    for length in range(min_len, max_len + 1):
        if length > len(speech):
            break
        for offset in anchors:
            if offset + length > len(speech):
                continue
            start_i = speech[offset]
            end_i = speech[offset + length - 1]
            window = _window_tokens(words, start_i, end_i)
            cheap = SequenceMatcher(None, " ".join(script_tokens), " ".join(window)).ratio()
            if cheap < threshold - 0.2:
                continue
            score, complete = token_similarity(script_tokens, window)
            if score < threshold:
                continue
            slice_words = list(words[start_i : end_i + 1])
            found.append(
                Candidate(
                    line=line,
                    start_index=start_i,
                    end_index=end_i,
                    start=words[start_i].start,
                    end=words[end_i].end,
                    match_score=score,
                    completeness=complete and len(window) == target,
                    pause_penalty=_internal_pause_penalty(words, start_i, end_i),
                    matched_text=" ".join(word.text for word in slice_words if not is_skippable(word.text)),
                    words=slice_words,
                )
            )
    found.sort(key=lambda item: item.match_score, reverse=True)
    merged: list[Candidate] = []
    for cand in found:
        overlapping = [
            other
            for other in merged
            if _ranges_overlap(cand.start_index, cand.end_index, other.start_index, other.end_index)
        ]
        if not overlapping:
            merged.append(cand)
            continue
        best = max([cand, *overlapping], key=lambda item: item.match_score)
        for other in overlapping:
            merged.remove(other)
        merged.append(best)
    merged.sort(key=lambda item: item.start)
    return merged


def apply_recency(candidates: list[Candidate], enabled: bool) -> None:
    if not enabled or not candidates:
        return
    ordered = sorted(candidates, key=lambda item: item.start)
    n = len(ordered)
    bonuses = {n - 1: RECENCY_LAST, n - 2: RECENCY_SECOND, n - 3: RECENCY_THIRD}
    for index, cand in enumerate(ordered):
        cand.recency_bonus = bonuses.get(index, 0.0)


def choose_takes(line_candidates: list[list[Candidate]]) -> list[Candidate | None]:
    n = len(line_candidates)
    chosen: list[Candidate | None] = [None] * n
    if n == 0:
        return chosen

    # dp[i] is list of (score, prev_j_or_None, cand_or_None) for each candidate plus skip
    best_scores: list[list[float]] = []
    back: list[list[tuple[int, int] | None]] = []
    cands: list[list[Candidate | None]] = []

    for i, options in enumerate(line_candidates):
        slots: list[Candidate | None] = list(options) + [None]
        cands.append(slots)
        scores = [-1e18] * len(slots)
        parents: list[tuple[int, int] | None] = [None] * len(slots)
        if i == 0:
            for j, cand in enumerate(slots):
                scores[j] = 0.0 if cand is None else cand.take_score + 0.001 * (n - i)
            best_scores.append(scores)
            back.append(parents)
            continue
        prev_slots = cands[i - 1]
        prev_scores = best_scores[i - 1]
        for j, cand in enumerate(slots):
            for pj, prev in enumerate(prev_slots):
                if cand is not None and prev is not None and cand.start < prev.end - 1e-6:
                    continue
                add = 0.0 if cand is None else cand.take_score + 0.001 * (n - i)
                total = prev_scores[pj] + add
                if total > scores[j]:
                    scores[j] = total
                    parents[j] = (i - 1, pj)
        best_scores.append(scores)
        back.append(parents)

    last = best_scores[-1]
    j = max(range(len(last)), key=lambda idx: last[idx])
    i = n - 1
    while i >= 0:
        cand = cands[i][j]
        chosen[i] = cand
        parent = back[i][j]
        if parent is None:
            break
        i, j = parent
    return chosen


def trusted_cut_times(words: Sequence[Word], start_i: int, end_i: int) -> tuple[float, float]:
    start = words[start_i].start
    end = words[end_i].end
    start_word = words[start_i]
    end_word = words[end_i]
    if not _trusted(start_word):
        for word in words[start_i : end_i + 1]:
            if _trusted(word):
                start = word.start
                break
    if not _trusted(end_word):
        for word in reversed(list(words[start_i : end_i + 1])):
            if _trusted(word):
                end = word.end
                break
    return start, end


def _trusted(word: Word) -> bool:
    duration = word.end - word.start
    return UNTRUSTED_WORD_MIN_S <= duration <= UNTRUSTED_WORD_MAX_S


def align_script(
    script_lines: Sequence[str],
    words_in: Sequence[object],
    *,
    match_threshold: float = 0.7,
    prefer_last_takes: bool = True,
) -> AlignmentResult:
    words: list[Word] = []
    for index, item in enumerate(words_in):
        text = getattr(item, "text", None)
        if text is None and isinstance(item, dict):
            text = item["text"]
            start = float(item["start"])
            end = float(item["end"])
        else:
            start = float(item.start)
            end = float(item.end)
        words.append(Word(text=str(text), start=start, end=end, index=index))

    line_candidates: list[list[Candidate]] = []
    tokens_per_line: list[list[str]] = []
    for line_no, line in enumerate(script_lines, start=1):
        tokens = tokenize_script_line(line)
        tokens_per_line.append(tokens)
        cands = find_candidates(line_no, tokens, words, match_threshold)
        apply_recency(cands, prefer_last_takes)
        line_candidates.append(cands)

    selected = choose_takes(line_candidates)
    results: list[LineResult] = []
    for index, line in enumerate(script_lines):
        results.append(
            LineResult(
                line=index + 1,
                text=line,
                chosen=selected[index],
                candidates=line_candidates[index],
            )
        )
    return AlignmentResult(lines=list(script_lines), line_results=results)


def whisper_prompt_from_script(script: str, max_chars: int = 800) -> str | None:
    lines = parse_script_lines(script)
    if not lines:
        return None
    joined = " ".join(lines)
    if len(joined) <= max_chars:
        return joined
    counts: dict[str, int] = {}
    for line in lines:
        for token in tokenize_script_line(line):
            if len(token) < 4:
                continue
            counts[token] = counts.get(token, 0) + 1
    rare = [token for token, count in counts.items() if count == 1]
    rare.sort(key=len, reverse=True)
    prompt = " ".join(rare)
    return prompt[:max_chars] if prompt else joined[:max_chars]
