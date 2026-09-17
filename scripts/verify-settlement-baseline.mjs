#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keccak256, toHex } from "viem";

const root = resolve(new URL("..", import.meta.url).pathname);
const json = path => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const fail = message => { throw new Error(message); };
const baseline = json("baseline/institutional-execution-v0.1.json");
const deployment = baseline.deploymentBaseline;
const manifest = json(deployment.manifest);

const tagCommit = execFileSync("git", ["rev-parse", `${baseline.softwareBaseline.tag}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
if (tagCommit !== baseline.softwareBaseline.commit) fail("Signed software baseline tag no longer resolves to the recorded commit.");
const tagObject = execFileSync("git", ["cat-file", "-p", `refs/tags/${baseline.softwareBaseline.tag}`], { cwd: root, encoding: "utf8" });
const tagObjectId = execFileSync("git", ["rev-parse", `refs/tags/${baseline.softwareBaseline.tag}`], { cwd: root, encoding: "utf8" }).trim();
if (tagObjectId !== baseline.softwareBaseline.tagObject) fail("Frozen signed tag object was replaced.");
if (!tagObject.includes("BEGIN SSH SIGNATURE")) fail("Software baseline tag is not the recorded SSH-signed annotated tag.");

if (manifest.chainId !== deployment.chainId || manifest.sourceCommit !== deployment.sourceCommit
  || manifest.sourceTreeHash !== deployment.sourceTreeHash || manifest.sourceVerification?.status !== "exact_match") {
  fail("Chainlink candidate source identity or source verification differs from the frozen baseline.");
}
for (const [name, contract] of Object.entries(deployment.contracts)) {
  if (manifest.contracts?.[name]?.address?.toLowerCase() !== contract.address.toLowerCase()) fail(`${name} address differs from the frozen baseline.`);
}
const golden = deployment.goldenSettlement;
const recorded = manifest.batches?.forward010By007;
if (!recorded || recorded.transactionHash !== golden.transactionHash || recorded.batchId !== golden.batchId
  || recorded.submitted.token0 !== golden.total0 || recorded.submitted.token1 !== golden.total1
  || recorded.residual.token0 !== golden.residual0 || recorded.residual.token1 !== golden.residual1) {
  fail("Golden 100000/70000 settlement evidence differs from the frozen baseline.");
}

const changed = execFileSync("git", ["diff", "--name-only", deployment.sourceCommit, "--", ...baseline.protectedPaths], { cwd: root, encoding: "utf8" }).trim();
if (changed) fail(`Frozen settlement sources changed:\n${changed}\n${baseline.changePolicy}`);

if (process.argv.includes("--artifacts")) {
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const { NETTING_ROUTER_ABI, NETTING_HOOK_ABI, ORACLE_GUARD_ABI } = await import("../protocol/dist/abis.js");
  const normalizeAbi = value => Array.isArray(value) ? value.map(normalizeAbi)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).filter(key => key !== "internalType").sort().map(key => [key, normalizeAbi(value[key])])) : value;
  for (const [name, artifactName, libraryAbi] of [
    ["batchRouter", "InstitutionalBatchRouter", NETTING_ROUTER_ABI],
    ["nettingHook", "InstitutionalNettingHook", NETTING_HOOK_ABI],
    ["oracleGuard", "ChainlinkStablecoinOracleGuard", ORACLE_GUARD_ABI],
  ]) {
    const artifact = json(`contracts/out/${artifactName}.sol/${artifactName}.json`);
    const expected = deployment.contracts[name];
    if (keccak256(artifact.bytecode.object) !== expected.creationBytecodeHash) fail(`${name} creation bytecode drifted.`);
    if (keccak256(toHex(JSON.stringify(canonical(artifact.abi)))) !== expected.abiHash) fail(`${name} ABI drifted.`);
    for (const entry of libraryAbi) {
      const compiled = artifact.abi.find(item => item.type === entry.type && item.name === entry.name);
      if (!compiled || JSON.stringify(normalizeAbi(compiled)) !== JSON.stringify(normalizeAbi(entry))) fail(`Protocol ABI differs from frozen ${name}.${entry.name}.`);
    }
  }
  console.log("compiled creation bytecodes, complete ABIs, and protocol ABI adapters match the frozen baseline");
}

console.log(`settlement baseline verified: ${baseline.softwareBaseline.tag}, ${deployment.sourceCommit}, ${golden.batchId}`);
