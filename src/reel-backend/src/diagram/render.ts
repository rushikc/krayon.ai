import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { packageRoot, type ReelConfig } from "../config.js";
import type { ExcalidrawElement } from "./excalidraw.js";
import { issue, type DiagramIssue } from "./issues.js";
import { cardPngPath, type ReelPaths } from "./paths.js";
import { CARD_INNER_WIDTH, EXPORT_PADDING, EXPORT_SCALE } from "./tokens.js";

const require = createRequire(import.meta.url);

export type RenderStepInput = {
  cardId: string;
  step: number;
  elements: ExcalidrawElement[];
};

export type RenderedStep = {
  cardId: string;
  step: number;
  pngPath: string;
  issues: DiagramIssue[];
};

let bundleCache: string | undefined;

async function bundlePage(): Promise<string> {
  if (bundleCache && existsSync(bundleCache)) return bundleCache;
  const esbuild = (await import("esbuild")) as typeof import("esbuild");
  const outfile = path.join(packageRoot, "data", "diagram-render-page.js");
  mkdirSync(path.dirname(outfile), { recursive: true });
  const entry = path.join(packageRoot, "src/diagram/render/page.ts");
  const excalidrawProd = path.dirname(require.resolve("@excalidraw/excalidraw"));
  await esbuild.build({
    absWorkingDir: packageRoot,
    entryPoints: [entry],
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile,
    logLevel: "silent",
    conditions: ["production"],
    alias: {
      "@excalidraw/excalidraw/index.css": path.join(excalidrawProd, "index.css"),
    },
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    loader: {
      ".css": "text",
      ".woff2": "dataurl",
      ".woff": "dataurl",
      ".ttf": "dataurl",
    },
    banner: {
      js: "var process = { env: { NODE_ENV: 'production' } };",
    },
  });
  bundleCache = outfile;
  return outfile;
}

function fontsDir(): string {
  return path.dirname(require.resolve("@excalidraw/excalidraw"));
}

export function chromeIssue(chromePath: string): DiagramIssue {
  return issue(
    "CHROME_NOT_FOUND",
    "error",
    `Chrome not found at ${chromePath}. Install Google Chrome or set KRAYON_CHROME_PATH / [diagram].chrome_path.`,
  );
}

export function chromeAvailable(chromePath: string): boolean {
  return existsSync(chromePath);
}

type PuppeteerModule = {
  default?: { launch: (opts: Record<string, unknown>) => Promise<Browser> };
  launch?: (opts: Record<string, unknown>) => Promise<Browser>;
};

type Browser = {
  newPage: () => Promise<Page>;
  close: () => Promise<void>;
};

type Page = {
  setContent: (html: string, opts?: { waitUntil: string }) => Promise<void>;
  addScriptTag: (opts: { path: string }) => Promise<void>;
  evaluate: (fn: (payload: unknown) => Promise<unknown> | unknown, payload: unknown) => Promise<unknown>;
};

export async function renderSteps(
  config: ReelConfig,
  paths: ReelPaths,
  steps: RenderStepInput[],
): Promise<{ rendered: RenderedStep[]; issues: DiagramIssue[] }> {
  const chromePath = config.diagram.chromePath;
  if (!chromeAvailable(chromePath)) {
    return { rendered: [], issues: [chromeIssue(chromePath)] };
  }
  const puppeteer = require("puppeteer-core") as PuppeteerModule;
  const launch = puppeteer.launch ?? puppeteer.default?.launch;
  if (!launch) {
    return { rendered: [], issues: [chromeIssue(chromePath)] };
  }
  const scriptPath = await bundlePage();
  const assetPath = `${pathToFileURL(fontsDir()).href}/`;
  const browser = await launch({
    executablePath: chromePath,
    headless: true,
    args: ["--allow-file-access-from-files", "--disable-gpu"],
  });
  const rendered: RenderedStep[] = [];
  const issues: DiagramIssue[] = [];
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"><script>window.EXCALIDRAW_ASSET_PATH = ${JSON.stringify(assetPath)};</script></head><body><div id="root"></div></body></html>`,
      { waitUntil: "domcontentloaded" },
    );
    await page.addScriptTag({ path: scriptPath });
    for (const step of steps) {
      const result = (await page.evaluate(
        (payload) => {
          const fn = (
            globalThis as unknown as { __KRAYON_RENDER__: (p: unknown) => Promise<unknown> }
          ).__KRAYON_RENDER__;
          return fn(payload);
        },
        {
          elements: step.elements,
          exportPadding: EXPORT_PADDING,
          scale: EXPORT_SCALE,
          cardWidth: CARD_INNER_WIDTH,
        },
      )) as { pngBase64: string; issues: DiagramIssue[] };
      const pngPath = cardPngPath(paths, step.cardId, step.step);
      mkdirSync(path.dirname(pngPath), { recursive: true });
      writeFileSync(pngPath, Buffer.from(result.pngBase64, "base64"));
      rendered.push({ cardId: step.cardId, step: step.step, pngPath, issues: result.issues ?? [] });
      issues.push(...(result.issues ?? []));
    }
  } finally {
    await browser.close();
  }
  return { rendered, issues };
}
