export type PythonProgress = {
  phase?: string;
  progress?: number;
  message?: string;
};

type WaitOptions = {
  onProgress?: (event: PythonProgress) => void;
};

export async function pythonJson<T>(pythonBase: string, path: string, body: unknown): Promise<T> {
  const response = await fetch(`${pythonBase}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T & { detail?: string }) : ({} as T);
  if (!response.ok) {
    const detail = typeof payload === "object" && payload && "detail" in payload ? String(payload.detail) : text;
    throw new Error(detail || `Python ${path} failed (${response.status})`);
  }
  return payload;
}

export async function waitForPythonJob<T>(pythonBase: string, jobId: string, options: WaitOptions = {}): Promise<T> {
  const response = await fetch(`${pythonBase}/api/audio-studio/progress/${jobId}`);
  if (!response.ok || !response.body) throw new Error(`Cannot read job ${jobId}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | null = null;
  let error: string | null = null;

  const take = (block: string) => {
    const line = block
      .split("\n")
      .map((item) => item.trim())
      .find((item) => item.startsWith("data:"));
    if (!line) return;
    const data = JSON.parse(line.slice(5).trim()) as {
      done?: boolean;
      phase?: string;
      progress?: number;
      message?: string;
      error?: string;
    };
    if (data.done || data.error === "unknown job") return;
    if (data.phase === "complete" && data.message) {
      result = JSON.parse(data.message) as T;
      return;
    }
    if (data.phase === "error") {
      error = data.message ?? "analysis failed";
      return;
    }
    if (data.phase === "cancelled") {
      error = "cancelled";
      return;
    }
    options.onProgress?.({ phase: data.phase, progress: data.progress, message: data.message });
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) take(block);
  }
  if (buffer.trim()) take(buffer);
  if (error) throw new Error(error);
  if (result == null) throw new Error("Python job ended without a result");
  return result;
}

export async function startAndWait<T>(
  pythonBase: string,
  path: string,
  body: unknown,
  onProgress?: WaitOptions["onProgress"],
): Promise<T> {
  const started = await startPythonJob(pythonBase, path, body);
  return waitForPythonJob<T>(pythonBase, started.jobId, { onProgress });
}

export async function startPythonJob(
  pythonBase: string,
  path: string,
  body: unknown,
): Promise<{ jobId: string }> {
  return pythonJson<{ jobId: string }>(pythonBase, path, body);
}

export async function cancelPythonJob(pythonBase: string, jobId: string): Promise<void> {
  await pythonJson(pythonBase, `/api/audio-studio/jobs/${jobId}/cancel`, {}).catch(() => undefined);
}
