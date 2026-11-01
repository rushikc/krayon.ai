#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "tmp", "coverage");
fs.mkdirSync(outDir, { recursive: true });

function run(command, cwd = root) {
  execSync(command, { cwd, stdio: "inherit", env: process.env });
}

run("pnpm exec vitest run --coverage");
run("pnpm exec vitest run --coverage", path.join(root, "src/studio-backend"));
run(
  "bash -lc 'source .krayonenv/bin/activate && pip install -q -r requirements.txt && python -m pytest tests -q --cov=app --cov-report=term --cov-report=html:../../tmp/coverage/python --cov-report=json:../../tmp/coverage/python.json'",
  path.join(root, "src/backend"),
);

function tableFromVitest(summaryPath, title) {
  if (!fs.existsSync(summaryPath)) return `## ${title}\n\nmissing ${summaryPath}\n`;
  const data = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  const rows = Object.entries(data)
    .filter(([file]) => file !== "total")
    .map(([file, stats]) => {
      const pct = stats.lines?.pct ?? stats.statements?.pct ?? 0;
      return `| ${file} | ${pct}% |`;
    });
  const total = data.total?.lines?.pct ?? data.total?.statements?.pct ?? "?";
  return `## ${title}\n\nTotal lines: ${total}%\n\n| File | Lines |\n| --- | --- |\n${rows.join("\n")}\n`;
}

function tableFromPytest(jsonPath) {
  if (!fs.existsSync(jsonPath)) return `## Python\n\nmissing ${jsonPath}\n`;
  const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  const files = data.files ?? {};
  const rows = Object.entries(files).map(([file, stats]) => `| ${file} | ${stats.summary?.percent_covered?.toFixed?.(1) ?? stats.summary?.percent_covered}% |`);
  const total = data.totals?.percent_covered ?? "?";
  return `## Python\n\nTotal lines: ${total}%\n\n| File | Lines |\n| --- | --- |\n${rows.join("\n")}\n`;
}

const summary = [
  "# Coverage",
  "",
  tableFromVitest(path.join(outDir, "frontend", "coverage-summary.json"), "Frontend Vitest"),
  tableFromVitest(path.join(outDir, "studio", "coverage-summary.json"), "Studio Fastify"),
  tableFromPytest(path.join(outDir, "python.json")),
].join("\n");

fs.writeFileSync(path.join(root, "tmp", "coverage-summary.md"), summary);
console.log("Wrote tmp/coverage-summary.md");
