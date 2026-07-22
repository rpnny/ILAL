#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const readJson = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const fail = message => { throw new Error(message); };

const cli = readJson("cli/package.json");
const sdk = readJson("sdk/package.json");
const circuits = readJson("circuits/package.json");
const proving = readJson("proving-artifacts/package.json");
const release = readJson("releases/v0.3.3-rc.1.json");
const deployments = readJson("deployments/index.json");

if (cli.version !== release.version) fail("CLI and RC release versions differ.");
for (const pkg of [cli, sdk, circuits, proving]) {
  if (pkg.license !== "Apache-2.0") fail(`${pkg.name} is not Apache-2.0.`);
  if (!pkg.repository || pkg.repository.url !== "https://github.com/rpnny/ilal" && pkg.repository.url !== "git+https://github.com/rpnny/ilal.git") {
    fail(`${pkg.name} repository metadata does not point to rpnny/ilal.`);
  }
}
if (Object.keys(deployments.active ?? {}).length !== 0) fail("RC must not advertise an active deployment before the Safe deployment gate.");
const legacy = deployments.deployments.find(item => item.version === "0.3.2");
if (!legacy || legacy.status !== "deprecated") fail("Legacy v0.3.2 deployment must remain explicitly deprecated.");
if (release.npmPublication !== "not published") fail("RC plan forbids npm publication.");
if (release.productionReadiness !== "not production-ready" || release.auditStatus !== "unaudited") {
  fail("Release readiness labels are incomplete.");
}
if (release.lastLocalVerification.foundry.passed < release.baselineTests.foundry
  || release.lastLocalVerification.cli.passed < release.baselineTests.cli
  || release.lastLocalVerification.foundry.failed !== 0
  || release.lastLocalVerification.foundry.skipped !== 0
  || release.lastLocalVerification.cli.failed !== 0
  || release.lastLocalVerification.cli.skipped !== 0) {
  fail("Recorded local verification is below baseline or contains failures/skips.");
}

const foundry = readFileSync(resolve(root, "contracts/foundry.toml"), "utf8");
const fuzz = Number(foundry.match(/\[profile\.default\.fuzz\][\s\S]*?runs\s*=\s*(\d+)/)?.[1] ?? 0);
if (fuzz < release.baselineTests.fuzzRuns) fail(`Foundry fuzz runs dropped below ${release.baselineTests.fuzzRuns}.`);

const solidityFiles = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = resolve(directory, entry.name);
  return entry.isDirectory() ? solidityFiles(path) : entry.name.endsWith(".sol") ? [path] : [];
});
for (const file of ["contracts/src", "contracts/script", "contracts/test"].flatMap(path => solidityFiles(resolve(root, path)))) {
  const firstLine = readFileSync(file, "utf8").split(/\r?\n/, 1)[0];
  const generatedGpl = file.endsWith("/contracts/src/verifier/ILALVerifier.sol")
    || file.endsWith("/contracts/src/verifier/ILALPolicyVerifierV2.sol");
  const expected = generatedGpl
    ? "// SPDX-License-Identifier: GPL-3.0"
    : "// SPDX-License-Identifier: Apache-2.0";
  if (firstLine !== expected) fail(`${file} has unexpected SPDX identifier ${firstLine}.`);
}

console.log("release metadata, license policy, fuzz baseline, and deployment status are valid");
