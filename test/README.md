# End-to-end tests (Playwright)

Browser and API tests for Krayon Studio, the home pages, the reel workspace, and the legacy audio editor. They run against your **running dev servers** and the installed Google Chrome. Default Studio specs build a synthetic fixture (`e2e-fix-*`) instead of opening `real` or `test1`.

## Run

```bash
pnpm dev              # terminal 1: Vite, Python :8000, reel :8788, studio :8789
pnpm test:e2e         # terminal 2: default suite (skip @slow; about 2 minutes)
pnpm test:e2e:slow    # also runs @slow (real render, Whisper)
pnpm test:e2e:report  # open the HTML report from the last run
```

Run a single file or test:

```bash
pnpm test:e2e test/e2e/studio-ui.spec.ts
pnpm test:e2e -g "waveform"
```

If Vite or the Studio API is down, the suite stops immediately with a message telling you to start `pnpm dev`. Global setup checks those two. Python and the reel backend start with `pnpm dev`; analyze and render need Python.

## Layout

- `playwright.config.ts`: Chrome, 1440×900, retries 0, workers 1. Default `grepInvert: /@slow/` unless `E2E_SLOW=1`. Screenshots live in `e2e/__screenshots__`.
- `helpers/global-setup.ts`: checks Vite and the Studio backend are reachable.
- `helpers/studio-api.ts`: Studio API client, project picking, rollback, and `e2e-*` folder cleanup.
- `helpers/studio-page.ts`: page helpers (`openStudio`, `selectClip`, `clickWaveform`).
- `helpers/fixture-project.ts`: synthetic 40 s WAV/MP4 plus designed `words.json`. Creates `e2e-fix-*` projects and deletes them afterwards.
- `helpers/legacy-fixture.ts`: seeds `.krayon` editor state so the audio page can Rebuild without Whisper.
- `e2e/studio-api.spec.ts`: API checks (fields, peaks, wav Range support, 409 on stale revision).
- `e2e/studio-empty.spec.ts`: a project with no clips shows only Analyze and Rebuild.
- `e2e/studio-script.spec.ts`: landing script count, Rebuild dialog, needs-rebuild, missing script lines.
- `e2e/studio-ui.spec.ts`: left list, filters, controls, clip selection, accept/reject, transcript dialog, group expand/collapse, playhead contrast and motion, waveform editor and cuts, console errors.
- `e2e/studio-flow.spec.ts`: landing script field and fixture clip count after cached-words analyze.
- `e2e/studio-edit.spec.ts`: accept/reject, S split, API merge/trim, undo/redo buttons, SSE without reload.
- `e2e/studio-rebuild.spec.ts`: cancel, rebuild with script vs without script.
- `e2e/studio-render.spec.ts`: `@slow`, preview cancel then playback (needs `E2E_RENDER=1`).
- `e2e/studio-a11y-and-theme.spec.ts`: keyboard list, light/dark screenshots, 1280×720 and 1024×700 overflow.
- `e2e/studio-errors.spec.ts`: API abort, bad path, analysis abort, two-context conflict.
- `e2e/studio-whisper.spec.ts`: `@slow`, delete `words.json` and transcribe (`E2E_WHISPER=1`).
- `e2e/legacy-audio.spec.ts`: seeded Rebuild; Analyze-silence is `@slow` + `E2E_WHISPER=1`.
- `e2e/reel.spec.ts`: `/reel-animations` with `route.fulfill` on `/api/reel` (no Gemini).
- `e2e/home-nav.spec.ts`: three tiles, logo, back control.

## Data safety

- Default UI tests create `e2e-fix-<timestamp>` from the fixture, analyze with cached words (no Whisper), and delete the folder in `afterAll`.
- Set `E2E_REAL=1` to use an existing analyzed project: `E2E_PROJECT`, else `test1`, then `real`, then the first ready one. That path never deletes the user's project.
- Every edit a UI test makes is undone afterwards by rolling history back to the starting revision.
- Empty-project tests create `e2e-empty-<timestamp>` and delete it afterwards. Only folders named `e2e-*` are ever deleted.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_PROJECT` | auto | Project slug when `E2E_REAL=1` |
| `E2E_REAL` | off | Set to `1` to use `pickProject()` instead of the fixture |
| `E2E_BASE_URL` | `http://localhost:5173` | Frontend URL |
| `E2E_API` | `http://127.0.0.1:8789/api/studio` | Studio API URL |
| `E2E_CHANNEL` | `chrome` | Browser channel (`chromium` to use Playwright's own) |
| `E2E_RENDER` | off | Set to `1` to include the slow real-render tests |
| `E2E_WHISPER` | off | Set to `1` to include real Whisper tests |
| `E2E_SLOW` | off | Set to `1` to run `@slow` tests (`pnpm test:e2e:slow` sets this plus render and Whisper; it does not set `E2E_REAL`) |

## Screenshots

Baselines live in `test/e2e/__screenshots__/` and are valid for the machine that generated them. Update with:

```bash
pnpm test:e2e test/e2e/studio-a11y-and-theme.spec.ts --update-snapshots
```

## Adding tests

Prefer `data-testid` and role selectors. Rows in the clip list are `role="button"` elements, so use `clipRow(page, id)`. Wait for `openStudio` (it waits for rows to render) before reading the list. Tag slow real-encode or Whisper cases `@slow`.
