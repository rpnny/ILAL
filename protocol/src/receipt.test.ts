import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters } from "viem";

import { NETTING_ROUTER_ABI } from "./abis.js";
import { buildBatch, encodeBatchExecution } from "./batch.js";
import { buildReceipt, parseReceipt, type ReceiptEvidence, type TransactionEvidence } from "./receipt.js";
import { stringifyProtocolJson } from "./json.js";
import { hashOrder, orderDigest, parseNettingOrder, SIGNED_ORDER_FORMAT, type SignedOrderFile } from "./order.js";

const router = "0x96456C68f25A1Fa6C2F2751183401ac26A732506" as const;
const hook = "0x8d1fA43F848701b2adB105D5c925A9247E600088" as const;
const executor = "0x58B24A10593a50a83E9F74bB1Ff3F98421288797" as const;
const transactionHash = "0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998" as const;
const poolKey = {
  currency0: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  currency1: "0xC4946fEC334f4B9350dF08E311261e4361B7c72C",
  fee: 500,
  tickSpacing: 10,
  hooks: hook,
} as const;

const orders: SignedOrderFile[] = [
  {
    format: SIGNED_ORDER_FORMAT,
    domain: { name: "ILAL Institutional Netting", version: "1", chainId: 84532, verifyingContract: hook },
    order: {
      user: "0x1b869CaC69Df23Ad9D727932496AEb3605538c8D", poolId: "0xeab91a1421cb5c170df74c1eaf676a8836eda1fc5a833f62ab9c2d516acfbc87",
      zeroForOne: true, amountIn: "100000", minAmountOut: "99000", maxAmmInput: "30000", deadline: "1787644513",
      nonce: "0x2925b107d9370fe7c78395c1287cca81b0a372688e24606da07c4c6f71babe30",
    },
    signature: "0x212b21d3c8bbe1b7a8b1f5dcac926d8b32eea2e613c9c65d39f9cd1547b6ef647a837415e372157edc7b4aae36589d53a18389c42704f38cd9a44c3a4eccd1731b",
  },
  {
    format: SIGNED_ORDER_FORMAT,
    domain: { name: "ILAL Institutional Netting", version: "1", chainId: 84532, verifyingContract: hook },
    order: {
      user: "0xC61d6115fcFcbA97Bd44Cb013C877bD0ef868dB3", poolId: "0xeab91a1421cb5c170df74c1eaf676a8836eda1fc5a833f62ab9c2d516acfbc87",
      zeroForOne: false, amountIn: "70000", minAmountOut: "70000", maxAmmInput: "0", deadline: "1787644513",
      nonce: "0x4b1b98f7a598749d5172af1cd18ed389a318636b34932082c20f1fdea680ecd7",
    },
    signature: "0x750efa07a4af90fb8310b537077087f82552cc745d27551aa375c4fcb5d923075eac7ee4be57361f7ec487aa3b3a669b9435e703c010297107e0fca88b3339d21b",
  },
];

function fixture() {
  const batch = buildBatch({ chainId: 84532, router, poolKey, orders });
  const settled = [
    { user: orders[0]!.order.user, zeroForOne: true, amountIn: 100000n, amountOut: 99903n, matchedOutput: 70000n, ammOutput: 29903n },
    { user: orders[1]!.order.user, zeroForOne: false, amountIn: 70000n, amountOut: 70000n, matchedOutput: 70000n, ammOutput: 0n },
  ];
  const logs: ReceiptEvidence["logs"] = settled.map((value, orderIndex) => ({
    address: router,
    topics: encodeEventTopics({ abi: NETTING_ROUTER_ABI, eventName: "OrderSettled", args: { batchId: batch.batchId, orderIndex: BigInt(orderIndex), user: value.user } }),
    data: encodeAbiParameters(parseAbiParameters("bool,uint256,uint256,uint256,uint256"), [value.zeroForOne, value.amountIn, value.amountOut, value.matchedOutput, value.ammOutput]),
  }));
  logs.push({
    address: router,
    topics: encodeEventTopics({ abi: NETTING_ROUTER_ABI, eventName: "BatchExecuted", args: { batchId: batch.batchId, executor } }),
    data: encodeAbiParameters(parseAbiParameters("uint256,uint256,uint256,uint256,uint256,uint256"), [2n, 100000n, 70000n, 70000n, 30000n, 0n]),
  });
  const transaction: TransactionEvidence = { hash: transactionHash, from: executor, to: router, input: encodeBatchExecution(batch) };
  const receipt: ReceiptEvidence = { status: "success", blockNumber: 45934588n, blockHash: "0xf0241b766388e5c2ddcddc930e83db3069deb39a07bc89fb6dfa1143f75596a8", logs };
  return { batch, transaction, receipt };
}

describe("Settlement Receipt", () => {
  it("reconstructs the published 100000/70000 candidate evidence deterministically", () => {
    const input = fixture();
    const first = buildReceipt({ chainId: 84532, transaction: input.transaction, receipt: input.receipt });
    const second = buildReceipt({ chainId: 84532, transaction: input.transaction, receipt: input.receipt });
    expect(first.batch.batchId).toBe("0x6f066658caa8a4631db43789ef361f03f322d8ce0c992e6387d7166bfe86f872");
    expect(hashOrder(parseNettingOrder(orders[0]!.order))).toBe("0xb4e84a79d1c8fe153fd4b9147baf0296a1ad2f229b0a06aa9629799c498695ad");
    expect(orderDigest(orders[0]!)).toBe("0x9a3cb7aac7f91263ef078d04a8a342cbd20a57d3548dad4b083009359e4045f6");
    expect(first.batch.summary.matchedEachSide).toBe("70000");
    expect(first.batch.summary.residual0).toBe("30000");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(parseReceipt(JSON.parse(JSON.stringify(first)))).toEqual(first);
    const wire = stringifyProtocolJson(first);
    expect(parseReceipt(JSON.parse(wire))).toEqual(first);
    expect(wire).not.toMatch(/:\s*-?\d/);
  });

  it("rejects missing events, reverted transactions, and mismatched settlement data", () => {
    const missing = fixture();
    missing.receipt.logs.pop();
    expect(() => buildReceipt({ chainId: 84532, transaction: missing.transaction, receipt: missing.receipt })).toThrow(/BatchExecuted event is missing/);

    const reverted = fixture();
    reverted.receipt.status = "reverted";
    expect(() => buildReceipt({ chainId: 84532, transaction: reverted.transaction, receipt: reverted.receipt })).toThrow(/reverted transaction/);

    const tampered = fixture();
    tampered.receipt.logs[0]!.data = encodeAbiParameters(parseAbiParameters("bool,uint256,uint256,uint256,uint256"), [true, 99999n, 99903n, 70000n, 29903n]);
    expect(() => buildReceipt({ chainId: 84532, transaction: tampered.transaction, receipt: tampered.receipt })).toThrow(/does not match its signed order/);
  });

  it("rejects a wrong Router, non-ILAL calldata, and duplicate events", () => {
    const wrongRouter = fixture();
    wrongRouter.transaction.to = "0x9999999999999999999999999999999999999999";
    expect(() => buildReceipt({ chainId: 84532, transaction: wrongRouter.transaction, receipt: wrongRouter.receipt })).toThrow(/BatchExecuted event is missing/);

    const nonIlal = fixture();
    nonIlal.transaction.input = "0x12345678";
    expect(() => buildReceipt({ chainId: 84532, transaction: nonIlal.transaction, receipt: nonIlal.receipt })).toThrow(/not an ILAL executeBatch/);

    const duplicate = fixture();
    duplicate.receipt.logs.push(duplicate.receipt.logs[0]!);
    expect(() => buildReceipt({ chainId: 84532, transaction: duplicate.transaction, receipt: duplicate.receipt })).toThrow(/Duplicate OrderSettled/);
  });

  it("rejects calldata and event batch commitment disagreement", () => {
    const mismatch = fixture();
    mismatch.receipt.logs[mismatch.receipt.logs.length - 1]!.topics = encodeEventTopics({
      abi: NETTING_ROUTER_ABI,
      eventName: "BatchExecuted",
      args: { batchId: `0x${"ff".repeat(32)}`, executor },
    });
    expect(() => buildReceipt({ chainId: 84532, transaction: mismatch.transaction, receipt: mismatch.receipt })).toThrow(/does not match the calldata commitment/);

    const serialized = buildReceipt({ chainId: 84532, transaction: mismatch.transaction, receipt: fixture().receipt });
    serialized.receiptId = `0x${"00".repeat(32)}`;
    expect(() => parseReceipt(serialized)).toThrow(/Receipt ID/);
  });
});
