#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { config, provenance, root, writeCsv, writeJson } from "./common.mjs";

const cli = resolve(root, "cli/dist/index.js");
const configuredSizes = process.env.ILAL_STUDY_RWA_SIZES?.split(",").map(Number).filter(Number.isFinite);
const sizes = configuredSizes?.length ? configuredSizes : config.rwa.wallets;
const proofRuns = Number(process.env.ILAL_STUDY_PROOF_RUNS ?? "20");
const workspace = mkdtempSync(join(tmpdir(), "ilal-rwa-study-"));

function wallet(index) { return `0x${(BigInt(index) + 1n).toString(16).padStart(40, "0")}`; }

async function writeDecisions(path, count, status = "approved") {
  const stream = createWriteStream(path, { mode: 0o600 });
  stream.write("wallet,kycLevel,countryCode,expiresAt,status,verificationId\n");
  for (let index = 0; index < count; index += 1) {
    if (!stream.write(`${wallet(index)},3,840,2000000000,${status},synthetic-${index}\n`)) {
      await new Promise(resolveDrain => stream.once("drain", resolveDrain));
    }
  }
  stream.end();
  await finished(stream);
}

function runTimed(args, cwd = workspace) {
  const started = process.hrtime.bigint();
  let command = process.execPath;
  let commandArgs = [cli, ...args];
  if (process.platform === "darwin") {
    command = "/usr/bin/time";
    commandArgs = ["-l", process.execPath, cli, ...args];
  } else if (process.platform === "linux") {
    command = "/usr/bin/time";
    commandArgs = ["-v", process.execPath, cli, ...args];
  }
  const result = spawnSync(command, commandArgs, {
    cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" }, maxBuffer: 64 * 1024 * 1024,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  const stderr = result.stderr ?? "";
  const darwinRss = stderr.match(/(\d+)\s+maximum resident set size/i)?.[1];
  const linuxRss = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/i)?.[1];
  const darwinCpu = stderr.match(/[\d.]+\s+real\s+([\d.]+)\s+user\s+([\d.]+)\s+sys/i);
  const linuxUser = stderr.match(/User time \(seconds\):\s*([\d.]+)/i)?.[1];
  const linuxSystem = stderr.match(/System time \(seconds\):\s*([\d.]+)/i)?.[1];
  const peakRssBytes = darwinRss ? Number(darwinRss) : linuxRss ? Number(linuxRss) * 1024 : null;
  return { status: result.status, durationMs, peakRssBytes,
    cpuUserMs: darwinCpu ? Number(darwinCpu[1]) * 1000 : linuxUser ? Number(linuxUser) * 1000 : null,
    cpuSystemMs: darwinCpu ? Number(darwinCpu[2]) * 1000 : linuxSystem ? Number(linuxSystem) * 1000 : null,
    stdout: result.stdout ?? "", stderr };
}

function requireSuccess(label, measurement) {
  if (measurement.status !== 0) {
    throw new Error(`${label} failed (${measurement.status}):\n${measurement.stdout}\n${measurement.stderr}`);
  }
  return measurement;
}

const scenarios = [];
let largestWitness = null;
try {
  requireSuccess("CLI build", {
    ...(() => {
      const result = spawnSync("npm", ["run", "build"], { cwd: resolve(root, "cli"), encoding: "utf8" });
      return { status: result.status, durationMs: 0, peakRssBytes: null, stdout: result.stdout, stderr: result.stderr };
    })(),
  });
  for (const count of sizes) {
    const dir = join(workspace, String(count));
    const password = join(workspace, "issuer.password");
    writeFileSync(password, "institutional-study-password\n", { mode: 0o600 });
    chmodSync(password, 0o600);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const csv = join(dir, "decisions.csv");
    const store = join(dir, "issuer.enc.json");
    const policy = join(dir, "policy.json");
    const witness = join(dir, "witness.json");
    await writeDecisions(csv, count);
    const init = requireSuccess("issuer init", runTimed([
      "issuer", "tree", "init", "--issuer", "ILAL Synthetic Institution", "--schema", "institutional-kyc-v1",
      "--allow-countries", "840,826,756", "--store", store, "--store-password-file", password,
    ]));
    const imported = requireSuccess(`issuer import ${count}`, runTimed([
      "issuer", "tree", "import", "--file", csv, "--store", store, "--store-password-file", password,
    ]));
    const rootMeasurement = requireSuccess("issuer root", runTimed([
      "issuer", "tree", "root", "--out", policy, "--store", store, "--store-password-file", password,
    ]));
    const witnessMeasurement = requireSuccess("issuer witness", runTimed([
      "issuer", "tree", "export-witness", "--wallet", wallet(0), "--out", witness,
      "--store", store, "--store-password-file", password,
    ]));
    largestWitness = count === Math.max(...sizes) ? witness : largestWitness;
    scenarios.push({
      scenarioId: `rwa-base-${count}`, category: "issuer-base", walletCount: count,
      timingsMs: { init: init.durationMs, importAndRoot: imported.durationMs, root: rootMeasurement.durationMs,
        witness: witnessMeasurement.durationMs, total: init.durationMs + imported.durationMs + rootMeasurement.durationMs + witnessMeasurement.durationMs },
      peakRssBytes: Math.max(...[init, imported, rootMeasurement, witnessMeasurement].map(item => item.peakRssBytes ?? 0)) || null,
      cpuMs: { user: [init, imported, rootMeasurement, witnessMeasurement].reduce((sum, item) => sum + (item.cpuUserMs ?? 0), 0),
        system: [init, imported, rootMeasurement, witnessMeasurement].reduce((sum, item) => sum + (item.cpuSystemMs ?? 0), 0) },
      filesBytes: { csv: statSync(csv).size, encryptedStore: statSync(store).size, policy: statSync(policy).size, witness: statSync(witness).size },
      piiFree: true, status: "COMPLETE",
    });

    for (const churnPercent of config.rwa.monthlyChurnPercent) {
      const churnCount = Math.max(1, Math.floor(count * churnPercent / 100));
      const churnCsv = join(dir, `churn-${churnPercent}.csv`);
      const churnStore = join(dir, `issuer-churn-${churnPercent}.enc.json`);
      await writeDecisions(churnCsv, churnCount, "revoked");
      copyFileSync(store, churnStore);
      chmodSync(churnStore, 0o600);
      const churn = requireSuccess(`issuer churn ${count}/${churnPercent}`, runTimed([
        "issuer", "tree", "import", "--file", churnCsv, "--store", churnStore, "--store-password-file", password,
      ]));
      const churnRoot = requireSuccess(`issuer churn root ${count}/${churnPercent}`, runTimed([
        "issuer", "tree", "root", "--store", churnStore, "--store-password-file", password,
      ]));
      scenarios.push({ scenarioId: `rwa-churn-${count}-${churnPercent}`, category: "issuer-churn",
        walletCount: count, churnPercent, changedWallets: churnCount,
        durationMs: churn.durationMs + churnRoot.durationMs,
        timingsMs: { import: churn.durationMs, root: churnRoot.durationMs },
        peakRssBytes: Math.max(churn.peakRssBytes ?? 0, churnRoot.peakRssBytes ?? 0) || null,
        cpuMs: { user: (churn.cpuUserMs ?? 0) + (churnRoot.cpuUserMs ?? 0),
          system: (churn.cpuSystemMs ?? 0) + (churnRoot.cpuSystemMs ?? 0) },
        encryptedStoreBytes: statSync(churnStore).size, status: "COMPLETE" });
    }
  }

  const proofMeasurements = [];
  const proofPeakRssBytes = [];
  if (largestWitness && proofRuns > 0) {
    for (let index = 0; index < proofRuns; index += 1) {
      const out = join(workspace, `proof-${index}`);
      const proof = runTimed([
        "policy", "proof", "generate", "--input", largestWitness,
        "--circuit-dir", resolve(root, "circuits/build-v2"), "--out-dir", out,
      ], root);
      requireSuccess(`proof ${index + 1}`, proof);
      proofMeasurements.push(proof.durationMs);
      if (proof.peakRssBytes) proofPeakRssBytes.push(proof.peakRssBytes);
    }
  }
  proofMeasurements.sort((a, b) => a - b);
  const percentile = value => proofMeasurements.length
    ? proofMeasurements[Math.min(proofMeasurements.length - 1, Math.ceil(proofMeasurements.length * value) - 1)] : null;
  const largest = scenarios.find(item => item.scenarioId === `rwa-base-${Math.max(...sizes)}`);
  const overallPeakRssBytes = Math.max(largest?.peakRssBytes ?? 0, ...proofPeakRssBytes);
  const gates = [
    { id: "rwa-100k-total-time", status: largest ? (largest.timingsMs.total <= 600_000 ? "PASS" : "FAIL") : "NOT_RUN",
      observedMs: largest?.timingsMs.total ?? null, requiredMaxMs: 600_000 },
    { id: "rwa-100k-peak-rss", status: overallPeakRssBytes ? (overallPeakRssBytes <= 4 * 1024 ** 3 ? "PASS" : "FAIL") : "NOT_RUN",
      observedBytes: overallPeakRssBytes || null, requiredMaxBytes: 4 * 1024 ** 3 },
    { id: "proof-p95", status: proofMeasurements.length === 20 ? (percentile(0.95) <= 30_000 ? "PASS" : "FAIL") : "NOT_RUN",
      observedMs: percentile(0.95), requiredMaxMs: 30_000, runs: proofMeasurements.length },
  ];
  const tcoModel = JSON.parse(readFileSync(resolve(root, "docs/research/tco-model.json"), "utf8"));
  const result = {
    schema: "institutional-study-v1", study: "rwa", provenance: provenance({ chainId: 31337, forkBlock: null }),
    status: sizes.includes(100_000) && proofMeasurements.length === 20 ? "COMPLETE" : "PARTIAL",
    scenarios, proof: { runs: proofMeasurements.length, durationsMs: proofMeasurements,
      p50Ms: percentile(0.5), p95Ms: percentile(0.95), peakRssBytes: proofPeakRssBytes.length ? Math.max(...proofPeakRssBytes) : null },
    negativeCoverage: ["wrong-password", "corrupt-store", "broad-permissions", "duplicate-wallet", "illegal-fields", "expired-record", "revoked-record"],
    tco: { status: "PARAMETERIZED_PENDING_FORK_GAS", model: tcoModel }, gates,
    findings: [], verdict: gates.some(gate => gate.status === "FAIL") ? "FAIL" : "CONDITIONAL",
  };
  const path = writeJson("rwa-study.json", result);
  writeCsv("rwa-operational-metrics.csv", scenarios, ["scenarioId", "category", "walletCount", "churnPercent", "changedWallets", "durationMs", "timingsMs", "cpuMs", "peakRssBytes", "filesBytes", "status"]);
  process.stdout.write(`wrote ${path}\n`);
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
