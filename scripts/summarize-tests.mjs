#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [input, output = "artifacts/test-summary.json"] = process.argv.slice(2);
if (!input) throw new Error("usage: node scripts/summarize-tests.mjs <verify.log> [output.json]");
const log = readFileSync(input, "utf8").replace(/\u001b\[[0-9;]*m/g, "");
const foundry = log.match(/Ran \d+ test suites[\s\S]*?: (\d+) tests passed, (\d+) failed, (\d+) skipped/);
const cliBlock = log.match(/@ilalv3\/cli@[\s\S]*?ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)[\s\S]*?ℹ skipped (\d+)/);
const fuzzRuns = [...log.matchAll(/\(runs: (\d+),/g)].map(match => Number(match[1]));
if (!foundry || !cliBlock || fuzzRuns.length === 0) throw new Error("could not parse Foundry, CLI, or fuzz evidence");
const summary = {
  generatedAt: new Date().toISOString(),
  foundry: { executed: Number(foundry[1]) + Number(foundry[2]) + Number(foundry[3]), passed: Number(foundry[1]), failed: Number(foundry[2]), skipped: Number(foundry[3]) },
  cli: { executed: Number(cliBlock[1]), passed: Number(cliBlock[2]), failed: Number(cliBlock[3]), skipped: Number(cliBlock[4]) },
  fuzz: { tests: fuzzRuns.length, minimumRuns: Math.min(...fuzzRuns) },
};
writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary));
