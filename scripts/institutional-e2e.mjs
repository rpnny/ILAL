#!/usr/bin/env node
// An isolated, non-forked Anvil exercise of the shipped CLI and frozen contracts.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { concat, createPublicClient, createWalletClient, encodeDeployData, getCreate2Address, http, keccak256, maxUint256, toHex, zeroAddress } from "viem";
import { foundry } from "viem/chains";
import { poolId } from "@ilalv3/protocol";

const root = resolve(new URL("..", import.meta.url).pathname);
const run = promisify(execFile);
const directory = mkdtempSync(join(tmpdir(), "ilal-institutional-e2e-"));
const server = createServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const rpc = `http://127.0.0.1:${port}`;
const anvil = spawn("anvil", ["--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], { stdio: "ignore" });
let startupError;
anvil.on("error", error => { startupError = error; });
const client = createPublicClient({ chain: foundry, transport: http(rpc, { retryCount: 0 }), pollingInterval: 20 });
const wallet = createWalletClient({ chain: foundry, transport: http(rpc, { retryCount: 0 }) });
const artifact = name => JSON.parse(readFileSync(join(root, "contracts/out", `${name}.sol`, `${name}.json`), "utf8"));
const read = (name, address, functionName, args = []) => client.readContract({ address, abi: artifact(name).abi, functionName, args });
async function mined(hash) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  assert.equal(receipt.status, "success", `transaction reverted: ${hash}`);
  return receipt;
}
async function cli(args, expectedCode = 0) {
  try {
    const result = await run(process.execPath, [join(root, "cli/dist/index.js"), ...args], {
      cwd: directory, timeout: 60000,
      // Do not inherit workstation credentials or execution configuration.
      env: { PATH: process.env.PATH, NO_COLOR: "1" },
    });
    assert.equal(expectedCode, 0, "command should have been rejected");
    return result.stdout;
  } catch (error) {
    if (expectedCode === 0) throw new Error(`CLI ${args.slice(0, 3).join(" ")} failed: ${error.stderr ?? error.message}`);
    assert.equal(error.code, expectedCode, error.stderr);
    return error.stdout;
  }
}

try {
  for (let attempt = 0; ; attempt++) {
    if (startupError) throw startupError;
    try { await client.getChainId(); break; }
    catch (error) { if (attempt >= 100) throw error; await delay(50); }
  }
  const [deployer, institutionA, institutionB, executor] = await wallet.getAddresses();
  const deploy = async (name, args = []) => (await mined(await wallet.deployContract({
    account: deployer, abi: artifact(name).abi, bytecode: artifact(name).bytecode.object, args,
  }))).contractAddress;
  const write = async (name, address, functionName, args = [], account = deployer) => mined(await wallet.writeContract({
    account, address, abi: artifact(name).abi, functionName, args,
  }));

  const manager = await deploy("PoolManager", [deployer]);
  const liquidity = await deploy("PoolModifyLiquidityTest", [manager]);
  const router = await deploy("InstitutionalBatchRouter", [manager]);
  const registry = await deploy("PolicyRegistry");
  const issuer = await deploy("MockCNFIssuer");
  const feed0 = await deploy("MockChainlinkAggregator", [8, "USD A", 100000000n]);
  const feed1 = await deploy("MockChainlinkAggregator", [8, "USD B", 100000000n]);
  const guard = await deploy("ChainlinkStablecoinOracleGuard", [feed0, feed1, 90000n, 90000n, 100n, 100n, zeroAddress, 0n]);
  const tokens = [await deploy("MockERC20", ["USD A", "USDA", 6]), await deploy("MockERC20", ["USD B", "USDB", 6])].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const [token0, token1] = tokens;
  const factory = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
  assert.ok(await client.getCode({ address: factory }), "Anvil deterministic deployer missing");
  const initCode = encodeDeployData({ abi: artifact("InstitutionalNettingHook").abi,
    bytecode: artifact("InstitutionalNettingHook").bytecode.object,
    args: [manager, registry, guard, router, token0, token1, 500, 10, 100] });
  const bytecodeHash = keccak256(initCode);
  let hook, salt;
  for (let attempt = 0; attempt < 1000000; attempt++) {
    salt = toHex(attempt, { size: 32 });
    hook = getCreate2Address({ from: factory, salt, bytecodeHash });
    if ((BigInt(hook) & 16383n) === 136n) break;
    if (attempt === 999999) throw new Error("Hook address mining exhausted");
  }
  await mined(await wallet.sendTransaction({ account: deployer, to: factory, data: concat([salt, initCode]) }));
  const key = { currency0: token0, currency1: token1, fee: 500, tickSpacing: 10, hooks: hook };
  const pool = poolId(key);
  await write("PoolManager", manager, "initialize", [key, 79228162514264337593543950336n]);
  for (const token of tokens) {
    await write("MockERC20", token, "mint", [deployer, 10n ** 24n]);
    await write("MockERC20", token, "approve", [liquidity, maxUint256]);
  }
  await write("PoolModifyLiquidityTest", liquidity, "modifyLiquidity", [key,
    { tickLower: -1000, tickUpper: 1000, liquidityDelta: 10n ** 12n, salt: toHex(0, { size: 32 }) }, "0x"]);
  for (const institution of [institutionA, institutionB]) await write("MockCNFIssuer", issuer, "setValid", [institution, true]);
  await write("PolicyRegistry", registry, "setPolicy", [pool, issuer, await read("MockCNFIssuer", issuer, "defaultCredentialType")]);
  await write("MockERC20", token0, "mint", [institutionA, 100000n]);
  await write("MockERC20", token1, "mint", [institutionB, 70000n]);
  await write("MockERC20", token0, "approve", [router, 100000n], institutionA);
  await write("MockERC20", token1, "approve", [router, 70000n], institutionB);
  const deadline = (await client.getBlock()).timestamp + 3600n;
  for (const [label, user, side, amount, maximum, nonce] of [
    ["a", institutionA, "--zero-for-one", "100000", "30000", 1],
    ["b", institutionB, "--one-for-zero", "70000", "0", 2],
  ]) {
    await cli(["--json", "order", "create", "--user", user, side, "--amount-in", amount,
      "--min-amount-out", "0", "--max-amm-input", maximum, "--pool", pool, "--hook", hook,
      "--chain", "31337", "--deadline", String(deadline), "--nonce", toHex(nonce, { size: 32 }), "--output", `${label}.intent.json`]);
    JSON.parse(await cli(["--json", "--rpc-account", user, "order", "sign", `${label}.intent.json`, "--rpc", rpc, "--output", `${label}.signed.json`]));
  }
  await cli(["--json", "batch", "build", "--orders", "b.signed.json", "a.signed.json", "--router", router,
    "--hook", hook, "--token-a", token0, "--token-b", token1, "--chain", "31337", "--output", "batch.json"]);
  const preview = JSON.parse(await cli(["--json", "batch", "preview", "batch.json"]));
  assert.equal(preview.matchedEachSide, "70000");
  assert.equal(preview.residual0, "30000");
  assert.equal(preview.residual1, "0");
  const preflight = JSON.parse(await cli(["--json", "batch", "preflight", "batch.json", "--from", executor, "--rpc", rpc, "--output", "preflight.json"]));
  assert.equal(preflight.status, "executable");
  const receipt = JSON.parse(await cli(["--json", "--rpc-account", executor, "batch", "execute", "batch.json", "--rpc", rpc, "--receipt", "receipt.json"]));
  await cli(["--json", "settlement", "inspect", receipt.transaction.hash, "--chain", "31337", "--rpc", rpc, "--output", "inspected.json"]);
  assert.equal(readFileSync(join(directory, "receipt.json"), "utf8"), readFileSync(join(directory, "inspected.json"), "utf8"));
  assert.equal(receipt.execution.executor.toLowerCase(), executor.toLowerCase());
  assert.equal(receipt.batch.summary.matchedEachSide, "70000");
  for (const token of tokens) for (const address of [router, hook]) assert.equal(await read("MockERC20", token, "balanceOf", [address]), 0n);
  assert.equal(await read("InstitutionalNettingHook", hook, "batchActive"), false);
  for (const [user, nonce] of [[institutionA, 1], [institutionB, 2]]) assert.equal(await read("InstitutionalNettingHook", hook, "nonceUsed", [user, toHex(nonce, { size: 32 })]), true);
  await cli(["batch", "execute", "batch.json", "--rpc", rpc], 2);
  const legacy = await cli(["netting", "batch", "preview", "--orders", "a.signed.json", "b.signed.json"]);
  assert.ok(legacy.includes(receipt.batch.batchId));
  for (const name of ["a.intent.json", "a.signed.json", "batch.json", "preflight.json", "receipt.json", "inspected.json"]) assert.equal(statSync(join(directory, name)).mode & 511, 384);
  console.log("Anvil CLI e2e PASS: create → sign → build → preview → preflight → execute → inspect; 70000/70000 matched, 30000/0 residual; byte-identical receipts, zero inventory, closed context, consumed nonces, replay rejected, legacy preview compatible.");
} finally {
  if (anvil.exitCode === null && anvil.pid) {
    const stopped = once(anvil, "exit");
    anvil.kill("SIGTERM");
    await stopped;
  }
  rmSync(directory, { recursive: true, force: true });
}
