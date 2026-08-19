import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { previewNettingOrders } from "../dist/commands/netting.js";

const cli = new URL("../dist/index.js", import.meta.url).pathname;
const hook = "0x1111111111111111111111111111111111111111";
const poolId = `0x${"22".repeat(32)}`;

function order(user, zeroForOne, amountIn, nonce) {
  return {
    user,
    poolId,
    zeroForOne,
    amountIn: BigInt(amountIn),
    minAmountOut: 0n,
    maxAmmInput: BigInt(amountIn),
    deadline: 4_000_000_000n,
    nonce: `0x${nonce.toString(16).padStart(64, "0")}`,
  };
}

function signedFile(value, chainId = 84532) {
  return {
    format: "ilal-netting-order-v1",
    domain: { name: "ILAL Institutional Netting", version: "1", chainId, verifyingContract: hook },
    order: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "bigint" ? item.toString() : item])),
    signature: `0x${"11".repeat(65)}`,
  };
}

test("100/70 preview exposes 140 gross matched and 30 token0 residual", () => {
  const preview = previewNettingOrders([
    order("0x3333333333333333333333333333333333333333", true, 100_000_000, 1),
    order("0x4444444444444444444444444444444444444444", false, 70_000_000, 2),
  ]);
  assert.equal(preview.total0, 100_000_000n);
  assert.equal(preview.total1, 70_000_000n);
  assert.equal(preview.matchedEachSide, 70_000_000n);
  assert.equal(preview.exposureReduction, 140_000_000n);
  assert.equal(preview.residual0, 30_000_000n);
  assert.equal(preview.residual1, 0n);
  assert.equal(preview.batchId, "0x3279cb3136ff7a9bd6fdb9304478401b2e52b3efe9e1a78c9b8eb1464264e025");
});

test("offline batch preview reads signed JSON without any private key", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-netting-"));
  try {
    const first = join(dir, "first.json");
    const second = join(dir, "second.json");
    writeFileSync(first, JSON.stringify(signedFile(order("0x3333333333333333333333333333333333333333", true, 100, 1))));
    writeFileSync(second, JSON.stringify(signedFile(order("0x4444444444444444444444444444444444444444", false, 70, 2))));
    const result = spawnSync(process.execPath, [cli, "netting", "batch", "preview", "--orders", first, second], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, NO_COLOR: "1", PRIVATE_KEY: "" },
      encoding: "utf8",
    });
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /submitted gross:\s+170/);
    assert.match(output, /internally matched gross:\s+140/);
    assert.match(output, /residual token0:\s+30/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("batch preview rejects mixed EIP-712 domains", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-netting-domain-"));
  try {
    const first = join(dir, "first.json");
    const second = join(dir, "second.json");
    writeFileSync(first, JSON.stringify(signedFile(order("0x3333333333333333333333333333333333333333", true, 100, 1))));
    writeFileSync(second, JSON.stringify(signedFile(order("0x4444444444444444444444444444444444444444", false, 70, 2), 1)));
    const result = spawnSync(process.execPath, [cli, "netting", "batch", "preview", "--orders", first, second], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, NO_COLOR: "1" },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /same Hook and chain domain/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("netting commands are discoverable and order signing requires one direction", () => {
  const help = spawnSync(process.execPath, [cli, "netting", "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /order/);
  assert.match(help.stdout, /batch/);
  assert.match(help.stdout, /nonce/);

  const invalid = spawnSync(process.execPath, [
    cli, "netting", "order", "sign", "--amount-in", "1", "--min-amount-out", "1",
    "--max-amm-input", "0", "--output", "order.json",
  ], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1", PRIVATE_KEY: "" } });
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stdout}${invalid.stderr}`, /Choose exactly one direction/);
});
