from __future__ import annotations

import subprocess
import sys


def pick_video_macos(*, prompt: str = "Select a talking-head video") -> str | None:
    """Open the native macOS file picker and return an absolute POSIX path."""
    if sys.platform != "darwin":
        raise RuntimeError("Native file picker is only supported on macOS")

    script = f'POSIX path of (choose file with prompt "{prompt}")'
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    path = result.stdout.strip().rstrip("/")
    return path or None
