#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  keccak256,
} from "viem";
import { baseSepolia } from "viem/chains";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(readFileSync(resolve(root, "docs/hookathon/chainlink-candidate-manifest.json"), "utf8"));
const baseline = JSON.parse(readFileSync(resolve(root, "baseline/institutional-execution-v0.1.json"), "utf8"));
const cli = resolve(root, "cli/dist/index.js");

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
];
const ISSUER_ABI = [
  { name: "isValid", type: "function", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "bool" }] },
  { name: "credentialOf", type: "function", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "uint256" }] },
];
const HOOK_ABI = [
  { name: "batchActive", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { name: "nonceUsed", type: "function", stateMutability: "view", inputs: [{ name: "user", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ type: "bool" }] },
];
const ORACLE_ABI = [{
  name: "validate", type: "function", stateMutability: "view", inputs: [],
  outputs: [{ name: "snapshot", type: "tuple", components: [
    { name: "price0Wad", type: "uint256" }, { name: "price1Wad", type: "uint256" },
    { name: "updatedAt0", type: "uint256" }, { name: "updatedAt1", type: "uint256" },
    { name: "sequencerCheckEnabled", type: "bool" },
  ] }],
}];

const signerSpecs = [
  { name: "institutionA", address: manifest.roles.institutionA, keystore: "ILAL_INSTITUTION_A_KEYSTORE", password: "ILAL_INSTITUTION_A_PASSWORD_FILE" },
  { name: "institutionB", address: manifest.roles.institutionB, keystore: "ILAL_INSTITUTION_B_KEYSTORE", password: "ILAL_INSTITUTION_B_PASSWORD_FILE" },
  { name: "executor", address: manifest.roles.solver, keystore: "ILAL_EXECUTOR_KEYSTORE", password: "ILAL_EXECUTOR_PASSWORD_FILE" },
];

function parseArgs(argv) {
  const result = { execute: false, rpc: process.env.ILAL_ACCEPTANCE_RPC ?? "https://sepolia.base.org", output: undefined, outputDir: undefined, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--execute") result.execute = true;
    else if (arg === "--check") result.execute = false;
    else if (arg === "--force") result.force = true;
    else if (arg === "--rpc") result.rpc = argv[++i];
    else if (arg === "--output") result.output = argv[++i];
    else if (arg === "--output-dir") result.outputDir = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: node scripts/base-sepolia-institutional-acceptance.mjs [--check] [--rpc URL] [--output FILE]\n       node scripts/base-sepolia-institutional-acceptance.mjs --execute --output-dir DIR [--rpc URL] [--force]\n");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!result.rpc) throw new Error("--rpc requires a URL");
  if (result.execute && !result.outputDir) throw new Error("--execute requires --output-dir");
  return result;
}

function safeRpc(rpc) {
  const url = new URL(rpc);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("RPC URL must use http or https");
  return { origin: url.origin, transportUrl: rpc };
}

function keystoreAddress(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  const raw = typeof parsed.address === "string" ? parsed.address : "";
  const address = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!isAddress(address)) throw new Error(`Keystore has no valid address metadata: ${path}`);
  return getAddress(address);
}

function signerReadiness(spec) {
  const keystorePath = process.env[spec.keystore];
  const passwordPath = process.env[spec.password];
  const errors = [];
  let address = null;
  if (!keystorePath) errors.push(`${spec.keystore} is not configured`);
  else if (!existsSync(keystorePath)) errors.push(`${spec.keystore} does not exist`);
  else {
    try {
      address = keystoreAddress(keystorePath);
      if (address.toLowerCase() !== spec.address.toLowerCase()) errors.push(`${spec.name} keystore address does not match the frozen manifest`);
    } catch (error) { errors.push(error.message); }
  }
  if (!passwordPath) errors.push(`${spec.password} is not configured`);
  else if (!existsSync(passwordPath)) errors.push(`${spec.password} does not exist`);
  else if ((statSync(passwordPath).mode & 0o077) !== 0) errors.push(`${spec.password} must have mode 0600`);
  return {
    role: spec.name,
    expectedAddress: getAddress(spec.address),
    configuredAddress: address,
    keystoreConfigured: Boolean(keystorePath),
    passwordFileConfigured: Boolean(passwordPath),
    valid: errors.length === 0,
    errors,
  };
}

async function buildReadiness(rpcOrigin, transportUrl) {
  const client = createPublicClient({ chain: baseSepolia, transport: http(transportUrl) });
  const chainId = await client.getChainId();
  if (chainId !== baseSepolia.id) throw new Error(`RPC chain mismatch: expected ${baseSepolia.id}, got ${chainId}`);
  const block = await client.getBlock({ blockTag: "latest" });
  const router = getAddress(manifest.contracts.batchRouter.address);
  const hook = getAddress(manifest.contracts.nettingHook.address);
  const guard = getAddress(manifest.contracts.oracleGuard.address);
  const issuer = getAddress(manifest.contracts.cnfIssuer.address);
  const token0 = getAddress(manifest.assets.token0.address);
  const token1 = getAddress(manifest.assets.token1.address);
  const institutionA = getAddress(manifest.roles.institutionA);
  const institutionB = getAddress(manifest.roles.institutionB);
  const executor = getAddress(manifest.roles.solver);
  const at = { blockNumber: block.number };
  const [
    codeRouter, codeHook, codeGuard,
    balanceA, allowanceA, credentialA, credentialIdA,
    balanceB, allowanceB, credentialB, credentialIdB,
    executorBalance, batchActive, oracle,
    router0, router1, hook0, hook1,
  ] = await Promise.all([
    client.getCode({ address: router, ...at }), client.getCode({ address: hook, ...at }), client.getCode({ address: guard, ...at }),
    client.readContract({ address: token0, abi: ERC20_ABI, functionName: "balanceOf", args: [institutionA], ...at }),
    client.readContract({ address: token0, abi: ERC20_ABI, functionName: "allowance", args: [institutionA, router], ...at }),
    client.readContract({ address: issuer, abi: ISSUER_ABI, functionName: "isValid", args: [institutionA], ...at }),
    client.readContract({ address: issuer, abi: ISSUER_ABI, functionName: "credentialOf", args: [institutionA], ...at }),
    client.readContract({ address: token1, abi: ERC20_ABI, functionName: "balanceOf", args: [institutionB], ...at }),
    client.readContract({ address: token1, abi: ERC20_ABI, functionName: "allowance", args: [institutionB, router], ...at }),
    client.readContract({ address: issuer, abi: ISSUER_ABI, functionName: "isValid", args: [institutionB], ...at }),
    client.readContract({ address: issuer, abi: ISSUER_ABI, functionName: "credentialOf", args: [institutionB], ...at }),
    client.getBalance({ address: executor, ...at }),
    client.readContract({ address: hook, abi: HOOK_ABI, functionName: "batchActive", ...at }),
    client.readContract({ address: guard, abi: ORACLE_ABI, functionName: "validate", ...at }),
    client.readContract({ address: token0, abi: ERC20_ABI, functionName: "balanceOf", args: [router], ...at }),
    client.readContract({ address: token1, abi: ERC20_ABI, functionName: "balanceOf", args: [router], ...at }),
    client.readContract({ address: token0, abi: ERC20_ABI, functionName: "balanceOf", args: [hook], ...at }),
    client.readContract({ address: token1, abi: ERC20_ABI, functionName: "balanceOf", args: [hook], ...at }),
  ]);
  const requiredA = 100000n;
  const requiredB = 70000n;
  const code = [
    ["batchRouter", codeRouter], ["nettingHook", codeHook], ["oracleGuard", codeGuard],
  ].map(([name, bytecode]) => ({
    name,
    address: getAddress(baseline.deploymentBaseline.contracts[name].address),
    runtimeBytecodeHash: keccak256(bytecode),
    expectedRuntimeBytecodeHash: baseline.deploymentBaseline.contracts[name].runtimeBytecodeHash,
    matches: keccak256(bytecode).toLowerCase() === baseline.deploymentBaseline.contracts[name].runtimeBytecodeHash.toLowerCase(),
  }));
  const signers = signerSpecs.map(signerReadiness);
  const blockers = [];
  for (const contract of code) if (!contract.matches) blockers.push(`${contract.name} runtime bytecode differs from the frozen baseline`);
  if (balanceA < requiredA) blockers.push(`institutionA needs ${requiredA - balanceA} additional raw USDC`);
  if (allowanceA < requiredA) blockers.push(`institutionA allowance is short by ${requiredA - allowanceA} raw USDC`);
  if (!credentialA) blockers.push("institutionA credential is invalid");
  if (balanceB < requiredB) blockers.push(`institutionB needs ${requiredB - balanceB} additional raw hUSDT`);
  if (allowanceB < requiredB) blockers.push(`institutionB allowance is short by ${requiredB - allowanceB} raw hUSDT`);
  if (!credentialB) blockers.push("institutionB credential is invalid");
  if (executorBalance === 0n) blockers.push("executor has no native gas balance");
  if (batchActive) blockers.push("Hook batch context is already active");
  if ([router0, router1, hook0, hook1].some(value => value !== 0n)) blockers.push("Router or Hook has pre-existing token inventory");
  for (const signer of signers) for (const error of signer.errors) blockers.push(error);
  return {
    format: "ilal-base-sepolia-acceptance-readiness-v1",
    checkedAt: new Date().toISOString(),
    network: { chainId: String(chainId), name: "base-sepolia", rpcOrigin },
    snapshot: { blockNumber: String(block.number), blockHash: block.hash, timestamp: String(block.timestamp) },
    networkPolicy: { allowedOrigins: [rpcOrigin], ilalOperatedEndpointsUsedByHarness: false },
    contracts: code,
    oracle: {
      status: "valid", price0Wad: String(oracle.price0Wad), price1Wad: String(oracle.price1Wad),
      updatedAt0: String(oracle.updatedAt0), updatedAt1: String(oracle.updatedAt1), sequencerCheckEnabled: oracle.sequencerCheckEnabled,
    },
    institutions: {
      institutionA: { address: institutionA, asset: "USDC", required: String(requiredA), balance: String(balanceA), allowance: String(allowanceA), credentialValid: credentialA, credentialId: String(credentialIdA) },
      institutionB: { address: institutionB, asset: "hUSDT", required: String(requiredB), balance: String(balanceB), allowance: String(allowanceB), credentialValid: credentialB, credentialId: String(credentialIdB) },
    },
    executor: { address: executor, nativeBalanceWei: String(executorBalance) },
    preconditions: { batchActive, routerInventory: { token0: String(router0), token1: String(router1) }, hookInventory: { token0: String(hook0), token1: String(hook1) } },
    signers,
    ready: blockers.length === 0,
    blockers,
  };
}

function atomicWrite(path, value, force = false) {
  const target = resolve(path);
  if (existsSync(target) && !force) throw new Error(`Refusing to overwrite ${target}; pass --force`);
  const temporary = `${target}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    if (force) renameSync(temporary, target);
    else { linkSync(temporary, target); unlinkSync(temporary); }
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function runCli(args, rpc, capture = false) {
  const child = spawnSync(process.execPath, [cli, "--json", ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", ILAL_RPC: rpc },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (child.status !== 0) {
    const safeArgs = [];
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] === "--password-file") { safeArgs.push("--password-file", "<redacted-path>"); index += 1; }
      else safeArgs.push(args[index]);
    }
    throw new Error(`CLI command failed (${child.status}): ilal ${safeArgs.join(" ")}${child.stderr ? `\n${child.stderr.trim()}` : ""}`);
  }
  return capture ? JSON.parse(child.stdout) : null;
}

async function verifySecrets() {
  const { loadKeystoreAccount } = await import("../cli/dist/signer.js");
  for (const spec of signerSpecs) {
    const account = await loadKeystoreAccount(process.env[spec.keystore], process.env[spec.password]);
    if (account.address.toLowerCase() !== spec.address.toLowerCase()) throw new Error(`${spec.name} decrypted address does not match the frozen manifest`);
  }
}

async function executeAcceptance(readiness, rpc, outputDir, force) {
  if (!readiness.ready) throw Object.assign(new Error(`Acceptance is not ready: ${readiness.blockers.join("; ")}`), { exitCode: 2 });
  if (!existsSync(cli)) throw new Error("CLI is not built; run npm run build first");
  await verifySecrets();
  const dir = resolve(outputDir);
  if (existsSync(dir) && !force) throw new Error(`Output directory already exists: ${dir}; pass --force to use it`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const p = name => resolve(dir, name);
  const common = ["--pool", manifest.pool.poolId, "--hook", manifest.contracts.nettingHook.address, "--chain", String(manifest.chainId)];
  const global = force ? ["--force"] : [];
  runCli([...global, "order", "create", "--user", manifest.roles.institutionA, "--zero-for-one", "--amount-in", "100000", "--min-amount-out", "99000", "--max-amm-input", "30000", "--ttl", "1800", ...common, "--output", p("order-a.intent.json")], rpc);
  runCli([...global, "--keystore", process.env.ILAL_INSTITUTION_A_KEYSTORE, "--password-file", process.env.ILAL_INSTITUTION_A_PASSWORD_FILE, "order", "sign", p("order-a.intent.json"), "--output", p("order-a.signed.json")], rpc);
  runCli([...global, "order", "create", "--user", manifest.roles.institutionB, "--one-for-zero", "--amount-in", "70000", "--min-amount-out", "70000", "--max-amm-input", "0", "--ttl", "1800", ...common, "--output", p("order-b.intent.json")], rpc);
  runCli([...global, "--keystore", process.env.ILAL_INSTITUTION_B_KEYSTORE, "--password-file", process.env.ILAL_INSTITUTION_B_PASSWORD_FILE, "order", "sign", p("order-b.intent.json"), "--output", p("order-b.signed.json")], rpc);
  runCli([...global, "batch", "build", "--orders", p("order-a.signed.json"), p("order-b.signed.json"), "--router", manifest.contracts.batchRouter.address, "--hook", manifest.contracts.nettingHook.address, "--token-a", manifest.assets.token0.address, "--token-b", manifest.assets.token1.address, "--fee", String(manifest.pool.fee), "--tick-spacing", String(manifest.pool.tickSpacing), "--chain", String(manifest.chainId), "--output", p("batch.json")], rpc);
  const preview = runCli([...global, "batch", "preview", p("batch.json")], rpc, true);
  runCli([...global, "batch", "preflight", p("batch.json"), "--from", manifest.roles.solver, "--output", p("preflight.json")], rpc);
  runCli([...global, "--keystore", process.env.ILAL_EXECUTOR_KEYSTORE, "--password-file", process.env.ILAL_EXECUTOR_PASSWORD_FILE, "batch", "execute", p("batch.json"), "--receipt", p("receipt.json")], rpc);
  const receipt = JSON.parse(readFileSync(p("receipt.json"), "utf8"));
  runCli([...global, "settlement", "inspect", receipt.transaction.hash, "--chain", String(manifest.chainId), "--output", p("inspected-receipt.json")], rpc);
  if (readFileSync(p("receipt.json"), "utf8") !== readFileSync(p("inspected-receipt.json"), "utf8")) throw new Error("execute and inspect receipts are not byte-identical");
  if (preview.matchedEachSide !== "70000" || preview.residual0 !== "30000" || preview.residual1 !== "0") throw new Error("Batch preview does not match the 100000/70000 acceptance scenario");

  const after = await buildReadiness(new URL(rpc).origin, rpc);
  const nonces = receipt.orders.map(entry => entry.signedOrder.order.nonce);
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const nonceConsumed = await Promise.all(receipt.orders.map((entry, index) => client.readContract({ address: manifest.contracts.nettingHook.address, abi: HOOK_ABI, functionName: "nonceUsed", args: [entry.signedOrder.order.user, nonces[index]] })));
  const postconditions = {
    receiptByteIdentical: true,
    batchContextClosed: after.preconditions.batchActive === false,
    routerInventoryZero: Object.values(after.preconditions.routerInventory).every(value => value === "0"),
    hookInventoryZero: Object.values(after.preconditions.hookInventory).every(value => value === "0"),
    allNoncesConsumed: nonceConsumed.every(Boolean),
  };
  if (!Object.values(postconditions).every(Boolean)) throw new Error(`Settlement postcondition failed: ${JSON.stringify(postconditions)}`);
  const report = {
    format: "ilal-base-sepolia-acceptance-result-v1",
    networkPolicy: readiness.networkPolicy,
    transactionHash: receipt.transaction.hash,
    batchId: receipt.batch.batchId,
    summary: receipt.batch.summary,
    postconditions,
    artifacts: ["order-a.intent.json", "order-a.signed.json", "order-b.intent.json", "order-b.signed.json", "batch.json", "preflight.json", "receipt.json", "inspected-receipt.json"],
    status: "accepted",
  };
  atomicWrite(p("acceptance-result.json"), report, force);
  return report;
}

let activeOptions;
let activeRpcOrigin;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  activeOptions = options;
  for (const spec of signerSpecs) {
    if (process.env[spec.keystore]) process.env[spec.keystore] = resolve(process.env[spec.keystore]);
    if (process.env[spec.password]) process.env[spec.password] = resolve(process.env[spec.password]);
  }
  const rpc = safeRpc(options.rpc);
  activeRpcOrigin = rpc.origin;
  const readiness = await buildReadiness(rpc.origin, rpc.transportUrl);
  if (options.output) atomicWrite(options.output, readiness, options.force);
  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);
    process.exitCode = readiness.ready ? 0 : 2;
    return;
  }
  const result = await executeAcceptance(readiness, rpc.transportUrl, options.outputDir, options.force);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
  const message = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0];
  if (activeOptions && !activeOptions.execute) {
    const report = {
      format: "ilal-base-sepolia-acceptance-readiness-v1",
      checkedAt: new Date().toISOString(),
      network: { chainId: String(baseSepolia.id), name: "base-sepolia", rpcOrigin: activeRpcOrigin ?? null },
      networkPolicy: { allowedOrigins: activeRpcOrigin ? [activeRpcOrigin] : [], ilalOperatedEndpointsUsedByHarness: false },
      ready: false,
      blockers: [`RPC readiness check failed: ${message}`],
    };
    try {
      if (activeOptions.output) atomicWrite(activeOptions.output, report, activeOptions.force);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } catch (writeError) {
      process.stderr.write(`Acceptance error: ${writeError instanceof Error ? writeError.message : String(writeError)}\n`);
    }
  } else process.stderr.write(`Acceptance error: ${message}\n`);
  process.exitCode = error?.exitCode ?? 1;
});
