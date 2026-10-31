export type ClipSummary = {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  text: string;
};

export function describeClips(clips: ClipSummary[]): string {
  return clips
    .map((clip) => `${clip.id} ${clip.sourceStart.toFixed(2)}-${clip.sourceEnd.toFixed(2)}s ${clip.text}`)
    .join("\n");
}

export function describeIds(ids: string[]): string {
  return ids.join(" ");
}
