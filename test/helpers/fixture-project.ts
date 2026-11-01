/**
 * Synthetic Studio media for e2e. Timeline matches src/backend/tests/fixtures.py.
 * Projects are created through the Studio API under an e2e- slug and deleted afterwards.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { API, REPO_ROOT, removeProjectFolder, studioApi } from "./studio-api";

export const FIXTURE_DURATION_S = 40;
export const FIXTURE_RATE = 16000;
const AMPLITUDE = 8000;

type Region = { start: number; end: number; kind: "tone" | "decay" | "noise" };

const REGIONS: Region[] = [
  { start: 1.0, end: 4.7, kind: "tone" },
  { start: 6.2, end: 9.9, kind: "tone" },
  { start: 11.4, end: 13.4, kind: "tone" },
  { start: 13.7, end: 17.15, kind: "tone" },
  { start: 18.7, end: 20.6, kind: "tone" },
  { start: 20.6, end: 20.82, kind: "decay" },
  { start: 22.2, end: 22.28, kind: "noise" },
  { start: 23.5, end: 26.3, kind: "tone" },
];

export const FIXTURE_WORDS: Array<{ text: string; start: number; end: number }> = [
  { text: "alpha", start: 1.08, end: 1.48 },
  { text: "beta", start: 1.58, end: 1.98 },
  { text: "gamma", start: 2.08, end: 2.48 },
  { text: "delta", start: 2.58, end: 2.98 },
  { text: "is", start: 3.08, end: 3.38 },
  { text: "the", start: 3.48, end: 3.78 },
  { text: "answer", start: 3.88, end: 4.5 },
  { text: "alpha", start: 6.28, end: 6.68 },
  { text: "beta", start: 6.78, end: 7.18 },
  { text: "gamma", start: 7.28, end: 7.68 },
  { text: "delta", start: 7.78, end: 8.18 },
  { text: "is", start: 8.28, end: 8.58 },
  { text: "the", start: 8.68, end: 8.98 },
  { text: "answer", start: 9.08, end: 9.7 },
  { text: "alpha", start: 11.48, end: 11.88 },
  { text: "beta", start: 11.98, end: 12.38 },
  { text: "gamma", start: 12.48, end: 12.88 },
  { text: "delta", start: 12.98, end: 13.38 },
  { text: "alpha", start: 13.78, end: 14.18 },
  { text: "beta", start: 14.28, end: 14.68 },
  { text: "gamma", start: 14.78, end: 15.18 },
  { text: "delta", start: 15.28, end: 15.68 },
  { text: "is", start: 15.78, end: 16.08 },
  { text: "the", start: 16.18, end: 16.48 },
  { text: "answer", start: 16.58, end: 17.05 },
  { text: "epsilon", start: 18.78, end: 19.3 },
  { text: "zeta", start: 19.5, end: 20.1 },
  { text: "eta", start: 20.2, end: 20.6 },
  { text: "theta", start: 23.58, end: 24.1 },
  { text: "iota", start: 24.3, end: 24.9 },
  { text: "kappa", start: 25.1, end: 26.1 },
];

export const FIXTURE_FULL_LINE = "alpha beta gamma delta is the answer";

export const FIXTURE_SCRIPT = [FIXTURE_FULL_LINE, "epsilon zeta eta", "lambda mu nu"].join("\n");

export const FIXTURE_TRUTH = {
  clipCount: 6,
  texts: [
    FIXTURE_FULL_LINE,
    FIXTURE_FULL_LINE,
    "alpha beta gamma delta",
    FIXTURE_FULL_LINE,
    "epsilon zeta eta",
    "theta iota kappa",
  ],
  missingScriptLine: "lambda mu nu",
  extraSpokenLine: "theta iota kappa",
  durationS: FIXTURE_DURATION_S,
};

const CACHE_DIR = path.join(REPO_ROOT, "tmp", "fixture-media");

function sampleAt(t: number): number {
  for (const region of REGIONS) {
    if (t < region.start || t >= region.end) continue;
    if (region.kind === "tone") return Math.round(AMPLITUDE * Math.sin(2 * Math.PI * 440 * t));
    if (region.kind === "decay") {
      const span = Math.max(1e-6, region.end - region.start);
      const gain = 1 - (t - region.start) / span;
      return Math.round(AMPLITUDE * gain * Math.sin(2 * Math.PI * 440 * t));
    }
    const phase = Math.sin(2 * Math.PI * 1800 * t);
    return phase >= 0 ? 6000 : -6000;
  }
  return 0;
}

export function renderWavBytes(): Buffer {
  const count = Math.round(FIXTURE_DURATION_S * FIXTURE_RATE);
  const samples = new Int16Array(count);
  for (let index = 0; index < count; index += 1) samples[index] = sampleAt(index / FIXTURE_RATE);
  const data = Buffer.alloc(44 + samples.byteLength);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples.byteLength, 4);
  data.write("WAVE", 8);
  data.write("fmt ", 12);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(FIXTURE_RATE, 24);
  data.writeUInt32LE(FIXTURE_RATE * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples.byteLength, 40);
  Buffer.from(samples.buffer).copy(data, 44);
  return data;
}

export function ensureFixtureMedia(): { wav: string; mp4: string } {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const wav = path.join(CACHE_DIR, "source.wav");
  const mp4 = path.join(CACHE_DIR, "source.mp4");
  if (!fs.existsSync(wav) || fs.statSync(wav).size < 1000) {
    fs.writeFileSync(wav, renderWavBytes());
  }
  if (!fs.existsSync(mp4) || fs.statSync(mp4).size < 1000) {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `color=c=black:s=160x90:r=1:d=${FIXTURE_DURATION_S}`,
        "-i",
        wav,
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        "-b:a",
        "64k",
        mp4,
      ],
      { stdio: "ignore" },
    );
  }
  return { wav, mp4 };
}

export type FixtureProject = {
  slug: string;
  videoPath: string;
  wavPath: string;
  truth: typeof FIXTURE_TRUTH;
  script: string;
};

async function api(method: string, pathname: string, body?: unknown): Promise<Response> {
  return fetch(`${API}${pathname}`, {
    method,
    headers: { "content-type": "application/json", "x-krayon-actor": "human" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function createFixtureProject(options: { withScript?: boolean; analyze?: boolean } = {}): Promise<FixtureProject> {
  const media = ensureFixtureMedia();
  const requested = `e2e-fix-${Date.now()}`;
  const script = options.withScript ? FIXTURE_SCRIPT : "";
  const created = await api("POST", "/projects", { title: requested, slug: requested, script });
  if (!created.ok) throw new Error(`create project failed: ${created.status} ${await created.text()}`);
  const meta = (await created.json()) as { slug: string };
  if (!meta.slug.startsWith("e2e-")) throw new Error(`Refusing non-test slug ${meta.slug}`);
  const imported = await api("POST", `/projects/${meta.slug}/import`, { path: media.mp4 });
  if (!imported.ok) throw new Error(`import failed: ${imported.status} ${await imported.text()}`);
  const analysis = path.join(REPO_ROOT, "studio", meta.slug, "analysis");
  fs.mkdirSync(analysis, { recursive: true });
  fs.copyFileSync(media.wav, path.join(analysis, "source.wav"));
  fs.writeFileSync(path.join(analysis, "words.json"), JSON.stringify({ words: FIXTURE_WORDS }));
  if (options.analyze) {
    const project = await studioApi.project(meta.slug);
    const analyzed = await api("POST", `/projects/${meta.slug}/analyze`, {
      baseRevision: project.revision,
      pipeline: options.withScript ? "scripted" : "transcript",
    });
    if (!analyzed.ok) {
      const detail = await analyzed.text();
      throw new Error(`analyze failed: ${analyzed.status} ${detail}`);
    }
  }
  return {
    slug: meta.slug,
    videoPath: media.mp4,
    wavPath: path.join(analysis, "source.wav"),
    truth: FIXTURE_TRUTH,
    script,
  };
}

export function deleteProject(slug: string): void {
  removeProjectFolder(slug);
}
