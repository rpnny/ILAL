#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { provenance, root, writeJson } from "./common.mjs";

function run(label, args, env) {
  const started = process.hrtime.bigint();
  const result = spawnSync("forge", args, {
    cwd: resolve(root, "contracts"), encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return {
    label, passed: result.status === 0, durationMs: Number(process.hrtime.bigint() - started) / 1e6,
    logTail: `${result.stdout ?? ""}\n${result.stderr ?? ""}`.replace(/\u001b\[[0-9;]*m/g, "").slice(-5000),
  };
}

const invariantRuns = Number(process.env.ILAL_STUDY_INVARIANT_RUNS ?? "6250");
const invariantDepth = Number(process.env.ILAL_STUDY_INVARIANT_DEPTH ?? "16");
const fuzzRuns = Number(process.env.ILAL_STUDY_FUZZ_RUNS ?? "10000");
const invariant = run("100k stateful handler calls", ["test", "--match-contract", "InstitutionalNettingInvariantTest", "-vv"], {
  FOUNDRY_INVARIANT_RUNS: String(invariantRuns), FOUNDRY_INVARIANT_DEPTH: String(invariantDepth),
});
const fuzz = run("10k fixed-seed fuzz cases per property", ["test", "--match-path", "test/InstitutionalNetting.t.sol", "--match-test", "testFuzz_", "-vv"], {
  FOUNDRY_FUZZ_RUNS: String(fuzzRuns), FOUNDRY_FUZZ_SEED: "0x494c414c",
});
const adversarial = run("adversarial boundary regressions", ["test", "--match-path", "test/InstitutionalNetting.t.sol",
  "--match-test", "test_(pegGuard|allowanceAndBalanceRace|permissionlessMalicious|revertsExpired|revertsInvalid|cancelNonce|policyRotation)", "-vv"], {});
const passed = invariant.passed && fuzz.passed && adversarial.passed;
const result = {
  schema: "institutional-study-v1", study: "local", provenance: provenance({ chainId: 31337, forkBlock: null }),
  status: passed ? "COMPLETE" : "ERROR", scenarios: [],
  stress: { invariantRuns, invariantDepth, handlerCalls: invariantRuns * invariantDepth, fuzzRuns,
    suites: [invariant, fuzz, adversarial] },
  gates: [
    { id: "stateful-handler-calls", status: invariant.passed && invariantRuns * invariantDepth >= 100_000 ? "PASS" : "FAIL",
      observed: invariantRuns * invariantDepth, required: 100_000 },
    { id: "fuzz-cases-per-property", status: fuzz.passed && fuzzRuns >= 10_000 ? "PASS" : "FAIL", observed: fuzzRuns, required: 10_000 },
    { id: "adversarial-regressions", status: adversarial.passed ? "PASS" : "FAIL" },
  ],
  findings: [], verdict: passed ? "PASS" : "FAIL",
};
const path = writeJson("stress-study.json", result);
process.stdout.write(`wrote ${path}\n${invariantRuns * invariantDepth} handler calls; ${fuzzRuns} fuzz runs/property\n`);
if (!passed) process.exitCode = 1;
