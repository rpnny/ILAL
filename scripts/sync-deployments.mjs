#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const indexPath = resolve(root, "deployments/index.json");
const cliPath = resolve(root, "cli/src/generated/deployments.ts");
const sitePath = resolve(root, "site/deployment-status.json");
const check = process.argv.includes("--check");

const index = JSON.parse(readFileSync(indexPath, "utf8"));
const activePresets = {};
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
    if (!isAddress(manifest.admin) || !isAddress(manifest.treasury)) throw new Error(`${entry.manifest} has invalid admin or treasury.`);
    if (manifest.adminTreasuryShared !== (manifest.admin.toLowerCase() === manifest.treasury.toLowerCase())) throw new Error(`${entry.manifest} adminTreasuryShared is inconsistent.`);
    if (!isHash(manifest.sourceTreeHash) || !isHash(manifest.pool?.poolId) || !manifest.pool?.key) throw new Error(`${entry.manifest} has incomplete source or pool evidence.`);
    if (!manifest.toolchain?.solc || typeof manifest.toolchain.viaIR !== "boolean") throw new Error(`${entry.manifest} has incomplete toolchain evidence.`);
    if (!Array.isArray(manifest.privilegedRoles) || manifest.privilegedRoles.length === 0) throw new Error(`${entry.manifest} has no privilege evidence.`);
    if (manifest.privilegedRoles.some(role => role.deployerRetained !== false)) throw new Error(`${entry.manifest} retains or omits a deployer privilege result.`);
  }
}

for (const [chainId, manifestPath] of Object.entries(index.active ?? {})) {
  const manifest = JSON.parse(readFileSync(resolve(root, "deployments", String(manifestPath)), "utf8"));
  if (manifest.status !== "active") throw new Error(`Active deployment ${manifestPath} is not marked active.`);
  const address = value => typeof value === "string" ? value : value?.address;
  activePresets[chainId] = {
    issuer: address(manifest.contracts.cnfIssuer),
    hook: address(manifest.contracts.complianceHook),
    registry: address(manifest.contracts.policyRegistry),
    router: address(manifest.contracts.router),
    treasury: manifest.treasury,
    tokenA: address(manifest.assets?.tokenA ?? manifest.pool.key.currency0),
    tokenB: address(manifest.assets?.tokenB ?? manifest.pool.key.currency1),
    poolId: manifest.pool.poolId,
    fee: String(manifest.pool.key.fee),
    tickSpacing: String(manifest.pool.key.tickSpacing),
  };
}

const generatedTs = `// Generated from deployments/index.json. Do not edit manually.\n` +
  `export const DEPLOYMENT_INDEX = ${JSON.stringify(index, null, 2)} as const;\n\n` +
  `export const ACTIVE_PRESETS: Record<string, Record<string, string>> = ${JSON.stringify(activePresets, null, 2)};\n`;

const siteStatus = `${JSON.stringify({
  schemaVersion: index.schemaVersion,
  generatedFrom: "deployments/index.json",
  active: index.active,
  deployments: index.deployments,
}, null, 2)}\n`;

for (const [path, expected] of [[cliPath, generatedTs], [sitePath, siteStatus]]) {
  if (check) {
    const actual = readFileSync(path, "utf8");
    if (actual !== expected) throw new Error(`${path} is stale. Run node scripts/sync-deployments.mjs.`);
  } else {
    writeFileSync(path, expected);
  }
}

console.log(check ? "deployment-derived files are current" : "deployment-derived files updated");
