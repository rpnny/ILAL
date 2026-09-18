import {
  concat,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { NETTING_ROUTER_ABI } from "./abis.js";
import { buildBatch, parseBatch, type ILALBatch, type PoolKey } from "./batch.js";
import { ProtocolValidationError } from "./errors.js";
import { hashOrder, parseNettingOrder, parseSignedOrder, SIGNED_ORDER_FORMAT, type SignedOrderFile } from "./order.js";

export const SETTLEMENT_RECEIPT_FORMAT = "ilal-settlement-receipt-v1" as const;
const ZERO_HASH = `0x${"00".repeat(32)}`;

export interface SettlementReceiptOrder {
  orderIndex: number;
  orderHash: Hex;
  signedOrder: SignedOrderFile;
  settlement: { amountIn: string; amountOut: string; matchedOutput: string; ammOutput: string };
}

export interface SettlementReceipt {
  format: typeof SETTLEMENT_RECEIPT_FORMAT;
  receiptId: Hex;
  chainId: number;
  transaction: { hash: Hex; blockNumber: string; blockHash: Hex; from: Address; to: Address; status: "success" };
  execution: { router: Address; hook: Address; poolKey: PoolKey; executor: Address };
  batch: ILALBatch;
  orders: SettlementReceiptOrder[];
  verification: {
    calldataDecoded: true;
    transactionTargetMatchesRouter: true;
    batchIdRecomputed: true;
    batchEventMatches: true;
    orderEventsComplete: true;
  };
}

export interface TransactionEvidence {
  hash: Hex;
  from: Address;
  to: Address | null;
  input?: Hex;
  data?: Hex;
}

export interface ReceiptEvidence {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
  logs: Array<{ address: Address; data: Hex; topics: readonly Hex[] }>;
}

function equal(a: unknown, b: unknown): boolean {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function buildReceipt(input: { chainId: number; transaction: TransactionEvidence; receipt: ReceiptEvidence }): SettlementReceipt {
  if (input.receipt.status !== "success") throw new ProtocolValidationError("Cannot create a successful Settlement Receipt for a reverted transaction.");
  if (input.receipt.blockHash.toLowerCase() === ZERO_HASH) throw new ProtocolValidationError("Settlement Receipt requires a canonical non-zero block hash.");
  if (!input.transaction.to) throw new ProtocolValidationError("Settlement transaction has no target contract.");
  const calldata = input.transaction.input ?? input.transaction.data;
  if (!calldata) throw new Error("Settlement transaction calldata is unavailable.");
  let decoded: ReturnType<typeof decodeFunctionData<typeof NETTING_ROUTER_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: NETTING_ROUTER_ABI, data: calldata });
  } catch {
    throw new ProtocolValidationError("Transaction calldata is not an ILAL executeBatch call.");
  }
  if (decoded.functionName !== "executeBatch") throw new ProtocolValidationError("Transaction calldata is not an ILAL executeBatch call.");
  const [poolKeyRaw, ordersRaw, signatures] = decoded.args;
  const poolKey = poolKeyRaw as PoolKey;
  const signedOrders = ordersRaw.map((order, index) => ({
    format: SIGNED_ORDER_FORMAT,
    domain: { name: "ILAL Institutional Netting", version: "1", chainId: input.chainId, verifyingContract: poolKey.hooks },
    order: {
      user: order.user,
      poolId: order.poolId,
      zeroForOne: order.zeroForOne,
      amountIn: order.amountIn.toString(),
      minAmountOut: order.minAmountOut.toString(),
      maxAmmInput: order.maxAmmInput.toString(),
      deadline: order.deadline.toString(),
      nonce: order.nonce,
    },
    signature: signatures[index]!,
  } satisfies SignedOrderFile));
  const batch = buildBatch({ chainId: input.chainId, router: input.transaction.to, poolKey, orders: signedOrders });

  const orderEvents = new Map<number, any>();
  let batchEvent: any = null;
  for (const log of input.receipt.logs) {
    if (!equal(log.address, batch.router)) continue;
    try {
      const event = decodeEventLog({ abi: NETTING_ROUTER_ABI, data: log.data, topics: [...log.topics] as [Hex, ...Hex[]] });
      if (event.eventName === "OrderSettled") {
        const index = Number(event.args.orderIndex);
        if (orderEvents.has(index)) throw new ProtocolValidationError(`Duplicate OrderSettled event for order ${index}.`);
        orderEvents.set(index, event.args);
      } else if (event.eventName === "BatchExecuted") {
        if (batchEvent) throw new ProtocolValidationError("Duplicate BatchExecuted event.");
        batchEvent = event.args;
      }
    } catch (error) {
      if (error instanceof Error && /Duplicate/.test(error.message)) throw error;
    }
  }
  if (!batchEvent) throw new ProtocolValidationError("BatchExecuted event is missing.");
  if (orderEvents.size !== batch.orders.length) throw new ProtocolValidationError(`Expected ${batch.orders.length} OrderSettled events; received ${orderEvents.size}.`);
  if (!equal(batchEvent.batchId, batch.batchId)
    || Number(batchEvent.orderCount) !== batch.orders.length
    || BigInt(batchEvent.total0) !== BigInt(batch.summary.total0)
    || BigInt(batchEvent.total1) !== BigInt(batch.summary.total1)
    || BigInt(batchEvent.matchedEachSide) !== BigInt(batch.summary.matchedEachSide)
    || BigInt(batchEvent.residual0) !== BigInt(batch.summary.residual0)
    || BigInt(batchEvent.residual1) !== BigInt(batch.summary.residual1)) {
    throw new ProtocolValidationError("BatchExecuted event does not match the calldata commitment.");
  }
  if (!equal(batchEvent.executor, input.transaction.from)) throw new ProtocolValidationError("Batch executor does not match transaction sender.");

  const orders: SettlementReceiptOrder[] = batch.orders.map((signedOrder, orderIndex) => {
    const event = orderEvents.get(orderIndex);
    if (!event) throw new ProtocolValidationError(`OrderSettled event ${orderIndex} is missing.`);
    const order = parseNettingOrder(signedOrder.order);
    const matchedOutput = BigInt(event.matchedOutput);
    const ammOutput = BigInt(event.ammOutput);
    if (!equal(event.batchId, batch.batchId) || !equal(event.user, order.user)
      || event.zeroForOne !== order.zeroForOne || BigInt(event.amountIn) !== order.amountIn
      || BigInt(event.amountOut) < order.minAmountOut
      || matchedOutput > order.amountIn
      || order.amountIn - matchedOutput > order.maxAmmInput
      || matchedOutput + ammOutput !== BigInt(event.amountOut)) {
      throw new ProtocolValidationError(`OrderSettled event ${orderIndex} does not match its signed order.`);
    }
    return {
      orderIndex,
      orderHash: hashOrder(order),
      signedOrder,
      settlement: {
        amountIn: BigInt(event.amountIn).toString(),
        amountOut: BigInt(event.amountOut).toString(),
        matchedOutput: matchedOutput.toString(),
        ammOutput: ammOutput.toString(),
      },
    };
  });
  let matched0 = 0n;
  let matched1 = 0n;
  let residual0 = 0n;
  let residual1 = 0n;
  for (const orderReceipt of orders) {
    const order = parseNettingOrder(orderReceipt.signedOrder.order);
    const matched = BigInt(orderReceipt.settlement.matchedOutput);
    if (order.zeroForOne) {
      matched0 += matched;
      residual0 += order.amountIn - matched;
    } else {
      matched1 += matched;
      residual1 += order.amountIn - matched;
    }
  }
  if (matched0 !== BigInt(batch.summary.matchedEachSide)
    || matched1 !== BigInt(batch.summary.matchedEachSide)
    || residual0 !== BigInt(batch.summary.residual0)
    || residual1 !== BigInt(batch.summary.residual1)) {
    throw new ProtocolValidationError("OrderSettled allocations do not reconcile to BatchExecuted totals.");
  }
  const receiptId = keccak256(concat([toHex(BigInt(input.chainId), { size: 32 }), input.transaction.hash, batch.batchId]));
  return {
    format: SETTLEMENT_RECEIPT_FORMAT,
    receiptId,
    chainId: input.chainId,
    transaction: {
      hash: input.transaction.hash.toLowerCase() as Hex,
      blockNumber: input.receipt.blockNumber.toString(),
      blockHash: input.receipt.blockHash.toLowerCase() as Hex,
      from: getAddress(input.transaction.from),
      to: getAddress(input.transaction.to),
      status: "success",
    },
    execution: { router: batch.router, hook: batch.poolKey.hooks, poolKey: batch.poolKey, executor: getAddress(batchEvent.executor) },
    batch,
    orders,
    verification: {
      calldataDecoded: true,
      transactionTargetMatchesRouter: true,
      batchIdRecomputed: true,
      batchEventMatches: true,
      orderEventsComplete: true,
    },
  };
}

export function parseReceipt(value: unknown): SettlementReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Receipt must be an object.");
  const supplied = value as SettlementReceipt;
  const receipt = {
    ...supplied,
    chainId: Number(supplied.chainId),
    batch: parseBatch(supplied.batch),
    execution: { ...supplied.execution, poolKey: { ...supplied.execution?.poolKey,
      fee: Number(supplied.execution?.poolKey?.fee), tickSpacing: Number(supplied.execution?.poolKey?.tickSpacing) } },
    orders: Array.isArray(supplied.orders) ? supplied.orders.map(item => ({ ...item, orderIndex: Number(item.orderIndex), signedOrder: parseSignedOrder(item.signedOrder) })) : supplied.orders,
  } as SettlementReceipt;
  if (receipt.format !== SETTLEMENT_RECEIPT_FORMAT) throw new Error(`Expected ${SETTLEMENT_RECEIPT_FORMAT}.`);
  if (!receipt.verification || Object.values(receipt.verification).some(result => result !== true)) throw new ProtocolValidationError("Receipt verification is incomplete.");
  if (!Number.isSafeInteger(receipt.chainId) || receipt.chainId <= 0) throw new Error("Receipt chainId is invalid.");
  const batch = parseBatch(receipt.batch);
  if (batch.chainId !== receipt.chainId) throw new ProtocolValidationError("Receipt and Batch chain IDs differ.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction?.hash ?? "")
    || !/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction?.blockHash ?? "")
    || receipt.transaction.blockHash.toLowerCase() === ZERO_HASH
    || !/^\d+$/.test(receipt.transaction?.blockNumber ?? "")
    || receipt.transaction?.status !== "success") throw new Error("Receipt transaction evidence is malformed.");
  if (!equal(receipt.transaction.to, batch.router)
    || !equal(receipt.execution?.router, batch.router)
    || !equal(receipt.execution?.hook, batch.poolKey.hooks)
    || !equal(receipt.execution?.executor, receipt.transaction.from)
    || !equal(receipt.execution?.poolKey?.currency0, batch.poolKey.currency0)
    || !equal(receipt.execution?.poolKey?.currency1, batch.poolKey.currency1)
    || !equal(receipt.execution?.poolKey?.hooks, batch.poolKey.hooks)
    || receipt.execution?.poolKey?.fee !== batch.poolKey.fee
    || receipt.execution?.poolKey?.tickSpacing !== batch.poolKey.tickSpacing) {
    throw new ProtocolValidationError("Receipt execution identity does not match its Batch or transaction.");
  }
  const expectedReceiptId = keccak256(concat([toHex(BigInt(receipt.chainId), { size: 32 }), receipt.transaction.hash, batch.batchId]));
  if (!equal(receipt.receiptId, expectedReceiptId)) throw new ProtocolValidationError("Receipt ID does not match its transaction and Batch commitment.");
  if (!Array.isArray(receipt.orders) || receipt.orders.length !== batch.orders.length) throw new ProtocolValidationError("Receipt order evidence is incomplete.");
  let matched0 = 0n;
  let matched1 = 0n;
  let residual0 = 0n;
  let residual1 = 0n;
  for (let index = 0; index < receipt.orders.length; index += 1) {
    const item = receipt.orders[index]!;
    const signedOrder = parseSignedOrder(item.signedOrder);
    const expectedSignedOrder = batch.orders[index]!;
    if (item.orderIndex !== index || JSON.stringify(signedOrder) !== JSON.stringify(expectedSignedOrder)) {
      throw new ProtocolValidationError(`Receipt order ${index} does not match the canonical Batch order.`);
    }
    const order = parseNettingOrder(signedOrder.order);
    if (!equal(item.orderHash, hashOrder(order))) throw new ProtocolValidationError(`Receipt order hash ${index} is invalid.`);
    const values = [item.settlement?.amountIn, item.settlement?.amountOut, item.settlement?.matchedOutput, item.settlement?.ammOutput];
    if (values.some(field => typeof field !== "string" || !/^\d+$/.test(field))) throw new Error(`Receipt settlement ${index} is malformed.`);
    const amountIn = BigInt(item.settlement.amountIn);
    const amountOut = BigInt(item.settlement.amountOut);
    const matched = BigInt(item.settlement.matchedOutput);
    const ammOutput = BigInt(item.settlement.ammOutput);
    if (amountIn !== order.amountIn || amountOut < order.minAmountOut || matched > order.amountIn
      || order.amountIn - matched > order.maxAmmInput || matched + ammOutput !== amountOut) {
      throw new ProtocolValidationError(`Receipt settlement ${index} violates its signed order.`);
    }
    if (order.zeroForOne) {
      matched0 += matched;
      residual0 += order.amountIn - matched;
    } else {
      matched1 += matched;
      residual1 += order.amountIn - matched;
    }
  }
  if (matched0 !== BigInt(batch.summary.matchedEachSide) || matched1 !== BigInt(batch.summary.matchedEachSide)
    || residual0 !== BigInt(batch.summary.residual0) || residual1 !== BigInt(batch.summary.residual1)) {
    throw new ProtocolValidationError("Receipt orders do not reconcile to Batch totals.");
  }
  return receipt;
}
