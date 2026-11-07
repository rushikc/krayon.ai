from __future__ import annotations

LEGACY_PHASE_WEIGHTS: dict[str, tuple[float, float]] = {
    "starting": (0.00, 0.02),
    "transcribing": (0.02, 0.86),
    "segmenting": (0.86, 0.90),
    "grouping": (0.90, 0.94),
    "extracting_audio": (0.94, 0.99),
    "complete": (1.0, 1.0),
    "error": (1.0, 1.0),
}

LEGACY_REBUILD_PHASE_WEIGHTS: dict[str, tuple[float, float]] = {
    "starting": (0.00, 0.05),
    "segmenting": (0.05, 0.20),
    "grouping": (0.20, 0.35),
    "extracting_audio": (0.35, 0.99),
    "complete": (1.0, 1.0),
    "error": (1.0, 1.0),
}

PHASE_WEIGHTS: dict[str, tuple[float, float]] = {
    "extracting": (0.00, 0.05),
    "transcribing": (0.05, 0.80),
    "segmenting": (0.80, 0.86),
    "grouping": (0.86, 0.90),
    "snapping": (0.90, 0.96),
    "saving": (0.96, 1.00),
    "complete": (1.0, 1.0),
    "error": (1.0, 1.0),
}

STUDIO_REBUILD_PHASE_WEIGHTS: dict[str, tuple[float, float]] = {
    "extracting": (0.00, 0.00),
    "transcribing": (0.00, 0.00),
    "segmenting": (0.00, 0.25),
    "grouping": (0.25, 0.55),
    "snapping": (0.55, 0.95),
    "saving": (0.95, 1.00),
    "complete": (1.0, 1.0),
    "error": (1.0, 1.0),
}

REBUILD_PHASE_WEIGHTS = LEGACY_REBUILD_PHASE_WEIGHTS


def overall_progress(phase: str, step_progress: float, *, rebuild: bool = False) -> float:
    weights = LEGACY_REBUILD_PHASE_WEIGHTS if rebuild else LEGACY_PHASE_WEIGHTS
    lo, hi = weights.get(phase, (0.0, 1.0))
    clamped = max(0.0, min(1.0, step_progress))
    return lo + (hi - lo) * clamped
