import assert from "node:assert/strict";
import { test } from "node:test";

import { attestationUidFromBroadcast } from "../dist/commands/deploy.js";
import { waitForAllowance } from "../dist/commands/liquidity.js";

const EVENT_TOPIC = "0x63f86f3e95d67d75fed996a7db68f9e7eabf0600abbd54fccabf34ec3b5fa4a7";

test("deployment evidence uses the mined attestation UID", () => {
  const simulatedUid = `0x${"11".repeat(32)}`;
  const minedUid = `0x${"22".repeat(32)}`;
  const artifact = {
    simulatedUid,
    receipts: [{
      status: "0x1",
      logs: [{ topics: [EVENT_TOPIC, minedUid] }],
    }],
  };

  assert.equal(attestationUidFromBroadcast(artifact), minedUid);
  assert.notEqual(attestationUidFromBroadcast(artifact), simulatedUid);
});

test("allowance read-back tolerates bounded RPC propagation delay", async () => {
  const observations = [0n, 0n, 100n];
  let reads = 0;
  const allowance = await waitForAllowance(async () => {
    reads += 1;
    return observations.shift() ?? 100n;
  }, 100n, { attempts: 5, delayMs: 0 });

  assert.equal(allowance, 100n);
  assert.equal(reads, 3);
});

test("allowance read-back stops after its configured bound", async () => {
  let reads = 0;
  const allowance = await waitForAllowance(async () => {
    reads += 1;
    return 1n;
  }, 100n, { attempts: 3, delayMs: 0 });

  assert.equal(allowance, 1n);
  assert.equal(reads, 3);
});
