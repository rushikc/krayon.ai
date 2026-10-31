import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot } from "./config.js";

export type DoctorCheck = { ok: boolean; hint?: string; detail?: string };

export type DoctorReport = {
  studio: DoctorCheck;
  python: DoctorCheck;
  ffmpeg: DoctorCheck;
  ffprobe: DoctorCheck;
  av: DoctorCheck;
  whisper: DoctorCheck;
};

async function ping(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}

function onPath(name: string): boolean {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  return result.status === 0 && Boolean(result.stdout.trim());
}

export async function runDoctor(env: NodeJS.ProcessEnv = process.env): Promise<DoctorReport> {
  const studioBase = env.KRAYON_STUDIO_URL ?? "http://127.0.0.1:8789";
  const pythonBase = env.KRAYON_STUDIO_PYTHON ?? "http://127.0.0.1:8000";
  const venvPython = path.join(repoRoot, "src/backend/.krayonenv/bin/python");
  const venv = path.join(repoRoot, "src/backend/.krayonenv");

  const studioOk = await ping(`${studioBase}/api/studio/health`);
  const pythonOk = await ping(`${pythonBase}/api/health`);
  const ffmpegOk = onPath("ffmpeg");
  const ffprobeOk = onPath("ffprobe");

  let av: DoctorCheck = { ok: false, hint: `Install the venv at ${venv} (pip install -r src/backend/requirements.txt)` };
  if (existsSync(venvPython)) {
    const result = spawnSync(venvPython, ["-c", "import av; print(av.__version__)"], { encoding: "utf8" });
    if (result.status === 0) {
      const version = result.stdout.trim();
      const major = Number(version.split(".")[0] ?? "99");
      av = major < 17
        ? { ok: true, detail: version }
        : { ok: false, detail: version, hint: "Pin av>=11,<17 and reinstall the Python venv" };
    } else {
      av = { ok: false, hint: "av is missing; reinstall src/backend/.krayonenv" };
    }
  }

  let whisper: DoctorCheck = { ok: false, hint: "Start pnpm backend once so Whisper can download" };
  try {
    const names = existsSync(venv) ? readdirSync(venv) : [];
    const marker = names.find((name) => name.startsWith(".whisper-ready-"));
    if (marker) whisper = { ok: true, detail: marker };
  } catch {
    whisper = { ok: false, hint: "Cannot read the Python venv for a Whisper cache marker" };
  }

  return {
    studio: studioOk ? { ok: true } : { ok: false, hint: "Start pnpm studio-backend (127.0.0.1:8789)" },
    python: pythonOk ? { ok: true } : { ok: false, hint: "Start pnpm backend (127.0.0.1:8000)" },
    ffmpeg: ffmpegOk ? { ok: true } : { ok: false, hint: "Install ffmpeg and put it on PATH" },
    ffprobe: ffprobeOk ? { ok: true } : { ok: false, hint: "Install ffprobe (same package as ffmpeg)" },
    av,
    whisper,
  };
}
