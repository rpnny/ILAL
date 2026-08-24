#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalized, resultsDir, root, sha256, writeJson } from "./common.mjs";

const commands = ["study-local.mjs", "study-fork.mjs", "study-rwa.mjs", "study-tco.mjs", "study-stress.mjs", "study-report.mjs"];
function run(script, env = {}) {
  const result = spawnSync(process.execPath, [resolve(root, "scripts/study", script)], {
    cwd: root, encoding: "utf8", stdio: "inherit", env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const script of commands) run(script);

const files = ["local-study.json", "fork-study.json", "rwa-study.json", "stress-study.json"];
const firstHashes = Object.fromEntries(files.map(name => {
  const value = normalized(JSON.parse(readFileSync(resolve(resultsDir, name), "utf8")));
  return [name, sha256(JSON.stringify(value))];
}));
const deterministicCsv = ["local-economic-matrix.csv", "capacity-frontier.csv", "tco-sensitivity.csv"];
const firstCsvHashes = Object.fromEntries(deterministicCsv.map(name =>
  [name, sha256(readFileSync(resolve(resultsDir, name), "utf8"))]));
const forkBlock = JSON.parse(readFileSync(resolve(resultsDir, "fork-study.json"), "utf8")).provenance.forkBlock;
for (const script of commands.slice(0, 5)) run(script, { ILAL_FORK_BLOCK: String(forkBlock) });
const secondHashes = Object.fromEntries(files.map(name => {
  const value = normalized(JSON.parse(readFileSync(resolve(resultsDir, name), "utf8")));
  return [name, sha256(JSON.stringify(value))];
}));
const secondCsvHashes = Object.fromEntries(deterministicCsv.map(name =>
  [name, sha256(readFileSync(resolve(resultsDir, name), "utf8"))]));
for (const name of files) {
  if (firstHashes[name] !== secondHashes[name]) throw new Error(`normalized reproducibility mismatch: ${name}`);
}
for (const name of deterministicCsv) {
  if (firstCsvHashes[name] !== secondCsvHashes[name]) throw new Error(`CSV reproducibility mismatch: ${name}`);
}
run("study-report.mjs");
writeJson("reproducibility.json", { schema: "ilal-study-reproducibility-v1", status: "PASS", forkBlock,
  normalizedJsonSha256: secondHashes, deterministicCsvSha256: secondCsvHashes });
process.stdout.write(`normalized result hashes reproduced at Base block ${forkBlock}\n`);
