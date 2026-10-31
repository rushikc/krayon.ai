const checks: Array<[string, string]> = [
  ["Vite frontend", process.env.E2E_BASE_URL ?? "http://localhost:5173"],
  ["Studio backend", "http://127.0.0.1:8789/api/studio/health"],
];

export default async function globalSetup() {
  const down: string[] = [];
  for (const [name, url] of checks) {
    try {
      const res = await fetch(url);
      if (!res.ok && res.status >= 500) down.push(`${name} (${url}) answered ${res.status}`);
    } catch {
      down.push(`${name} (${url}) is not reachable`);
    }
  }
  if (down.length) {
    throw new Error(`Start the dev servers first with \`pnpm dev\`.\n - ${down.join("\n - ")}`);
  }
}
