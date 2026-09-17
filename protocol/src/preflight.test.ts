import { describe, expect, it } from "vitest";
import { keccak256, zeroAddress } from "viem";

import { buildBatch, poolId, type PoolKey } from "./batch.js";
import { preflightBatch } from "./preflight.js";
import { SIGNED_ORDER_FORMAT, type SignedOrderFile } from "./order.js";

const hook = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const poolManager = "0x3333333333333333333333333333333333333333" as const;
const guard = "0x4444444444444444444444444444444444444444" as const;
const key: PoolKey = {
  currency0: "0x0000000000000000000000000000000000000001",
  currency1: "0x0000000000000000000000000000000000000002",
  fee: 500,
  tickSpacing: 10,
  hooks: hook,
};

function signed(index: number, zeroForOne: boolean): SignedOrderFile {
  return {
    format: SIGNED_ORDER_FORMAT,
    domain: { name: "ILAL Institutional Netting", version: "1", chainId: 84532, verifyingContract: hook },
    order: {
      user: zeroForOne ? "0x5555555555555555555555555555555555555555" : "0x6666666666666666666666666666666666666666",
      poolId: poolId(key),
      zeroForOne,
      amountIn: zeroForOne ? "100" : "70",
      minAmountOut: "0",
      maxAmmInput: zeroForOne ? "30" : "0",
      deadline: "1",
      nonce: `0x${index.toString(16).padStart(64, "0")}`,
    },
    // Structurally valid ERC-1271 bytes; the Hook decides validity in eth_call.
    signature: "0x",
  };
}

const batch = buildBatch({ chainId: 84532, router, poolKey: key, orders: [signed(1, true), signed(2, false)] });
const block = { number: 123n, timestamp: 100n, hash: `0x${"ab".repeat(32)}` };

function readContract({ functionName }: { functionName: string }) {
  if (functionName === "poolManager") return poolManager;
  if (functionName === "oracleGuard") return guard;
  if (functionName === "feed0") return "0x7777777777777777777777777777777777777777";
  if (functionName === "feed1") return "0x8888888888888888888888888888888888888888";
  if (functionName === "sequencerUptimeFeed") return zeroAddress;
  if (functionName === "validate") return {
    price0Wad: 1_000_000_000_000_000_000n,
    price1Wad: 1_000_000_000_000_000_000n,
    updatedAt0: 99n,
    updatedAt1: 99n,
    sequencerCheckEnabled: false,
  };
  if (functionName === "nonceUsed") return false;
  return 1_000n;
}

describe("preflight", () => {
  it("returns a protocol rejection for an expired order and on-chain OrderExpired revert", async () => {
    const selector = keccak256(new TextEncoder().encode("OrderExpired()")).slice(0, 10);
    const client = {
      getChainId: async () => 84532,
      getBlock: async () => block,
      readContract: async (request: { functionName: string }) => readContract(request),
      call: async () => { throw Object.assign(new Error("RPC request failed"), {
        name: "RpcRequestError", cause: Object.assign(new Error("execution reverted"), { data: selector, code: 3 }),
      }); },
    };
    const report = await preflightBatch(client, batch);
    expect(report.status).toBe("rejected");
    expect(report.checks.find(check => check.name === "deadline")?.ok).toBe(false);
    expect(report.decodedRevert?.message).toBe("ILAL_ORDER_EXPIRED");
  });

  it("distinguishes transport failure from a protocol rejection", async () => {
    const client = {
      getChainId: async () => 84532,
      getBlock: async () => block,
      readContract: async () => { throw new Error("RPC transport unavailable"); },
    };
    const report = await preflightBatch(client, batch);
    expect(report.status).toBe("rpc-error");
  });
});
