# End-to-end tests (Playwright)

Browser and API tests for Krayon Studio. They run against your **real running dev servers** and the installed Google Chrome, so nothing is mocked.

## Run

```bash
pnpm dev              # terminal 1: Vite, Python :8000, reel :8788, studio :8789
pnpm test:e2e         # terminal 2: whole suite (about 20 s)
pnpm test:e2e:report  # open the HTML report from the last run
```

Run a single file or test:

```bash
pnpm test:e2e test/e2e/studio-ui.spec.ts
pnpm test:e2e -g "waveform"
```

If Vite or the Studio API is down, the suite stops immediately with a message telling you to start `pnpm dev`. Global setup checks those two. Python and the reel backend start with `pnpm dev`; the Studio specs that analyze or render need Python.

## Layout

- `playwright.config.ts`: config (Chrome, 1440x900, screenshots and traces on failure).
- `helpers/global-setup.ts`: checks Vite and the Studio backend are reachable.
- `helpers/studio-api.ts`: Studio API client, project picking, rollback and temp-project cleanup.
- `helpers/studio-page.ts`: page helpers (`openStudio`, `selectClip`, `clickWaveform`).
- `e2e/studio-api.spec.ts`: API checks (fields, peaks, wav Range support, 409 on stale revision).
- `e2e/studio-empty.spec.ts`: a project with no clips shows only Analyze and Rebuild.
- `e2e/studio-script.spec.ts`: optional script field on the landing form, Rebuild dialog choice when a script exists (`e2e-script-*` folder, deleted afterwards).
- `e2e/studio-ui.spec.ts`: left list, filters, controls, clip selection, accept/reject, transcript dialog, group expand/collapse, playhead contrast and motion, waveform editor and cuts, console errors.

## Data safety

- UI tests use an existing analyzed project: `E2E_PROJECT`, else `test1`, then `real`, then the first ready one.
- Every edit a test makes is undone afterwards by rolling the project's history back to the revision it started at. Revisions you made yourself before the run are left alone.
- Empty-project tests create `e2e-empty-<timestamp>` and delete its folder afterwards. Only folders named `e2e-*` are ever deleted.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `E2E_PROJECT` | auto | Project slug for the UI tests |
| `E2E_BASE_URL` | `http://localhost:5173` | Frontend URL |
| `E2E_API` | `http://127.0.0.1:8789/api/studio` | Studio API URL |
| `E2E_CHANNEL` | `chrome` | Browser channel (`chromium` to use Playwright's own) |
| `E2E_RENDER` | off | Set to `1` to include the slow real-render test |

## Adding tests

Prefer `data-testid` and role selectors. Rows in the clip list are `role="button"` elements, so use `clipRow(page, id)`. Wait for `openStudio` (it waits for rows to render) before reading the list.
