import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { buildBatch, poolId, previewBatch } from "./batch.js";
import { createOrderIntent, hashOrder, orderDigest, parseNettingOrder, parseOrderIntent, parseSignedOrder, signOrder, type NettingOrder } from "./order.js";

const hook = "0x1111111111111111111111111111111111111111" as const;
const router = "0x2222222222222222222222222222222222222222" as const;
const key = {
  currency0: "0x0000000000000000000000000000000000000001",
  currency1: "0x0000000000000000000000000000000000000002",
  fee: 500,
  tickSpacing: 10,
  hooks: hook,
} as const;
const accountA = privateKeyToAccount(`0x${"1".padStart(64, "0")}`);
const accountB = privateKeyToAccount(`0x${"2".padStart(64, "0")}`);

function order(user: `0x${string}`, zeroForOne: boolean, amountIn: bigint, nonce: number): NettingOrder {
  return {
    user,
    poolId: poolId(key),
    zeroForOne,
    amountIn,
    minAmountOut: 0n,
    maxAmmInput: amountIn,
    deadline: 4_000_000_000n,
    nonce: `0x${nonce.toString(16).padStart(64, "0")}`,
  };
}

describe("ILAL Order", () => {
  it("keeps the Hookathon 100/70 commitment", () => {
    const first = order("0x3333333333333333333333333333333333333333", true, 100_000_000n, 1);
    const second = order("0x4444444444444444444444444444444444444444", false, 70_000_000n, 2);
    first.poolId = `0x${"22".repeat(32)}`;
    second.poolId = first.poolId;
    const preview = previewBatch([first, second]);
    expect(preview.batchId).toBe("0x3279cb3136ff7a9bd6fdb9304478401b2e52b3efe9e1a78c9b8eb1464264e025");
    expect(preview.matchedEachSide).toBe(70_000_000n);
    expect(preview.residual0).toBe(30_000_000n);
  });

  it("creates and signs the existing wire format", async () => {
    const intent = createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountA.address, true, 100n, 1) });
    const signed = await signOrder(intent, accountA);
    expect(signed.format).toBe("ilal-netting-order-v1");
    expect(parseSignedOrder(JSON.parse(JSON.stringify(signed)))).toEqual(signed);
    expect(orderDigest(signed)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashOrder(parseNettingOrder(signed.order))).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("builds byte-stable batches from any order input permutation", async () => {
    const first = await signOrder(createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountA.address, true, 100n, 1) }), accountA);
    const second = await signOrder(createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountB.address, false, 70n, 2) }), accountB);
    const a = buildBatch({ chainId: 84532, router, poolKey: key, orders: [first, second] });
    const b = buildBatch({ chainId: 84532, router, poolKey: key, orders: [second, first] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rejects duplicate and one-sided batches", async () => {
    const signed = await signOrder(createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountA.address, true, 100n, 1) }), accountA);
    expect(() => buildBatch({ chainId: 84532, router, poolKey: key, orders: [signed, signed] })).toThrow(/Duplicate order hash/);
  });

  it("accepts ERC-1271 signature bytes without attempting client-side recovery", async () => {
    const signed = await signOrder(createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountA.address, true, 100n, 1) }), accountA);
    const contractWalletOrder = parseSignedOrder({ ...signed, signature: "0x1234" });
    expect(contractWalletOrder.signature).toBe("0x1234");
    expect(parseSignedOrder({ ...signed, signature: "0x" }).signature).toBe("0x");
    expect(() => parseSignedOrder({ ...signed, signature: "0x1" })).toThrow(/even-length/);
  });

  it("enforces domains, integer ranges, and the 2-16 order boundary", async () => {
    const signed = await signOrder(createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountA.address, true, 100n, 1) }), accountA);
    expect(() => parseOrderIntent({ ...createOrderIntent({ domain: { chainId: 84532, verifyingContract: hook }, order: order(accountA.address, true, 100n, 1) }), domain: { name: "other", version: "1", chainId: 84532, verifyingContract: hook } })).toThrow(/EIP-712 domain/);
    expect(() => parseNettingOrder({ ...signed.order, deadline: "-1" })).toThrow(/unsigned decimal/);
    expect(() => buildBatch({ chainId: 84532, router, poolKey: key, orders: [signed] })).toThrow(/2 to 16/);
    expect(() => buildBatch({ chainId: 84532, router, poolKey: key, orders: Array(17).fill(signed) })).toThrow(/2 to 16/);

    const sixteen = await Promise.all(Array.from({ length: 16 }, async (_, index) => {
      const signer = index % 2 === 0 ? accountA : accountB;
      return signOrder(createOrderIntent({
        domain: { chainId: 84532, verifyingContract: hook },
        order: order(signer.address, index % 2 === 0, BigInt(index + 1), index + 1),
      }), signer);
    }));
    expect(buildBatch({ chainId: 84532, router, poolKey: key, orders: sixteen }).orders).toHaveLength(16);

    const mixed = { ...sixteen[0]!, domain: { ...sixteen[0]!.domain, chainId: 1 } };
    expect(() => buildBatch({ chainId: 84532, router, poolKey: key, orders: [mixed, sixteen[1]!] })).toThrow(/batch chainId/);
  });
});
