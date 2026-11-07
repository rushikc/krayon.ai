export function formatDuration(seconds?: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Clock time on the source, including 0:00. */
export function formatTimestamp(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Human-readable elapsed time, e.g. "2.3 s", "2 s", "18 min", "1 h 2 min". */
export function formatElapsedHuman(seconds?: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 10) {
    const rounded = Math.abs(seconds - Math.round(seconds)) < 0.05 ? Math.round(seconds) : Number(seconds.toFixed(1));
    return `${rounded} s`;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const min = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} h`);
  if (min > 0) parts.push(`${min} min`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec} s`);
  return parts.join(" ");
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function formatResolution(width?: number | null, height?: number | null): string {
  if (!width || !height) return "—";
  return `${width}×${height}`;
}

/** Progress text: keep a percent already in `message`, otherwise append one from `ratio`. */
export function formatProgressLabel(message?: string | null, ratio?: number | null): string {
  const text = (message ?? "").trim();
  if (text.includes("%")) return text;
  if (ratio == null || !Number.isFinite(ratio)) return text;
  const percent = `${Math.round(ratio * 100)}%`;
  return text ? `${text} ${percent}` : percent;
}
