import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { poolId } from "@ilalv3/protocol/batch";

const cli = new URL("../dist/index.js", import.meta.url).pathname;
const keyA = `0x${"1".padStart(64, "0")}`;
const keyB = `0x${"2".padStart(64, "0")}`;
const userA = privateKeyToAccount(keyA).address;
const userB = privateKeyToAccount(keyB).address;
const hook = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";
const token0 = "0x0000000000000000000000000000000000000001";
const token1 = "0x0000000000000000000000000000000000000002";
const pool = poolId({ currency0: token0, currency1: token1, fee: 500, tickSpacing: 10, hooks: hook });

function run(args, env = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", PRIVATE_KEY: "", ...env } });
}

test("institutional CLI creates, signs, and deterministically builds local-first artifacts", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-institutional-"));
  try {
    const intentA = join(dir, "a.intent.json");
    const intentB = join(dir, "b.intent.json");
    const signedA = join(dir, "a.signed.json");
    const signedB = join(dir, "b.signed.json");
    const batchA = join(dir, "batch-a.json");
    const batchB = join(dir, "batch-b.json");
    const create = (user, direction, amount, maxAmm, output, nonce) => run([
      "--json", "order", "create", "--user", user, direction, "--amount-in", amount,
      "--min-amount-out", "0", "--max-amm-input", maxAmm, "--pool", pool, "--hook", hook,
      "--deadline", "4000000000", "--nonce", nonce, "--chain", "84532", "--output", output,
    ]);
    let result = create(userA, "--zero-for-one", "100", "30", intentA, `0x${"01".padStart(64, "0")}`);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    result = create(userB, "--one-for-zero", "70", "0", intentB, `0x${"02".padStart(64, "0")}`);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);

    result = run(["--json", "--unsafe-private-key", "order", "sign", intentA, "--output", signedA], { PRIVATE_KEY: keyA });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).format, "ilal-netting-order-v1");
    assert.match(result.stderr, /testnet-only PRIVATE_KEY/);
    result = run(["--json", "--unsafe-private-key", "order", "sign", intentB, "--output", signedB], { PRIVATE_KEY: keyB });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).format, "ilal-netting-order-v1");

    const build = (orders, output) => run([
      "--json", "batch", "build", "--orders", ...orders, "--router", router, "--hook", hook,
      "--token-a", token0, "--token-b", token1, "--fee", "500", "--tick-spacing", "10", "--chain", "84532", "--output", output,
    ]);
    result = build([signedA, signedB], batchA);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    result = build([signedB, signedA], batchB);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.equal(readFileSync(batchA, "utf8"), readFileSync(batchB, "utf8"));
    assert.equal(JSON.parse(readFileSync(batchA, "utf8")).summary.residual0, "30");
    for (const path of [intentA, intentB, signedA, signedB, batchA, batchB]) assert.equal(statSync(path).mode & 0o777, 0o600);

    const rpcFailureReport = join(dir, "rpc-failure.json");
    result = run(["--json", "batch", "preflight", batchA, "--rpc", "http://127.0.0.1:1", "--output", rpcFailureReport]);
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).status, "rpc-error");
    assert.equal(JSON.parse(readFileSync(rpcFailureReport, "utf8")).status, "rpc-error");
    assert.equal(statSync(rpcFailureReport).mode & 0o777, 0o600);

    result = run(["batch", "build", "--orders", signedA, signedB, "--router", router, "--hook", hook, "--token-a", token0, "--token-b", token1, "--output", batchA]);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /Refusing to overwrite/);

    result = build([signedA, signedA], join(dir, "duplicate.json"));
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /Duplicate order hash/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("institutional commands and machine output are discoverable", () => {
  for (const command of ["order", "batch", "settlement"]) {
    const result = run([command, "--help"]);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  }
  const version = run(["--version"]);
  assert.equal(version.stdout.trim(), "0.5.0-institutional.1");
});
