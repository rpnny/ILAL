import {
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import { NETTING_ROUTER_ABI } from "./abis.js";
import { ProtocolValidationError } from "./errors.js";
import { hashOrder, parseNettingOrder, parseSignedOrder, type NettingOrder, type SignedOrderFile } from "./order.js";

export const BATCH_FORMAT = "ilal-batch-v1" as const;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface BatchPreview {
  batchId: Hex;
  orderCount: number;
  total0: bigint;
  total1: bigint;
  matchedEachSide: bigint;
  residual0: bigint;
  residual1: bigint;
  exposureReduction: bigint;
}

export interface SerializedBatchPreview {
  orderCount: number;
  total0: string;
  total1: string;
  matchedEachSide: string;
  residual0: string;
  residual1: string;
  exposureReduction: string;
}

export interface ILALBatch {
  format: typeof BATCH_FORMAT;
  chainId: number;
  router: Address;
  poolKey: PoolKey;
  batchId: Hex;
  summary: SerializedBatchPreview;
  orders: SignedOrderFile[];
}

function canonicalSignedOrders(values: readonly SignedOrderFile[]): SignedOrderFile[] {
  const parsed = values.map(parseSignedOrder);
  parsed.sort((left, right) => {
    const a = hashOrder(parseNettingOrder(left.order)).toLowerCase();
    const b = hashOrder(parseNettingOrder(right.order)).toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (let index = 1; index < parsed.length; index += 1) {
    if (hashOrder(parseNettingOrder(parsed[index - 1]!.order)) === hashOrder(parseNettingOrder(parsed[index]!.order))) {
      throw new ProtocolValidationError(`Duplicate order hash at canonical index ${index}.`);
    }
  }
  return parsed;
}

export function previewBatch(orderValues: readonly (NettingOrder | SignedOrderFile)[]): BatchPreview {
  const orders = orderValues.map(value => "format" in value ? parseNettingOrder(parseSignedOrder(value).order) : parseNettingOrder(value));
  const ordered = [...orders].sort((a, b) => hashOrder(a).localeCompare(hashOrder(b)));
  let total0 = 0n;
  let total1 = 0n;
  let batchId = ZERO_HASH;
  for (let index = 0; index < ordered.length; index += 1) {
    const order = ordered[index]!;
    const orderHash = hashOrder(order);
    if (index !== 0 && orderHash === hashOrder(ordered[index - 1]!)) throw new ProtocolValidationError(`Duplicate order hash at canonical index ${index}.`);
    if (order.zeroForOne) total0 += order.amountIn;
    else total1 += order.amountIn;
    batchId = keccak256(concat([batchId, orderHash]));
  }
  const matchedEachSide = total0 < total1 ? total0 : total1;
  return {
    batchId, orderCount: orders.length, total0, total1, matchedEachSide,
    residual0: total0 - matchedEachSide,
    residual1: total1 - matchedEachSide,
    exposureReduction: matchedEachSide * 2n,
  };
}

export function serializeBatchPreview(value: BatchPreview): SerializedBatchPreview {
  return {
    orderCount: value.orderCount,
    total0: value.total0.toString(),
    total1: value.total1.toString(),
    matchedEachSide: value.matchedEachSide.toString(),
    residual0: value.residual0.toString(),
    residual1: value.residual1.toString(),
    exposureReduction: value.exposureReduction.toString(),
  };
}

export function poolId(key: PoolKey): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address,address,uint24,int24,address"),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
  ));
}

function normalizePoolKey(value: PoolKey): PoolKey {
  if (!isAddress(value.currency0) || !isAddress(value.currency1) || !isAddress(value.hooks)) throw new Error("PoolKey addresses are invalid.");
  const currency0 = getAddress(value.currency0);
  const currency1 = getAddress(value.currency1);
  if (currency0.toLowerCase() >= currency1.toLowerCase()) throw new Error("PoolKey currencies must be in address sort order.");
  if (!Number.isInteger(value.fee) || value.fee < 0 || value.fee > 0xffffff) throw new Error("PoolKey fee is outside uint24.");
  if (!Number.isInteger(value.tickSpacing) || value.tickSpacing < -0x800000 || value.tickSpacing > 0x7fffff) throw new Error("PoolKey tickSpacing is outside int24.");
  return { currency0, currency1, fee: value.fee, tickSpacing: value.tickSpacing, hooks: getAddress(value.hooks) };
}

export function buildBatch(input: { chainId: number; router: Address; poolKey: PoolKey; orders: readonly SignedOrderFile[] }): ILALBatch {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new Error("chainId must be a positive safe integer.");
  if (!isAddress(input.router)) throw new Error("router must be a valid address.");
  if (input.orders.length < 2 || input.orders.length > 16) throw new ProtocolValidationError("A batch requires 2 to 16 signed orders.");
  const key = normalizePoolKey(input.poolKey);
  const orders = canonicalSignedOrders(input.orders);
  const first = orders[0]!;
  const expectedPoolId = poolId(key);
  for (const orderFile of orders) {
    const order = parseNettingOrder(orderFile.order);
    if (orderFile.domain.chainId !== input.chainId) throw new ProtocolValidationError("All orders must use the batch chainId.");
    if (orderFile.domain.verifyingContract.toLowerCase() !== key.hooks.toLowerCase()) throw new ProtocolValidationError("All order domains must use the batch Hook.");
    if (order.poolId.toLowerCase() !== expectedPoolId.toLowerCase()) throw new ProtocolValidationError("All orders must use the PoolKey poolId.");
    if (orderFile.domain.chainId !== first.domain.chainId || orderFile.domain.verifyingContract.toLowerCase() !== first.domain.verifyingContract.toLowerCase()) {
      throw new ProtocolValidationError("All orders must use the same Hook and chain domain.");
    }
  }
  const preview = previewBatch(orders);
  if (preview.total0 === 0n || preview.total1 === 0n) throw new ProtocolValidationError("Batch must contain at least one order in each direction.");
  return {
    format: BATCH_FORMAT,
    chainId: input.chainId,
    router: getAddress(input.router),
    poolKey: key,
    batchId: preview.batchId,
    summary: serializeBatchPreview(preview),
    orders,
  };
}

export function parseBatch(value: unknown): ILALBatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Batch must be an object.");
  const raw = value as Record<string, unknown>;
  if (raw["format"] !== BATCH_FORMAT) throw new Error(`Expected ${BATCH_FORMAT}.`);
  const poolKeyValue = raw["poolKey"] as PoolKey;
  if (!Array.isArray(raw["orders"])) throw new Error("Batch orders must be an array.");
  const rebuilt = buildBatch({
    chainId: Number(raw["chainId"]),
    router: raw["router"] as Address,
    poolKey: poolKeyValue,
    orders: raw["orders"].map(parseSignedOrder),
  });
  if (typeof raw["batchId"] !== "string" || rebuilt.batchId.toLowerCase() !== raw["batchId"].toLowerCase()) throw new ProtocolValidationError("Batch commitment does not match its orders.");
  const suppliedSummary = raw["summary"];
  if (!suppliedSummary || typeof suppliedSummary !== "object" || Array.isArray(suppliedSummary)) throw new Error("Batch summary must be an object.");
  const supplied = suppliedSummary as Record<string, unknown>;
  const summaryKeys = Object.keys(rebuilt.summary) as Array<keyof SerializedBatchPreview>;
  if (Object.keys(supplied).length !== summaryKeys.length || summaryKeys.some(key => supplied[key] !== rebuilt.summary[key])) {
    throw new ProtocolValidationError("Batch summary does not match its orders.");
  }
  return rebuilt;
}

export function batchExecutionArgs(batchValue: ILALBatch) {
  const batch = parseBatch(batchValue);
  return {
    poolKey: batch.poolKey,
    orders: batch.orders.map(order => parseNettingOrder(order.order)),
    signatures: batch.orders.map(order => order.signature),
  };
}

export function encodeBatchExecution(batchValue: ILALBatch): Hex {
  const batch = parseBatch(batchValue);
  const args = batchExecutionArgs(batch);
  return encodeFunctionData({ abi: NETTING_ROUTER_ABI, functionName: "executeBatch", args: [args.poolKey, args.orders, args.signatures] });
}
