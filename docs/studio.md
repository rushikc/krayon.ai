# Studio

Studio turns one long talking-head recording into a single video made of the chosen takes. The browser, the `krayon` CLI, and Grok all edit the same cut list. Nothing is uploaded.

Canvas animation is not part of this phase. `cuts.json` keeps an empty `canvasDraft` for later.

## Folders

Projects live in `studio/<slug>/` (gitignored):

| Path | Role |
|---|---|
| `meta.json` | Title, source path, revision pointer, id counters, status, `pipeline` (`auto` / `transcript` / `scripted`), `lastPipeline`, `scriptLineCount`, `needsRebuild` |
| `script.txt` | Optional spoken script (one sentence per line). Source of truth for the scripted pipeline |
| `cuts.json` | Clips, groups, selected order, `canvasDraft` |
| `analysis/source.wav` | 16 kHz mono cache. Reused if present |
| `analysis/words.json` | Word timestamps. Reused if present, so a rerun does not re-extract or re-transcribe |
| `history/0001.json` | Snapshot plus `actor`, `label`, `summary` |
| `output/` | Preview and final mp4 files and a JSON manifest of clip ids to output time |
| `confirmations.json` | Pending and answered Grok questions (not in undo) |

The original video path is stored and never modified.

## Clip model

Ids are `c-0007` for clips and `g-0001` for retake groups. A project never reuses an id. Split and merge retire the old ids, mint new ones, and set `parentIds`.

Re-analysis keeps an existing id when the new time span overlaps it with intersection-over-union of at least 0.7. Spans that do not match get new ids. Human `status`, `decidedBy`, and `note` stay on a matched clip.

| Field | Meaning |
|---|---|
| `sourceStart` / `sourceEnd` | Seconds on the original file |
| `ranges` | Stitched source spans when a clip is more than one piece |
| `words` | `{ text, start, end }` on the source timeline |
| `groupId` | Retake group |
| `label` | `falseStart`, `cut_off`, `starts_late`, `missing_words`, `misstatement`, or `none` |
| `score` / `reasons` | Take ranking. Transcript runs use the reference-take score. Scripted runs store the match score and reasons |
| `script` | Scripted takes only: `{ line, text, score }` for the script line this take was matched to |
| `status` | `selected`, `rejected`, or `undecided` |
| `decidedBy` | `algorithm`, `grok`, or `human` |
| `statusReason` | Optional string from whoever last changed status |
| `statusAt` | ISO time of that status change |
| `note` | Free text |
| `llm` | Free-form JSON object (max 8 KB) for per-clip model notes. Missing files load as `{}` |

`order` is the selected clip ids in cut order. On a transcript first pass, the selected clip is the one whose reasons include `reference take`, otherwise the group's recommended clip, otherwise the only take. Non-reference takes with a flaw label (`falseStart`, `cut_off`, `starts_late`, `missing_words`, `misstatement`) are rejected; clean alternates stay undecided. Order follows the first appearance of each group. A scripted run selects one take per script line and orders groups by `scriptLine`.

## Pipelines

`meta.pipeline` defaults to `auto`. `lastPipeline` is the pipeline that last finished (`transcript` or `scripted`). `auto` runs scripted when `script.txt` has at least one line, otherwise transcript. An explicit `transcript` run stays transcript. An explicit `scripted` run with an empty script falls back to transcript.

Shared helpers are in `src/backend/app/services/studio/common/`.

### Transcript (pipeline 1)

`analyze.py` and range `reanalyze.py` build segments from words, extend each tail, group retakes, then snap boundaries when `snapToAudio` is true (the default).

Tail extension walks 20 ms RMS windows. It keeps the tail while the audio stays quiet for 0.18 s (`TAIL_QUIET_HOLD_S`). Studio stops at `silence.tail_max_extend_s` (0.3 s in `krayon.toml`) and 0.02 s before the next segment (`TAIL_NEIGHBOR_GUARD_S`). The legacy audio editor still extends up to 2 s with no neighbor guard.

Snapping builds an RMS envelope (10 ms hops) and moves each shared or per-clip edge to a quiet point inside `snapSearchSeconds` (default 0.3 s), using `pad` (default 0.05 s). It runs on a full analyze and on `resegment` / `retranscribe` when `source.wav` exists. It does not run on `regroup`. Manual `split`, `splitMany`, `merge`, and `trim` are not snapped. Trim still snaps to word edges unless `sampleAccurate` is set. That word snap is not the RMS envelope.

### Scripted (pipeline 2)

`scripted_pipeline.py` aligns the recording to `script.txt` (one sentence per line), then snaps the same way when `snapToAudio` is on. Each take gets `score` and `reasons`. The matched take stores `script.line`, `script.text`, and `script.score`. A script line with no take is a group whose `clipIds` are empty. After a scripted analyze or reanalyze, each selected take whose `script.score` is below `scriptConfirmThreshold` (default 0.85) opens a confirmation.

`PUT /projects/:slug/script` writes `script.txt` and sets `needsRebuild` without analyzing. A successful analyze or reanalyze clears `needsRebuild`.

## Workspace

`/studio` is the landing page: required unique project name, video path, an optional Script box, Delete all, and recent projects with a per-row delete control. While `status` is `analyzing`, the workspace preview shows a staged progress stepper (extract, transcribe, cut/align, group/match, optional snap, save) driven by SSE `progress` events.

`/studio/:slug` is the workspace.

- Single click a clip row to open it. Double click a row to collapse that group. Collapse all / Expand all toggles every visible group.
- The preview tabs row is clip audio, rendered video, and full source, plus Undo and Redo.
- The waveform draws a playhead on the padded clip audio.
- When `needsRebuild` is set, the controls panel says “Script changed. Rebuild to apply.” Rebuild is a full `resegment` with `reset`. If the project has a script, the dialog offers **Rebuild without script** (`pipeline: transcript`) and **Rebuild with script** (`pipeline: scripted`). With no script there is one confirm.
- View transcript opens one wrapping, scrollable dialog. Search highlights matches. Click a word to open its clip.
- The confirmation tray shows the oldest pending ask.

## Settings

`GET` and `PATCH /projects/:slug/settings` return this object. Analyze uses these values when the request omits them.

| Field | Default |
|---|---|
| `silenceThreshold` | 0.4 |
| `pad` | 0.05 |
| `similarityThreshold` | 0.7 |
| `snapToAudio` | true |
| `snapSearchSeconds` | 0.3 |
| `scriptMatchThreshold` | 0.7 |
| `scriptConfirmThreshold` | 0.85 |
| `scriptPreferLastTakes` | true |
| `scriptWhisperPrompt` | true |

## Lint

`GET /projects/:slug/lint`. Thresholds are the constants in `src/studio-backend/src/domain/lint.ts`.

| Code | Fires when |
|---|---|
| `short_clip` | `duration` under 0.35 s |
| `selected_weak` | `status` is `selected` and `label` is not `none` |
| `mid_word` | A cut falls inside a word, more than 0.02 s from either word edge |
| `bad_word_timing` | Any word is shorter than 0.02 s or longer than 1.0 s |
| `edge_loud` | The 150 ms window just outside the clip (`before` or `after`) is louder than −40 dBFS |
| `edge_clipped` | The clip's first or last 20 ms is louder than −30 dBFS and that neighbor window is also above −40 dBFS |
| `script_line_missing` | A group has `scriptLine` and no clips |
| `group_unselected` | The group has clips and none are selected |
| `duplicate_line` | More than one selected clip in the group |
| `gap` | In `order`, the source gap before a clip is over 2 s |
| `overlap` | In `order`, a clip starts more than 0.05 s before the previous clip ends |

Clip detail still reports 150 ms `start`/`end` plus 20 ms `startEdge`/`endEdge`.

## Setup

After pulling, reinstall the Python venv (`pip install -r src/backend/requirements.txt` inside `src/backend/.krayonenv`) because `av` is pinned below 17, then restart the backend.

## Services

- UI: `http://localhost:5173/studio` (Vite proxies `/api/studio` to `127.0.0.1:8789`)
- Studio API: Fastify on `127.0.0.1:8789`, CORS limited to the Vite origin
- Audio and render: Python `http://127.0.0.1:8000/api/audio-studio` (called by Fastify, not by the browser)

Final renders always re-encode video (`h264_videotoolbox` on a Mac, otherwise `libx264`) and apply short audio fades at joins. Preview is a faster, smaller encode.

## API

All project routes are under `/api/studio/projects/:slug`. Send `X-Krayon-Actor: grok` or `human`.

- `GET /api/studio/schema` — fields, ops, rules, error example
- `GET /api/studio/health` — `{ status, projectsDir }`
- `GET/POST /api/studio/projects`, `POST /api/studio/projects/use`. Create requires a unique title (1–80 chars). Duplicate title or slug (including compact slug like `test3` vs `Test 3`) returns 409. There is no silent `-2` rename.
- `GET /api/studio/projects/check-name?name=` — `{ available, reason? }`
- `DELETE /api/studio/projects/:slug` — `{ deleted }`. Cancels analyze/render first. 404 unknown, 400 bad slug. Does not touch the original source video.
- `DELETE /api/studio/projects` — body or query `{ confirm: "delete-all" }`. Returns `{ deleted, skipped }`.
- `GET /projects/:slug` — clips, groups, order, revision, history, `hasTranscript` when `analysis/words.json` exists, plus `lastPhase` / `analysisStartedAt` for the stepper
- `POST /projects/:slug/import` — `{ "path" }` or a multipart file streamed to `imported/`
- `POST /projects/:slug/analyze` — Studio Analyze audio. Optional `pipeline`: `auto` (default), `transcript`, or `scripted`. Creating a project and importing a video auto-starts this once the project screen opens. Progress phases: `extracting`, `transcribing`, `segmenting`, `grouping`, `snapping` (when snap is on), `saving`.
- `GET /projects/:slug/clips?group=&label=&status=`
- `GET /projects/:slug/clips/:id` — words, neighbours, group mates, reasons
- `GET /projects/:slug/clips/:id/audio.wav?pad=0.5`
- `GET /projects/:slug/clips/:id/peaks?buckets=800` — `{ duration, peaks: [min, max, …] }` in -1..1, cached per clip id + revision + pad
- `GET /projects/:slug/clips/:id/transcript`
- `GET /projects/:slug/clips/:id/frame.png?at=`
- `POST /projects/:slug/ops` — `{ baseRevision, ops, label }`. Mismatch is HTTP 409. Validation errors include `clipId`, `field`, `message`, `allowed`.
- `POST /projects/:slug/reanalyze` — `mode` is `retranscribe`, `resegment`, or `regroup`. Omit the range for a full-file `resegment`. `reset: true` mints new clip ids and reruns the algorithm cut (Studio Rebuild). Optional `pipeline`: `scripted` or `transcript` for that run only
- `PUT /projects/:slug/script` — `{ baseRevision, script }` sets or clears `script.txt`, commits a history revision, and sets `needsRebuild` without analyzing
- `GET/PATCH /projects/:slug/settings` — the settings object in the Settings section above
- `GET /projects/:slug/segments`, `GET /projects/:slug/transcript`
- `POST /projects/:slug/render` — `{ "quality": "preview" \| "final" }`
- `GET /projects/:slug/render/:id`, `POST /projects/:slug/render/:id/cancel`, `GET /projects/:slug/output`
- `GET /projects/:slug/lint`, `GET /projects/:slug/history`
- `POST /projects/:slug/undo`, `/redo`, `/restore`
- `GET /projects/:slug/events` — server-sent events for progress, revisions, confirmations, and `deleted`
- `GET/POST /projects/:slug/confirmations`, `POST …/answer`, `POST …/cancel`, `GET …/wait`, `GET …/wait-any`
- `POST /projects/:slug/reset-status`

## Confirmations

Grok never asks for confirmation in chat. It writes a question to `confirmations.json` (`krayon ask … --wait`). The workspace shows the oldest pending item; a human click answers it. If the option has `applyOps`, the server applies `proposedOps` as one history revision with actor `human`. If the project revision moved, the item is `stale` and nothing is applied.

Ops: `select`, `reject`, `undecided` (optional `statusReason`), `reorder`, `split` (`at` or `wordIndex`), `splitMany` (`at: number[]` exact times, undecided children, one history entry), `merge`, `trim` (word snap unless `sampleAccurate`), `ungroup`, `moveToGroup`, `note`, `annotate` (`llm` object, `merge` defaults true).

Undo and redo move the history pointer. Restore copies an older snapshot forward as a new revision. A new edit drops the redo branch. Id counters only increase, including across undo.

## Grok loop

1. `krayon status`
2. `krayon lint`
3. `krayon clip c-0007` and `krayon play-info c-0007` (padded wav)
4. `reanalyze`, `split`, `merge`, or `trim`
5. `krayon annotate c-0007 --json '{"verdict":"keep","reason":"…"}'` to store per-clip reasoning
6. `krayon select c-0007 --reason "cleanest delivery"` (always set `statusReason` when selecting or rejecting)
7. `krayon render --preview`, then listen and look
8. `krayon render` for the final file

The UI updates from the event stream when the CLI writes a revision.
