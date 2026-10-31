# UI Design

Krayon uses a home screen with three product tiles: an **audio library** and **editor**, a **reel animations** canvas, and **Studio**.

## Pages

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Home | Three tiles: Audio analysis, Reel animations (“Coming soon”), Studio |
| `/audio` | Dashboard | Folder + video library, preview, metadata |
| `/reel-animations` | Reel animations | 9:16 canvas, compact timeline, and reel-assistant chat |
| `/editor/:mediaId` | Editor | Single-video processing workspace |
| `/studio` | Studio landing | Project name, video path, optional Script box, recent projects |
| `/studio/:slug` | Studio workspace | Clip list, waveform editor, preview tabs, controls, confirmation tray |

```mermaid
flowchart LR
  Home["/ Home"] -->|"Audio analysis"| Audio["/audio library"]
  Home -->|"Reel animations"| Reels["/reel-animations"]
  Home -->|"Studio"| Studio["/studio"]
  Audio -->|"Open in editor"| Editor["/editor/:mediaId"]
  Editor -->|"Back to library"| Audio
  Studio -->|"Open project"| Workspace["/studio/:slug"]
  Workspace -->|"Back to library"| Studio
```

## Chrome

`AppShell` is the shared header.

- The word **Krayon** on the left links to `/`.
- A back button shows only when the page sets `showBack`. Studio landing goes Home. The editor and a Studio project go Back to library (`/audio` and `/studio`).
- The page title is centered. A Studio project also centers the project name as a subtitle.
- The light/dark toggle is in the header. Default is dark. The choice is `localStorage` key `krayon-theme` (`src/frontend/lib/theme.ts`). That chrome theme is separate from canvas `RenderTheme`.

## Home layout

Three tiles in a row from `sm` up: **Audio analysis** (silence removal & clip grouping), **Reel animations** (subtitle “Coming soon”), **Studio** (pick the best takes from a long recording).

## Reel animations layout

Portrait reels only (9:16). No landscape editor.

```
┌──────────────────────────────────────────────────────────────────┐
│  Home   project name                              theme  Export  │
├──────────┬───────────────────────────────────────────────────────┤
│  9:16    │  Timeline | Chat  │  Canvas Takes Captions Audio …    │
│  canvas  ├───────────────────────────────────────────────────────┤
│          │  Timeline (full width)  OR  Reel assistant chat       │
│  playbar │                                                       │
└──────────┴───────────────────────────────────────────────────────┘
```

- **Top bar (~44px)** — Home, editable project name, app light/dark toggle, Export (solid primary).
- **Far left** — 9:16 canvas, always exactly 9:16. Size is `min(stage width, stage height × 9/16, 45% of the workspace)` with a 220px preferred minimum; on a short window it scales down. Explicit pixel width/height; the left column is the fitted reel plus padding. Compact playbar underneath.
- **Right column** — remaining width. The tool row’s primary control is a large `Timeline | Chat` tab switch (Cmd/Ctrl+K toggles). Secondary ghost tools follow: Canvas, Takes, Captions, Audio, Zoom, then Settings right-aligned. Takes, Captions, and Zoom are disabled (“Coming soon”). Below ~900px, tool labels collapse to icons.
- **Timeline view** — existing tracks, full width, compact rows. Double-click (or Enter on a focused block) opens an **Edit element** modal with the same Config fields as before. Save is one undo step; Cancel / Escape discards; a dirty dialog ignores outside clicks. There is no Config/JSON inspector on the page.
- **Chat view** — reel assistant wired to `POST /api/reel/jobs` (script) and refine. Apply writes through `setElements` (undoable). The reel preview stays visible on the left with the same sizing.
- The chosen Timeline | Chat view is persisted in `localStorage` (`krayon-workspace-side-view`). Default is Timeline.
- **Gemini key** lives in the first-party cookie `krayon_gemini_api_key` (`SameSite=Strict`, not `HttpOnly`) and is sent only as `X-Gemini-Api-Key` on create/refine. Never localStorage.

## Studio layout

`/studio` is a single column: project name, video path (typed or Choose file), an optional Script box, and the recent project list.

`/studio/:slug` is three columns: clip list, preview, controls.

- **Clip list** — single click opens the clip. Double click collapses that group. Collapse all / Expand all toggles every visible group.
- **Preview** — tabs for clip audio, rendered video, and full source. Undo and Redo sit on that tabs row. The waveform playhead (`waveform-playhead`) tracks the padded clip audio.
- **Controls** — Analyze, Rebuild (with script / without script when a script exists), View transcript (one scrollable wrapping dialog; click a word to open its clip), and the confirmation tray for the oldest pending ask.

### App chrome tokens (Velo-like)

Defined on `:root` and `.dark` in [`src/frontend/index.css`](../src/frontend/index.css). Canvas skins (`components/canvas/designs/*`) are a separate `RenderTheme`.

| Token | Light | Dark |
| --- | --- | --- |
| background | `#F6F7F9` | `#0A0A0C` |
| panels / card | `#FFFFFF` | `#101014` |
| raised | `#FFFFFF` | `#16161B` |
| border | `#CFD3DB` | `#32323A` |
| muted text | `#6B6B76` | `#8B8B96` |
| primary | `#2563EB` | `#3B82F6` |

Sans: Geist Variable. Timeline type blocks use tinted fill + 1px border + coloured text (`--timeline-box-*`, `--timeline-number-*`, `--timeline-arrow-*`). Row height 32px, ruler 24px, track labels ~96px.

## Dashboard layout

```
┌─────────────────────────────────────────────────────────────┐
│  Krayon                                         library      │
├──────────┬──────────────────────────────┬───────────────────┤
│ Library  │         Video preview        │   Video details   │
│ (videos) │         (center)             │  + Open in editor │
└──────────┴──────────────────────────────┴───────────────────┘
```

- **Left** — `LibrarySidebar`: folder path, Open folder, video list
- **Center** — `VideoPlayer`: streams original with 20s UI cap for all file sizes
- **Right** — `DashboardPanel`: metadata + **Open in editor** button

No silence removal or clip controls on the dashboard.

## Editor layout

While **Analyze silence** is running, the center panel shows `PipelineStepper` (vertical step list with per-step % and elapsed time). When complete, it switches to `ClipAudioPlayer`. See [pipeline-stages.md](./pipeline-stages.md) for what each step does under the hood.

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back to library   Krayon                    video.mov    │
├──────────┬──────────────────────────────┬───────────────────┤
│ Clips    │  Clip audio OR pipeline      │     Controls      │
│ (after   │  stepper while running       │ Analyze silence,  │
│ analysis)│                              │ list toggle, tools│
└──────────┴──────────────────────────────┴───────────────────┘
```

- **Left** — `ClipsSidebar`: appears after analysis completes
  - **Speech clips only** (default): grouped similar takes, play icon per row
  - **All segments**: chronological speech + silence rows (silence in mild red)
  - Truncated labels show full text on hover (tooltip)
- **Center** — `ClipAudioPlayer` or `PipelineStepper` during async job
- **Right** — `ControlsPanel`: **Analyze silence** (transcribe + segment + group + extract clip audio), editable thresholds with help tooltips, **analysis run** version selector, stats footer, segment list toggle, tools

### Clip list interactions

| Action | Behavior |
|--------|----------|
| Click row | Select the clip. Center plays its extracted WAV (paused until play) |
| Click play icon | Select the clip and start the WAV |
| Silence row | Selects the gap. Metadata only; no WAV |

## Stack

- **React Router** — `/`, `/audio`, `/reel-animations`, `/editor/:mediaId`, `/studio`, `/studio/:slug`
- **Zustand** — shared `media-store` and `silence-store` across routes
- **SSE** — `/api/clips/generate/async` + `/api/clips/progress/{jobId}` for pipeline progress
- **Tailwind CSS v4** — tokens in [`src/frontend/index.css`](../src/frontend/index.css)

## Key components

| Path | Role |
|------|------|
| `src/frontend/pages/HomePage.tsx` | Three-tile product home |
| `src/frontend/pages/studio/StudioLanding.tsx` | Studio landing |
| `src/frontend/pages/studio/StudioWorkspace.tsx` | Studio workspace |
| `src/frontend/pages/studio/StudioClipsPanel.tsx` | Studio clip list |
| `src/frontend/pages/studio/StudioPreviewPanel.tsx` | Preview tabs, Undo/Redo |
| `src/frontend/pages/studio/StudioWaveform.tsx` | Waveform and playhead |
| `src/frontend/pages/studio/StudioControlsPanel.tsx` | Rebuild, transcript dialog |
| `src/frontend/pages/studio/ConfirmationTray.tsx` | Oldest pending ask |
| `src/frontend/pages/DashboardPage.tsx` | Audio library dashboard |
| `src/frontend/pages/ReelAnimationsPage.tsx` | 9:16 reel editor (timeline + chat) |
| `src/frontend/pages/EditorPage.tsx` | Single-video editor |
| `src/frontend/components/layout/LibrarySidebar.tsx` | Video list |
| `src/frontend/components/layout/ClipsSidebar.tsx` | Grouped clips + all-segments timeline |
| `src/frontend/components/layout/DashboardPanel.tsx` | Metadata + Open in editor |
| `src/frontend/components/layout/ControlsPanel.tsx` | Analyze silence + threshold inputs (with help) + version selector + stats footer + list mode toggle |
| `src/frontend/components/player/PipelineStepper.tsx` | Pipeline progress UI — see [pipeline-stages.md](./pipeline-stages.md) |
| `src/frontend/components/player/ClipAudioPlayer.tsx` | Editor clip audio preview |
| `src/frontend/components/player/VideoPlayer.tsx` | Dashboard library video preview |
| `src/frontend/components/layout/AppShell.tsx` | Shared header |

## Folder persistence

Last folder path stored in `localStorage` under key `krayon:lastFolder` and restored on app load.

## Editor state persistence

Each **Analyze silence** run is saved under the video folder as versioned state. Re-opening `/editor/:mediaId` restores the last active run (clips sidebar, stats, options) without re-processing.

### On-disk layout

Co-located with the per-folder cache at `{video_folder}/.krayon/`:

```
.krayon/
  state/
    {mediaId}/
      index.json                 # version list + activeVersionId
      versions/
        {versionId}/             # e.g. 2026-08-23T19-05-00_a1b2c3
          manifest.json          # full persisted payload (words + transcript)
          transcript.txt         # plain full-run transcript
```

- **mediaId** — `sha256(resolved_path)[:16]`, same as the editor URL param
- **index.json** — append-only version history; `activeVersionId` points at the newest run after each analysis
- **manifest.json** — options, analysis (incl. word timings), clips (incl. per-clip words), groups, and `transcript`

### Version behavior

| Action | Behavior |
|--------|----------|
| Open editor | `GET /api/editor/state/{mediaId}` loads active manifest into stores |
| Re-analyze | Creates a new `versions/{versionId}/` folder; prior runs stay on disk |
| Switch run | Version dropdown in Controls → `PUT /api/editor/state/{mediaId}/active` |
| Clip playback | Editor: extracted clip audio WAV; Dashboard: 20s original stream |

The version selector appears only when saved history exists. **Analyze silence** never clears prior segment data from the UI until the new run completes.
