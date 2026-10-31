# krayon studio CLI

Run from the repo:

```bash
pnpm krayon -- status
```

The studio server must be up (`pnpm studio-backend`, `127.0.0.1:8789`). The CLI talks only to that server.

Output is one JSON object. `--pretty` indents it. Errors go to stderr as JSON and the process exits non-zero (`2` when `baseRevision` is stale, `1` otherwise). Default actor is `grok`. Override with `--actor human`. Pick a project with `--project <slug>` or `projects use`.

## Commands

```bash
pnpm krayon -- projects list
pnpm krayon -- projects new "Lecture 12"
pnpm krayon -- projects use lecture-12
pnpm krayon -- import /absolute/path/video.mp4
pnpm krayon -- status
pnpm krayon -- clips --label falseStart --status rejected
pnpm krayon -- clip c-0007
pnpm krayon -- play-info c-0007 --pad 0.5
pnpm krayon -- lint
pnpm krayon -- order
pnpm krayon -- history
pnpm krayon -- undo
pnpm krayon -- redo
pnpm krayon -- schema
```

`play-info` returns `audioUrl` and an `afplay` hint. It does not open a window.

### Edits

`select` and `reject` take one or more ids. They send one atomic ops batch.

```bash
pnpm krayon -- select c-0007 c-0012
pnpm krayon -- reject c-0008
pnpm krayon -- split c-0007 --at 12.4
pnpm krayon -- split c-0007 --word 3
pnpm krayon -- merge c-0007 c-0008
pnpm krayon -- trim c-0007 --start 1.2 --end 4.5
pnpm krayon -- trim c-0007 --start 1.2 --end 4.5 --sample-accurate
```

Trim snaps to word edges unless `--sample-accurate`. Merge only works when the source gap is at most 1 second.

Raw ops (the CLI fills in `baseRevision` from the current project unless the JSON already has it):

```bash
pnpm krayon -- op '{"op":"reorder","order":["c-0012","c-0007"]}'
pnpm krayon -- op --file edit.json
pnpm krayon -- op --label "drop the false start" <<'JSON'
{"ops":[{"op":"reject","clipId":"c-0003"},{"op":"note","clipId":"c-0007","note":"keep this one"}]}
JSON
```

`ungroup`, `moveToGroup`, and `undecided` use the same `op` JSON.

### Reanalyze

```bash
pnpm krayon -- reanalyze c-0007 --mode resegment --silence 0.25 --pad 0.08
pnpm krayon -- reanalyze c-0007 c-0008 --mode regroup --similarity 0.6
pnpm krayon -- reanalyze c-0004 --mode retranscribe
```

Modes: `resegment` (default), `regroup`, `retranscribe`. Clip ids become the time range. This calls Whisper only for `retranscribe`.

### Render

```bash
pnpm krayon -- render --preview
pnpm krayon -- render
```

`--preview` is a small fast encode. The default final render re-encodes video so cuts can fall on words. The response includes `renderId` and `outputName`. Poll `GET /api/studio/projects/<slug>/render/<renderId>` until `status` is `done`. The manifest next to the mp4 lists `{ clipId, outStart, outEnd }`.

## Errors

```json
{"error":"conflict","message":"baseRevision 3 does not match current 4","currentRevision":4}
```

```json
{"error":"validation","message":"wordIndex must leave words on both sides","errors":[{"clipId":"c-0007","field":"wordIndex","message":"wordIndex must leave words on both sides","allowed":{"min":1,"max":5}}]}
```

Read `GET /api/studio/schema` (or `krayon schema`) for the field list and op examples.
