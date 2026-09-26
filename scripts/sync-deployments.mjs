#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "deployments/index.json");
const sitePath = resolve(root, "site/deployment-status.json");
const check = process.argv.includes("--check");

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const protocol = JSON.parse(readFileSync(resolve(root, "protocol.json"), "utf8"));
const isAddress = value => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
const isCommit = value => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const isHash = value => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

for (const entry of index.deployments ?? []) {
  const manifest = JSON.parse(readFileSync(resolve(root, "deployments", entry.manifest), "utf8"));
  if (manifest.version !== entry.version || manifest.network !== entry.network || manifest.chainId !== entry.chainId || manifest.status !== entry.status) {
    throw new Error(`Deployment index metadata differs from ${entry.manifest}.`);
  }
  if (!manifest.contracts || !manifest.features || !manifest.releaseStatus) throw new Error(`${entry.manifest} is missing common manifest sections.`);
  if (manifest.status === "candidate" || manifest.status === "active") {
    if (!isCommit(manifest.sourceCommit) || !(manifest.releaseCommit === null || isCommit(manifest.releaseCommit)) || !isAddress(manifest.deployer)) throw new Error(`${entry.manifest} has incomplete commit/deployer evidence.`);
    if (!isAddress(manifest.admin) || !(manifest.treasury === null || isAddress(manifest.treasury))) throw new Error(`${entry.manifest} has invalid admin or treasury.`);
    if (manifest.adminTreasuryShared !== (manifest.treasury !== null && manifest.admin.toLowerCase() === manifest.treasury.toLowerCase())) throw new Error(`${entry.manifest} adminTreasuryShared is inconsistent.`);
    if (!isHash(manifest.sourceTreeHash) || !isHash(manifest.pool?.poolId) || !manifest.pool?.key) throw new Error(`${entry.manifest} has incomplete source or pool evidence.`);
    if (!manifest.toolchain?.solc || typeof manifest.toolchain.viaIR !== "boolean") throw new Error(`${entry.manifest} has incomplete toolchain evidence.`);
    if (!Array.isArray(manifest.privilegedRoles) || manifest.privilegedRoles.length === 0) throw new Error(`${entry.manifest} has no privilege evidence.`);
    const deployerRetained = manifest.privilegedRoles.some(role => role.deployerRetained !== false);
    if (manifest.status === "active" && deployerRetained) {
      throw new Error(`${entry.manifest} retains or omits a deployer privilege result.`);
    }
    if (manifest.status === "candidate" && deployerRetained && !/testnet poc only/i.test(manifest.features.productionReadiness ?? "")) {
      throw new Error(`${entry.manifest} retains deployer privilege without an explicit testnet PoC classification.`);
    }
  }
}

for (const manifestPath of Object.values(index.active ?? {})) {
  const manifest = JSON.parse(readFileSync(resolve(root, "deployments", String(manifestPath)), "utf8"));
  if (manifest.status !== "active") throw new Error(`Active deployment ${manifestPath} is not marked active.`);
}

const current = JSON.parse(readFileSync(resolve(root, protocol.deploymentManifest), "utf8"));
if (current.format !== "ilal-mixed-deployment-v1" || current.status !== "candidate"
  || !index.deployments.some(entry => `deployments/${entry.manifest}` === protocol.deploymentManifest)) {
  throw new Error("Current ILAL implementation must reference a recorded unified-protocol candidate.");
}

const siteStatus = `${JSON.stringify({
  schemaVersion: index.schemaVersion,
  generatedFrom: ["protocol.json", "deployments/index.json"],
  current: { implementation: protocol.implementation, manifest: protocol.deploymentManifest, status: current.status },
  historicalActive: index.active,
  deployments: index.deployments,
}, null, 2)}\n`;

for (const [path, expected] of [[sitePath, siteStatus]]) {
  if (check) {
    const actual = readFileSync(path, "utf8");
    if (actual !== expected) throw new Error(`${path} is stale. Run node scripts/sync-deployments.mjs.`);
  } else {
    writeFileSync(path, expected);
  }
}

console.log(check ? "deployment-derived files are current" : "deployment-derived files updated");
