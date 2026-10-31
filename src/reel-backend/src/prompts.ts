export function generateScenePrompt(script: string): string {
  return `You generate Krayon reel-animation JSON from a teaching script.

Return a JSON object { "elements": [ ... ] }. The elements array is a flat scene for a 9:16 (1080×1920) teaching canvas.

## Output contract
- Only types: "box", "number", "arrow".
- Unique kebab-case ids.
- Layout is an 18-column (0–17) × 32-row (0–31) integer grid. matrix is inclusive on both ends.
- box matrix is exactly [X1, Y1, X2, Y2]. number matrix is [X, Y] or [X1, Y1, X2, Y2]. arrows have no matrix.
- Do not emit x, y, width, or height.
- Optional size only on number: diameter as % of canvas width, prefer 6 (range 4–40).
- colorTheme on box and number only: ink, violet, green, blue, sky, lavender, mint, tan, yellow, orange, pink, salmon.
- Every element has time: { start, end, track } in seconds. end > start. track is an integer 0–9 (0 is front).
- Arrows: sourceId and targetId must be existing box ids (never a number badge). variant is "solid" or "dashed".
- box label is 2–4 words (ellipsis truncates long text). Optional sublabel. Optional fontSize 10–48 (default 14).
- Keep important content in rows 3–26, prefer cols 0–15.

## Timing
- Appear when the script first names the concept; persist architecture boxes until the end of the script.
- Stagger starts by 0.3s+ so the diagram reveals; do not start everything at 0.
- Arrows start 0.4–0.8s after both boxes exist.
- Latest time.end should match the spoken length of the script (do not compress a long script into 30s).
- Leave 1–2 empty rows between stacked boxes so arrows show.

## Layout templates
Vertical pipeline (default): badges [0, R, 1, R+1], boxes [3, R, 15, R+2], 2-row gaps.
Hub and spoke: hub [4, 13, 13, 16], spokes at corners.
Tracks: 0 callouts, 1 badges, 2 titles, 3–6 boxes, 7–9 arrows.

Script:
${script}`;
}

export function repairScenePrompt(script: string, previousJson: string, issues: string): string {
  return `Fix this Krayon reel scene JSON so it is valid and matches the script.

Validation / quality issues:
${issues}

Script:
${script}

Previous JSON:
${previousJson}

Return { "elements": [ ... ] } only. Keep what already works. Unique ids, 18×32 integer matrix, arrows only between boxes, valid colorTheme tokens, time.end > time.start, track 0–9.`;
}

export function reviewScenePrompt(script: string, times: number[]): string {
  const frames = times.map((t, i) => `Image ${i} is the canvas at t=${t}s.`).join("\n");
  return `You review keyframe stills of a 9:16 teaching diagram (boxes, number badges, arrows) generated from a script.

Score 0–10:
- clarity: is the diagram easy to follow at each moment?
- readability: are labels short, unclipped, high-contrast, not overlapping badly?
- accuracy: does the scene match the script (concepts, order, flows as arrows)?

List concrete issues. Use frameIndex matching the image numbers (0-based) when the problem is visible in a still.

${frames}

Script:
${script}

Return JSON with clarity, readability, accuracy, and issues[].`;
}

export function fixScenePrompt(
  script: string,
  previousJson: string,
  issues: string,
  extraInstructions?: string,
): string {
  const extra = extraInstructions?.trim()
    ? `\nAdditional instructions from the user:\n${extraInstructions.trim()}\n`
    : "";
  return `Redraw this Krayon reel scene JSON to fix the review issues. Keep the same teaching intent.
${extra}
Issues to fix:
${issues}

Script:
${script}

Previous JSON:
${previousJson}

Return { "elements": [ ... ] }. Valid 18×32 scene: unique ids, integer matrices, arrows only between boxes, colorTheme tokens, time windows that reveal with the script.`;
}
