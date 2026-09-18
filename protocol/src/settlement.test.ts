import { describe, expect, it } from "vitest";

import { inspectSettlement } from "./settlement.js";

const transactionHash = `0x${"11".repeat(32)}` as const;
const canonicalBlockHash = `0x${"22".repeat(32)}` as const;
const otherBlockHash = `0x${"33".repeat(32)}` as const;
const address = "0x1111111111111111111111111111111111111111" as const;

function client(overrides: { transactionBlockNumber?: bigint; transactionBlockHash?: string; receiptBlockHash?: string } = {}) {
  return {
    getChainId: async () => 84532,
    getTransaction: async () => ({
      hash: transactionHash,
      from: address,
      to: address,
      input: "0x12345678",
      blockNumber: overrides.transactionBlockNumber ?? 100n,
      blockHash: overrides.transactionBlockHash ?? canonicalBlockHash,
    }),
    getTransactionReceipt: async () => ({
      status: "success",
      blockNumber: 100n,
      blockHash: overrides.receiptBlockHash ?? canonicalBlockHash,
      logs: [],
    }),
    getBlock: async () => ({ number: 100n, hash: canonicalBlockHash }),
  };
}

describe("settlement canonical block identity", () => {
  it("rejects a receipt whose block hash disagrees with the canonical block", async () => {
    await expect(inspectSettlement(client({ receiptBlockHash: otherBlockHash }), transactionHash))
      .rejects.toThrow(/receipt block hash does not match/);
  });

  it("rejects transaction and receipt block-number disagreement", async () => {
    await expect(inspectSettlement(client({ transactionBlockNumber: 101n }), transactionHash))
      .rejects.toThrow(/block numbers differ/);
  });

  it("rejects a transaction block hash that disagrees with the canonical block", async () => {
    await expect(inspectSettlement(client({ transactionBlockHash: otherBlockHash }), transactionHash))
      .rejects.toThrow(/Transaction block hash does not match/);
  });
});
