import assert from "node:assert/strict";
import { test } from "node:test";

import { attestationUidFromBroadcast } from "../dist/commands/deploy.js";
import { waitForAllowance } from "../dist/commands/liquidity.js";
import {
  policyGrantSnapshotIssue,
  readPolicyGrantSnapshotV2,
  waitForPolicyGrant,
} from "../dist/commands/policyV2.js";

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

test("policy grant read-back tolerates bounded RPC propagation delay", async () => {
  let reads = 0;
  const valid = await waitForPolicyGrant(async () => {
    reads += 1;
    return reads >= 3;
  }, { attempts: 5, delayMs: 0 });

  assert.equal(valid, true);
  assert.equal(reads, 3);
});

test("policy grant read-back stops after its configured bound", async () => {
  let reads = 0;
  const valid = await waitForPolicyGrant(async () => {
    reads += 1;
    return false;
  }, { attempts: 4, delayMs: 0 });

  assert.equal(valid, false);
  assert.equal(reads, 4);
});

test("policy and grant reads are pinned to one block snapshot", async () => {
  const calls = [];
  const policy = {
    issuerHash: 1n, schemaHash: 2n, credentialRoot: 3n, jurisdictionRoot: 4n,
    policyHash: 5n, maxGrantTTL: 3600n, revision: 7n, minKycLevel: 2, enabled: true,
  };
  const client = {
    async getBlockNumber(options) {
      assert.equal(options.cacheTime, 0);
      return 1234n;
    },
    async readContract(args) {
      calls.push(args);
      if (args.functionName === "getEligibilityPolicy") return policy;
      if (args.functionName === "isPolicyGrantValid") return true;
      if (args.functionName === "grants") return [5n, 9999999999n, 7n];
      throw new Error(`unexpected call: ${args.functionName}`);
    },
  };

  const snapshot = await readPolicyGrantSnapshotV2(
    client,
    `0x${"11".repeat(20)}`,
    `0x${"22".repeat(20)}`,
    `0x${"33".repeat(32)}`,
    `0x${"44".repeat(20)}`
  );
  assert.equal(snapshot.blockNumber, 1234n);
  assert.equal(snapshot.valid, true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.blockNumber === 1234n));
});

test("stale policy revisions are rejected before broadcast", () => {
  const snapshot = {
    blockNumber: 1235n,
    policy: {
      issuerHash: 1n, schemaHash: 2n, credentialRoot: 3n, jurisdictionRoot: 4n,
      policyHash: 8n, maxGrantTTL: 3600n, revision: 8n, minKycLevel: 2, enabled: true,
    },
    valid: false,
    grant: [5n, 9999999999n, 7n],
  };
  assert.equal(
    policyGrantSnapshotIssue(snapshot, { policyHash: 5n, revision: 7n }),
    "pool policy changed from revision 7 to 8"
  );
});

test("grant snapshots reject mismatched policy commitments", () => {
  const snapshot = {
    blockNumber: 1236n,
    policy: {
      issuerHash: 1n, schemaHash: 2n, credentialRoot: 3n, jurisdictionRoot: 4n,
      policyHash: 9n, maxGrantTTL: 3600n, revision: 9n, minKycLevel: 2, enabled: true,
    },
    valid: false,
    grant: [8n, 9999999999n, 9n],
  };
  assert.equal(policyGrantSnapshotIssue(snapshot), "wallet grant policy hash is stale");
});
