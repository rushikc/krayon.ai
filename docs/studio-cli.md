# krayon studio CLI

Run from the repo:

```bash
pnpm krayon status
```

The studio server must be up (`pnpm studio-backend`, `127.0.0.1:8789`). The CLI talks only to that server. Override the base URL with `KRAYON_STUDIO_URL` (default `http://127.0.0.1:8789`).

Output is one JSON object. `--pretty` indents it. Default actor is `grok`. Override with `--actor human`. Pick a project with `--project <slug>` or `projects use`. Most failures exit `1`. HTTP 409 (stale `baseRevision`, or the project is busy) exits `2`. A duplicate project name is also HTTP 409 but exits `1`. `projects new` requires a title. `projects delete-all` refuses without `--yes`. Confirmation waits use `0` and `3`–`6`, listed below.

## Commands

```bash
pnpm krayon projects list
pnpm krayon projects new "Lecture 12"
pnpm krayon projects new --title "Lecture 12" --slug lecture-12
pnpm krayon projects use lecture-12
pnpm krayon projects delete lecture-12
pnpm krayon projects delete-all --yes
pnpm krayon import /absolute/path/video.mp4
pnpm krayon status
pnpm krayon clips --label falseStart --status rejected
pnpm krayon clip c-0007
pnpm krayon play-info c-0007 --pad 0.5
pnpm krayon lint
pnpm krayon order
pnpm krayon history
pnpm krayon undo
pnpm krayon redo
pnpm krayon schema
pnpm krayon doctor
pnpm krayon reset-status
```

`play-info` returns `audioUrl` and an `afplay` hint. It does not open a window.

### Edits

`select` and `reject` take one or more ids. They send one atomic ops batch.

```bash
pnpm krayon select c-0007 c-0012
pnpm krayon select c-0007 --reason "cleanest delivery"
pnpm krayon reject c-0008
pnpm krayon reject c-0008 --reason "false start"
pnpm krayon annotate c-0007 --json '{"verdict":"keep","reason":"cleanest delivery","confidence":0.8}'
pnpm krayon annotate c-0007 --file notes.json
pnpm krayon annotate c-0007 --json '{"verdict":"drop"}' --replace
pnpm krayon settings
pnpm krayon settings set silence 0.3
pnpm krayon settings set pad 0.05
pnpm krayon settings set similarity 0.7
pnpm krayon settings set snap true
pnpm krayon settings set snapSearch 0.3
pnpm krayon script show --project demo
pnpm krayon script set --project demo --file script.txt
pnpm krayon split c-0007 --at 12.4
pnpm krayon split c-0007 --at 12.4 --sample-accurate
pnpm krayon split c-0007 --at 12.4 --at 14.1
pnpm krayon split c-0007 --word 3
pnpm krayon merge c-0007 c-0008
pnpm krayon trim c-0007 --start 1.2 --end 4.5
pnpm krayon trim c-0007 --start 1.2 --end 4.5 --sample-accurate
```

Trim snaps to word edges unless `--sample-accurate`. Merge only works when the source gap is at most 1 second.

Raw ops (the CLI fills in `baseRevision` from the current project unless the JSON already has it):

```bash
pnpm krayon op '{"op":"reorder","order":["c-0012","c-0007"]}'
pnpm krayon op --file edit.json
pnpm krayon op --label "drop the false start" <<'JSON'
{"ops":[{"op":"reject","clipId":"c-0003"},{"op":"note","clipId":"c-0007","note":"keep this one"}]}
JSON
```

`ungroup`, `moveToGroup`, and `undecided` use the same `op` JSON.

### Analyze

```bash
pnpm krayon analyze --silence 0.4 --pad 0.05 --similarity 0.7 --language en
```

Posts those fields to `POST /projects/:slug/analyze` and prints the JSON result. The project needs an imported video. This runs Whisper. There is no `--pipeline` flag on `analyze`, so the run is `auto`: scripted when the project already has script lines, otherwise transcript. `settings set` only accepts `silence`, `pad`, `similarity`, `snap` (`true` or `false`), and `snapSearch`. Script match thresholds stay on the settings object; the CLI does not set them.

### Reanalyze

```bash
pnpm krayon reanalyze c-0007 --mode resegment --silence 0.25 --pad 0.08
pnpm krayon reanalyze c-0007 c-0008 --mode regroup --similarity 0.6
pnpm krayon reanalyze c-0004 --mode retranscribe
pnpm krayon reanalyze --mode resegment --start 10 --end 40 --pipeline transcript
pnpm krayon reanalyze --mode resegment --reset --pipeline scripted
```

Modes: `resegment` (default), `regroup`, `retranscribe`. Clip ids become the time range. `--start` and `--end` set a range in seconds. Omit clip ids and range for a full-file `resegment` from the saved transcript. `--pipeline` is `auto`, `transcript`, or `scripted` for that run only. `--reset` mints new clip ids and resets decisions. This calls Whisper only for `retranscribe`.

```bash
pnpm krayon reanalyze --mode resegment --reset
```

### Render

```bash
pnpm krayon render --preview
pnpm krayon render
```

`--preview` is a small fast encode. The default final render re-encodes video so cuts can fall on words. The response includes `renderId` and `outputName`. The UI follows SSE `render` events (no polling). `pnpm krayon render-cancel <renderId>` stops ffmpeg (`status: cancelled`). The manifest next to the mp4 lists `{ clipId, outStart, outEnd }`.

`clip` and `clips` include `llm` and `statusReason`. Store per-clip reasoning with `annotate`. Set `--reason` whenever you select or reject. `script set` without `--file` writes an empty script and sets `needsRebuild`.

## Errors

```json
{"error":"conflict","message":"baseRevision 3 does not match current 4","currentRevision":4}
```

```json
{"error":"validation","message":"wordIndex must leave words on both sides","errors":[{"clipId":"c-0007","field":"wordIndex","message":"wordIndex must leave words on both sides","allowed":{"min":1,"max":5}}]}
```

Read `GET /api/studio/schema` (or `krayon schema`) for the field list and op examples.

### Confirmations

Grok should run `krayon ask … --wait` as a **background** shell command and continue when it finishes. Do not ask the human in chat.

```bash
pnpm krayon ask confirm "Reject c-0003?" --message "weak take" --clips c-0003 --note --ops-file edit.json --wait --timeout 600
pnpm krayon ask choice "Keep which take?" --option keep=Keep c-0007 --option drop=Drop c-0007 --wait
pnpm krayon ask --file question.json --wait
pnpm krayon confirmations --status pending
pnpm krayon confirmation q-0003
pnpm krayon confirm-wait q-0003 --timeout 600
pnpm krayon cancel-ask q-0003
```

`--wait` blocks on the long-poll endpoint. Exit codes: `0` applied, `3` declined or other non-apply answer, `4` timed out, `5` stale, `6` cancelled or expired, `2` conflict, `1` other error.
