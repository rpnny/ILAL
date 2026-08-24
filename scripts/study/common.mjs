import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const root = resolve(new URL("../../", import.meta.url).pathname);
export const resultsDir = resolve(root, "docs/research/results");
export const config = JSON.parse(readFileSync(resolve(root, "docs/research/scenarios.json"), "utf8"));

export function command(file, args, options = {}) {
  return execFileSync(file, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options }).trim();
}

export function toolVersion(file, args = ["--version"]) {
  try { return command(file, args).split("\n")[0]; } catch { return "unavailable"; }
}

export function provenance(extra = {}) {
  let dirty = false;
  try { dirty = command("git", ["status", "--porcelain"]).length > 0; } catch {}
  return {
    commit: process.env.ILAL_STUDY_COMMIT ?? command("git", ["rev-parse", "HEAD"]),
    dirty,
    generatedAt: new Date().toISOString(),
    seed: config.seed,
    toolchain: {
      node: process.version,
      forge: toolVersion("forge"),
      solc: toolVersion("solc"),
      platform: `${process.platform}-${process.arch}`,
    },
    ...extra,
  };
}

export function writeJson(name, value) {
  mkdirSync(resultsDir, { recursive: true });
  const path = resolve(resultsDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

export function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function writeCsv(name, rows, columns) {
  mkdirSync(resultsDir, { recursive: true });
  const path = resolve(resultsDir, name);
  const body = [columns.join(","), ...rows.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\n");
  writeFileSync(path, `${body}\n`);
  return path;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![
      "generatedAt", "durationMs", "durationsMs", "timingsMs", "p50Ms", "p95Ms",
      "observedMs", "observedBytes", "cpuMs", "cpuUserMicros", "cpuSystemMicros",
      "peakRssBytes", "logTail", "forkTestOutput",
    ].includes(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, normalized(item)]));
}
