import {
  concat,
  createPublicClient,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  isAddress,
  keccak256,
  parseAbiParameters,
  serializeTransaction,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { withConfig } from "../config.js";
import { createExecutionClients } from "../signer.js";
import { die, header, log } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };
const UINT128_MAX = (1n << 128n) - 1n;
const ORDER_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "NettingOrder(address user,bytes32 poolId,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint128 maxAmmInput,uint64 deadline,bytes32 nonce)",
  ),
);
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const PREFLIGHT_CALLER = "0x0000000000000000000000000000000000000001" as Address;
const BASE_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" as Address;

const ORDER_COMPONENTS = [
  { name: "user", type: "address" },
  { name: "poolId", type: "bytes32" },
  { name: "zeroForOne", type: "bool" },
  { name: "amountIn", type: "uint128" },
  { name: "minAmountOut", type: "uint128" },
  { name: "maxAmmInput", type: "uint128" },
  { name: "deadline", type: "uint64" },
  { name: "nonce", type: "bytes32" },
] as const;

const POOL_KEY_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const HEADER_COMPONENTS = [
  { name: "batchId", type: "bytes32" },
  { name: "orderCount", type: "uint8" },
  { name: "total0", type: "uint256" },
  { name: "total1", type: "uint256" },
  { name: "matchedEachSide", type: "uint256" },
  { name: "residual0", type: "uint256" },
  { name: "residual1", type: "uint256" },
  { name: "exposureReduction", type: "uint256" },
] as const;

const NETTING_ROUTER_ABI = [
  {
    name: "poolManager", type: "function", stateMutability: "view", inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "previewBatch", type: "function", stateMutability: "pure",
    inputs: [{ name: "orders", type: "tuple[]", components: ORDER_COMPONENTS }],
    outputs: [{ name: "header", type: "tuple", components: HEADER_COMPONENTS }],
  },
  {
    name: "executeBatch", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "key", type: "tuple", components: POOL_KEY_COMPONENTS },
      { name: "orders", type: "tuple[]", components: ORDER_COMPONENTS },
      { name: "signatures", type: "bytes[]" },
    ],
    outputs: [{ name: "batchId", type: "bytes32" }],
  },
  {
    name: "OrderSettled", type: "event", anonymous: false,
    inputs: [
      { name: "batchId", type: "bytes32", indexed: true },
      { name: "orderIndex", type: "uint256", indexed: true },
      { name: "user", type: "address", indexed: true },
      { name: "zeroForOne", type: "bool", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "matchedOutput", type: "uint256", indexed: false },
      { name: "ammOutput", type: "uint256", indexed: false },
    ],
  },
  {
    name: "BatchExecuted", type: "event", anonymous: false,
    inputs: [
      { name: "batchId", type: "bytes32", indexed: true },
      { name: "executor", type: "address", indexed: true },
      { name: "orderCount", type: "uint256", indexed: false },
      { name: "total0", type: "uint256", indexed: false },
      { name: "total1", type: "uint256", indexed: false },
      { name: "matchedEachSide", type: "uint256", indexed: false },
      { name: "residual0", type: "uint256", indexed: false },
      { name: "residual1", type: "uint256", indexed: false },
    ],
  },
] as const;

const NETTING_HOOK_ABI = [
  {
    name: "nonceUsed", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }, { name: "nonce", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "cancelNonce", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "nonce", type: "bytes32" }], outputs: [],
  },
  {
    name: "NonceCancelled", type: "event", anonymous: false,
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "nonce", type: "bytes32", indexed: true },
    ],
  },
] as const;

const ERC20_PREFLIGHT_ABI = [
  {
    name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const GAS_PRICE_ORACLE_ABI = [{
  name: "getL1Fee", type: "function", stateMutability: "view",
  inputs: [{ name: "_unsignedTx", type: "bytes" }], outputs: [{ name: "", type: "uint256" }],
}] as const;

export interface NettingOrder {
  user: Address;
  poolId: Hex;
  zeroForOne: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  maxAmmInput: bigint;
  deadline: bigint;
  nonce: Hex;
}

export interface SignedOrderFile {
  format: "ilal-netting-order-v1";
  domain: { name: "ILAL Institutional Netting"; version: "1"; chainId: number; verifyingContract: Address };
  order: Record<keyof NettingOrder, string | boolean>;
  signature: Hex;
}

export interface NettingPreview {
  batchId: Hex;
  orderCount: number;
  total0: bigint;
  total1: bigint;
  matchedEachSide: bigint;
  residual0: bigint;
  residual1: bigint;
  exposureReduction: bigint;
}

export interface NettingPreflightReport {
  format: "ilal-netting-preflight-v1";
  generatedAt: string;
  chainId: number;
  snapshot: { blockNumber: string; blockHash: Hex; timestamp: string };
  batch: Record<string, string | number>;
  pool: {
    poolId: Hex; router: Address; hook: Address; poolManager: Address;
    currency0: Address; currency1: Address; fee: number; tickSpacing: number;
    poolManagerBalances: { currency0: string; currency1: string };
  };
  checks: Array<{ name: string; ok: boolean; detail: string; orderIndex?: number }>;
  fees: {
    estimatedExecutionGas: string | null; gasPriceWei: string | null;
    l2ExecutionFeeWei: string | null; l1SecurityFeeWei: string | null;
    estimatedTotalFeeWei: string | null; model: string;
  };
  status: "executable" | "rejected" | "rpc-error";
  decodedRevert: { selector: Hex | null; message: string } | null;
  warning: string;
}

function requireAddress(value: string | undefined, label: string): Address {
  if (!value || !isAddress(value)) die(`${label} must be a valid address.`);
  return value as Address;
}

function requireBytes32(value: string | undefined, label: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) die(`${label} must be a 32-byte hex value.`);
  return value as Hex;
}

function uint(value: string | undefined, label: string, maximum = UINT128_MAX): bigint {
  if (!value || !/^\d+$/.test(value)) die(`${label} must be an unsigned decimal integer.`);
  const parsed = BigInt(value);
  if (parsed > maximum) die(`${label} exceeds its on-chain integer range.`);
  return parsed;
}

function orderHash(order: NettingOrder): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,address,bytes32,bool,uint128,uint128,uint128,uint64,bytes32"),
    [
      ORDER_TYPEHASH,
      order.user,
      order.poolId,
      order.zeroForOne,
      order.amountIn,
      order.minAmountOut,
      order.maxAmmInput,
      order.deadline,
      order.nonce,
    ],
  ));
}

function compareOrderHashes(left: NettingOrder, right: NettingOrder): number {
  const leftHash = orderHash(left).toLowerCase();
  const rightHash = orderHash(right).toLowerCase();
  return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
}

function canonicalOrders(orders: NettingOrder[]): NettingOrder[] {
  const ordered = [...orders].sort(compareOrderHashes);
  for (let index = 1; index < ordered.length; index += 1) {
    if (orderHash(ordered[index - 1]!) === orderHash(ordered[index]!)) {
      throw new Error(`Duplicate order hash at canonical index ${index}.`);
    }
  }
  return ordered;
}

export function previewNettingOrders(orders: NettingOrder[]): NettingPreview {
  let total0 = 0n;
  let total1 = 0n;
  let batchId = ZERO_HASH;
  const ordered = canonicalOrders(orders);
  for (const order of ordered) {
    if (order.zeroForOne) total0 += order.amountIn;
    else total1 += order.amountIn;
    batchId = keccak256(concat([batchId, orderHash(order)]));
  }
  const matchedEachSide = total0 < total1 ? total0 : total1;
  return {
    batchId,
    orderCount: orders.length,
    total0,
    total1,
    matchedEachSide,
    residual0: total0 - matchedEachSide,
    residual1: total1 - matchedEachSide,
    exposureReduction: matchedEachSide * 2n,
  };
}

function serializeOrder(order: NettingOrder): Record<keyof NettingOrder, string | boolean> {
  return {
    user: order.user,
    poolId: order.poolId,
    zeroForOne: order.zeroForOne,
    amountIn: order.amountIn.toString(),
    minAmountOut: order.minAmountOut.toString(),
    maxAmmInput: order.maxAmmInput.toString(),
    deadline: order.deadline.toString(),
    nonce: order.nonce,
  };
}

function parseSignedOrder(path: string): { file: SignedOrderFile; order: NettingOrder } {
  let file: SignedOrderFile;
  try {
    file = JSON.parse(readFileSync(resolve(path), "utf8")) as SignedOrderFile;
  } catch (error) {
    die(`Could not read signed order ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (file.format !== "ilal-netting-order-v1") die(`${path} is not an ILAL netting order v1 file.`);
  const raw = file.order;
  const order: NettingOrder = {
    user: requireAddress(String(raw.user), `${path}: user`),
    poolId: requireBytes32(String(raw.poolId), `${path}: poolId`),
    zeroForOne: raw.zeroForOne === true,
    amountIn: uint(String(raw.amountIn), `${path}: amountIn`),
    minAmountOut: uint(String(raw.minAmountOut), `${path}: minAmountOut`),
    maxAmmInput: uint(String(raw.maxAmmInput), `${path}: maxAmmInput`),
    deadline: uint(String(raw.deadline), `${path}: deadline`, (1n << 64n) - 1n),
    nonce: requireBytes32(String(raw.nonce), `${path}: nonce`),
  };
  if (!/^0x[0-9a-fA-F]{130}$/.test(file.signature)) die(`${path}: signature must be 65-byte hex.`);
  return { file, order };
}

function loadBatch(paths: string[]): { files: SignedOrderFile[]; orders: NettingOrder[]; signatures: Hex[] } {
  if (paths.length < 2 || paths.length > 16) die("A batch requires 2 to 16 signed order files.");
  const parsed = paths.map(parseSignedOrder);
  const hook = parsed[0]!.file.domain.verifyingContract.toLowerCase();
  const chainId = parsed[0]!.file.domain.chainId;
  for (const item of parsed) {
    if (item.file.domain.name !== "ILAL Institutional Netting" || item.file.domain.version !== "1") {
      die("All orders must use the ILAL Institutional Netting v1 EIP-712 domain.");
    }
    if (item.file.domain.verifyingContract.toLowerCase() !== hook || item.file.domain.chainId !== chainId) {
      die("All orders in a batch must use the same Hook and chain domain.");
    }
  }
  parsed.sort((left, right) => compareOrderHashes(left.order, right.order));
  for (let index = 1; index < parsed.length; index += 1) {
    if (orderHash(parsed[index - 1]!.order) === orderHash(parsed[index]!.order)) {
      die(`Duplicate order hash at canonical index ${index}.`);
    }
  }
  return {
    files: parsed.map(item => item.file),
    orders: parsed.map(item => item.order),
    signatures: parsed.map(item => item.file.signature),
  };
}

function printPreview(preview: NettingPreview): void {
  console.log("ordering:                 orderHash ascending");
  console.log(`submitted gross:          ${(preview.total0 + preview.total1).toString()}`);
  console.log(`internally matched gross: ${preview.exposureReduction.toString()}`);
  console.log(`matched each side:        ${preview.matchedEachSide.toString()}`);
  console.log(`residual token0:          ${preview.residual0.toString()}`);
  console.log(`residual token1:          ${preview.residual1.toString()}`);
  console.log(`AMM exposure reduction:   ${preview.exposureReduction.toString()}`);
  console.log(`batchId:                  ${preview.batchId}`);
}

function revertDetails(error: unknown): { selector: Hex | null; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/0x[0-9a-fA-F]{8}/);
  return {
    selector: match ? match[0].toLowerCase() as Hex : null,
    message: message.split("\n")[0]?.slice(0, 500) ?? "Unknown execution rejection",
  };
}

function preflightJson(report: NettingPreflightReport): string {
  return `${JSON.stringify(report, (_, value) => typeof value === "bigint" ? value.toString() : value, 2)}\n`;
}

export async function runNettingPreflight(opts: {
  orders: string[]; output?: string; router?: string; hook?: string; tokenA?: string; tokenB?: string;
  fee?: string; tickSpacing?: string; chain?: string; rpc?: string; from?: string;
}, emit = true): Promise<NettingPreflightReport> {
  const cfg = withConfig(opts);
  const router = requireAddress(cfg.router, "BatchRouter");
  const hook = requireAddress(cfg.hook, "Hook");
  const token0 = requireAddress(cfg.tokenA, "currency0 token");
  const token1 = requireAddress(cfg.tokenB, "currency1 token");
  if (token0.toLowerCase() >= token1.toLowerCase()) die("Token addresses must be supplied in currency0/currency1 sort order.");
  const batch = loadBatch(opts.orders);
  const preview = previewNettingOrders(batch.orders);
  const chainId = Number(cfg.chain ?? batch.files[0]!.domain.chainId);
  if (chainId !== batch.files[0]!.domain.chainId) die("Configured chain does not match the signed order domain.");
  const chain = CHAINS[String(chainId)] ?? baseSepolia;
  const publicClient = createPublicClient({ chain, transport: cfg.rpc ? http(cfg.rpc) : http() });
  const caller = opts.from ? requireAddress(opts.from, "Preflight caller") : PREFLIGHT_CALLER;
  const fee = Number(cfg.fee ?? "500");
  const tickSpacing = Number(cfg.tickSpacing ?? "10");
  const poolKey = { currency0: token0, currency1: token1, fee, tickSpacing, hooks: hook };
  const checks: NettingPreflightReport["checks"] = [];
  let block;
  try {
    block = await publicClient.getBlock({ blockTag: "latest" });
  } catch (error) {
    const decodedRevert = revertDetails(error);
    const report: NettingPreflightReport = {
      format: "ilal-netting-preflight-v1", generatedAt: new Date().toISOString(), chainId,
      snapshot: { blockNumber: "0", blockHash: ZERO_HASH, timestamp: "0" },
      batch: { batchId: preview.batchId, orderCount: preview.orderCount },
      pool: { poolId: batch.orders[0]!.poolId, router, hook, poolManager: PREFLIGHT_CALLER,
        currency0: token0, currency1: token1, fee, tickSpacing,
        poolManagerBalances: { currency0: "0", currency1: "0" } },
      checks, fees: { estimatedExecutionGas: null, gasPriceWei: null, l2ExecutionFeeWei: null,
        l1SecurityFeeWei: null, estimatedTotalFeeWei: null,
        model: "Base L2 execution plus GasPriceOracle.getL1Fee(serialized transaction)" },
      status: "rpc-error", decodedRevert,
      warning: "Preflight is a state snapshot. Signed limits and atomic rollback remain the final safety controls.",
    };
    if (opts.output) writeFileSync(resolve(opts.output), preflightJson(report));
    return report;
  }

  const blockNumber = block.number;
  const now = block.timestamp;
  const callData = encodeFunctionData({
    abi: NETTING_ROUTER_ABI, functionName: "executeBatch", args: [poolKey, batch.orders, batch.signatures],
  });
  let poolManager = PREFLIGHT_CALLER;
  let managerBalance0 = 0n;
  let managerBalance1 = 0n;
  let estimatedGas: bigint | null = null;
  let gasPrice: bigint | null = null;
  let l1Fee: bigint | null = null;
  let decodedRevert: NettingPreflightReport["decodedRevert"] = null;
  let simulationPassed = false;

  try {
    poolManager = await publicClient.readContract({ address: router, abi: NETTING_ROUTER_ABI,
      functionName: "poolManager", blockNumber });
    [managerBalance0, managerBalance1] = await Promise.all([
      publicClient.readContract({ address: token0, abi: ERC20_PREFLIGHT_ABI, functionName: "balanceOf",
        args: [poolManager], blockNumber }),
      publicClient.readContract({ address: token1, abi: ERC20_PREFLIGHT_ABI, functionName: "balanceOf",
        args: [poolManager], blockNumber }),
    ]);
    checks.push({ name: "opposite-directions", ok: preview.total0 > 0n && preview.total1 > 0n,
      detail: `total0=${preview.total0}; total1=${preview.total1}` });
    checks.push({ name: "hook-domain", ok: batch.files[0]!.domain.verifyingContract.toLowerCase() === hook.toLowerCase(),
      detail: batch.files[0]!.domain.verifyingContract });

    for (let index = 0; index < batch.orders.length; index += 1) {
      const order = batch.orders[index]!;
      const inputToken = order.zeroForOne ? token0 : token1;
      const [balance, allowance, nonceUsed] = await Promise.all([
        publicClient.readContract({ address: inputToken, abi: ERC20_PREFLIGHT_ABI, functionName: "balanceOf",
          args: [order.user], blockNumber }),
        publicClient.readContract({ address: inputToken, abi: ERC20_PREFLIGHT_ABI, functionName: "allowance",
          args: [order.user, router], blockNumber }),
        publicClient.readContract({ address: hook, abi: NETTING_HOOK_ABI, functionName: "nonceUsed",
          args: [order.user, order.nonce], blockNumber }),
      ]);
      checks.push({ name: "deadline", orderIndex: index, ok: order.deadline >= now,
        detail: `deadline=${order.deadline}; blockTimestamp=${now}` });
      checks.push({ name: "nonce-unused", orderIndex: index, ok: !nonceUsed, detail: `nonce=${order.nonce}` });
      checks.push({ name: "balance", orderIndex: index, ok: balance >= order.amountIn,
        detail: `balance=${balance}; required=${order.amountIn}` });
      checks.push({ name: "allowance", orderIndex: index, ok: allowance >= order.amountIn,
        detail: `allowance=${allowance}; required=${order.amountIn}` });
    }

    await publicClient.call({ account: caller, to: router, data: callData, blockNumber });
    simulationPassed = true;
    checks.push({ name: "full-execution-eth-call", ok: true,
      detail: "executeBatch completed against the pinned state snapshot; signatures and policy were validated on-chain" });
    estimatedGas = await publicClient.estimateGas({ account: caller, to: router, data: callData, blockNumber });
    gasPrice = await publicClient.getGasPrice();
    if (chainId === base.id || chainId === baseSepolia.id) {
      const serialized = serializeTransaction({
        chainId, gas: estimatedGas, gasPrice, nonce: 0, to: router, data: callData, value: 0n,
      }, {
        r: `0x${"01".repeat(32)}`, s: `0x${"02".repeat(32)}`, v: 27n,
      });
      l1Fee = await publicClient.readContract({ address: BASE_GAS_PRICE_ORACLE, abi: GAS_PRICE_ORACLE_ABI,
        functionName: "getL1Fee", args: [serialized], blockNumber });
    }
  } catch (error) {
    decodedRevert = revertDetails(error);
    checks.push({ name: "full-execution-eth-call", ok: false, detail: decodedRevert.message });
  }

  const manualPassed = checks.every(check => check.ok);
  const status = simulationPassed && manualPassed ? "executable" : "rejected";
  const l2Fee = estimatedGas !== null && gasPrice !== null ? estimatedGas * gasPrice : null;
  const totalFee = l2Fee !== null ? l2Fee + (l1Fee ?? 0n) : null;
  const report: NettingPreflightReport = {
    format: "ilal-netting-preflight-v1", generatedAt: new Date().toISOString(), chainId,
    snapshot: { blockNumber: blockNumber.toString(), blockHash: block.hash, timestamp: now.toString() },
    batch: {
      batchId: preview.batchId, orderCount: preview.orderCount,
      total0: preview.total0.toString(), total1: preview.total1.toString(),
      matchedEachSide: preview.matchedEachSide.toString(), residual0: preview.residual0.toString(),
      residual1: preview.residual1.toString(), exposureReduction: preview.exposureReduction.toString(),
    },
    pool: { poolId: batch.orders[0]!.poolId, router, hook, poolManager, currency0: token0, currency1: token1,
      fee, tickSpacing, poolManagerBalances: { currency0: managerBalance0.toString(), currency1: managerBalance1.toString() } },
    checks,
    fees: {
      estimatedExecutionGas: estimatedGas?.toString() ?? null, gasPriceWei: gasPrice?.toString() ?? null,
      l2ExecutionFeeWei: l2Fee?.toString() ?? null, l1SecurityFeeWei: l1Fee?.toString() ?? null,
      estimatedTotalFeeWei: totalFee?.toString() ?? null,
      model: "Base L2 execution plus GasPriceOracle.getL1Fee(serialized transaction)",
    },
    status, decodedRevert,
    warning: "Preflight is a state snapshot. Signed limits and atomic rollback remain the final safety controls.",
  };
  if (opts.output) writeFileSync(resolve(opts.output), preflightJson(report));
  if (emit) {
    header("Atomic netting preflight", `${preview.orderCount} orders`);
    printPreview(preview);
    console.log(`snapshot:                 ${blockNumber} (${block.hash})`);
    console.log(`status:                   ${status}`);
    if (opts.output) log.ok(`Wrote ${resolve(opts.output)}`);
    if (decodedRevert) console.log(`rejection:                ${decodedRevert.selector ?? "unknown"} ${decodedRevert.message}`);
    log.warn(report.warning);
  }
  return report;
}

export async function nettingBatchPreflight(opts: Parameters<typeof runNettingPreflight>[0]): Promise<void> {
  const report = await runNettingPreflight(opts);
  process.exitCode = report.status === "executable" ? 0 : report.status === "rejected" ? 2 : 1;
}

export async function nettingOrderSign(opts: {
  pool?: string; hook?: string; user?: string; amountIn: string; minAmountOut: string;
  maxAmmInput: string; zeroForOne?: boolean; oneForZero?: boolean; deadline?: string;
  ttl?: string; nonce?: string; output: string; chain?: string; rpc?: string; privateKey?: string;
}): Promise<void> {
  const cfg = withConfig(opts);
  if (opts.zeroForOne === opts.oneForZero) die("Choose exactly one direction: --zero-for-one or --one-for-zero.");
  const hook = requireAddress(cfg.hook, "Hook");
  const poolId = requireBytes32(cfg.pool ?? cfg.poolId, "Pool ID");
  const chainId = Number(cfg.chain ?? "84532");
  const chain = CHAINS[String(chainId)] ?? baseSepolia;
  const clients = await createExecutionClients({ chain, rpc: cfg.rpc, legacyPrivateKey: opts.privateKey });
  const user = opts.user ? requireAddress(opts.user, "User") : clients.address;
  if (user.toLowerCase() !== clients.address.toLowerCase()) {
    die("The selected signer must match --user; ERC-1271 order signing is wallet-specific and must be delegated externally.");
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = opts.deadline
    ? uint(opts.deadline, "Deadline", (1n << 64n) - 1n)
    : now + uint(opts.ttl ?? "600", "TTL", (1n << 64n) - 1n);
  if (deadline <= now) die("Deadline must be in the future.");
  const nonce = opts.nonce ? requireBytes32(opts.nonce, "Nonce") : (`0x${randomBytes(32).toString("hex")}` as Hex);
  const order: NettingOrder = {
    user,
    poolId,
    zeroForOne: Boolean(opts.zeroForOne),
    amountIn: uint(opts.amountIn, "Amount in"),
    minAmountOut: uint(opts.minAmountOut, "Minimum amount out"),
    maxAmmInput: uint(opts.maxAmmInput, "Maximum AMM input"),
    deadline,
    nonce,
  };
  if (order.amountIn === 0n) die("Amount in must be positive.");
  const signature = await clients.walletClient.signTypedData({
    account: clients.account,
    domain: { name: "ILAL Institutional Netting", version: "1", chainId, verifyingContract: hook },
    primaryType: "NettingOrder",
    types: { NettingOrder: ORDER_COMPONENTS },
    message: order,
  });
  const file: SignedOrderFile = {
    format: "ilal-netting-order-v1",
    domain: { name: "ILAL Institutional Netting", version: "1", chainId, verifyingContract: hook },
    order: serializeOrder(order),
    signature,
  };
  const output = resolve(opts.output);
  writeFileSync(output, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  header("Netting order signed", order.zeroForOne ? "token0 → token1" : "token1 → token0");
  log.ok(`Wrote ${output}`);
  console.log(`orderHash: ${orderHash(order)}`);
  console.log(`nonce:     ${nonce}`);
}

export async function nettingBatchPreview(opts: { orders: string[] }): Promise<void> {
  const batch = loadBatch(opts.orders);
  const preview = previewNettingOrders(batch.orders);
  if (preview.total0 === 0n || preview.total1 === 0n) die("Batch must contain at least one order in each direction.");
  header("Atomic netting preview", `${preview.orderCount} orders`);
  printPreview(preview);
}

export async function nettingBatchExecute(opts: {
  orders: string[]; router?: string; hook?: string; tokenA?: string; tokenB?: string;
  fee?: string; tickSpacing?: string; chain?: string; rpc?: string; privateKey?: string; from?: string;
}): Promise<void> {
  const cfg = withConfig(opts);
  const router = requireAddress(cfg.router, "BatchRouter");
  const hook = requireAddress(cfg.hook, "Hook");
  const token0 = requireAddress(cfg.tokenA, "currency0 token");
  const token1 = requireAddress(cfg.tokenB, "currency1 token");
  if (token0.toLowerCase() >= token1.toLowerCase()) die("Token addresses must be supplied in currency0/currency1 sort order.");
  const batch = loadBatch(opts.orders);
  if (batch.files[0]!.domain.verifyingContract.toLowerCase() !== hook.toLowerCase()) {
    die("Signed order Hook domain does not match the configured Hook.");
  }
  const preview = previewNettingOrders(batch.orders);
  if (preview.total0 === 0n || preview.total1 === 0n) die("Batch must contain at least one order in each direction.");
  const chainId = String(cfg.chain ?? batch.files[0]!.domain.chainId);
  if (Number(chainId) !== batch.files[0]!.domain.chainId) die("Configured chain does not match the signed order domain.");
  const chain = CHAINS[chainId] ?? baseSepolia;
  const initialPreflight = await runNettingPreflight({ ...opts, chain: chainId }, true);
  if (initialPreflight.status !== "executable") {
    die(`Preflight ${initialPreflight.status}; the batch was not sent.`);
  }
  const { account, publicClient, walletClient } = await createExecutionClients({
    chain, rpc: cfg.rpc, legacyPrivateKey: opts.privateKey,
  });
  const poolKey = {
    currency0: token0,
    currency1: token1,
    fee: Number(cfg.fee ?? "500"),
    tickSpacing: Number(cfg.tickSpacing ?? "10"),
    hooks: hook,
  };
  const onchain = await publicClient.readContract({
    address: router,
    abi: NETTING_ROUTER_ABI,
    functionName: "previewBatch",
    args: [batch.orders],
  });
  if (onchain.batchId.toLowerCase() !== preview.batchId.toLowerCase()) die("Local and on-chain batch commitments differ.");
  const finalPreflight = await runNettingPreflight({ ...opts, chain: chainId, from: account.address }, false);
  if (finalPreflight.status !== "executable") {
    die(`Final pre-broadcast simulation ${finalPreflight.status}; state changed and the batch was not sent.`);
  }
  header("Executing atomic netting batch", `${batch.orders.length} orders`);
  printPreview(preview);
  const hash = await walletClient.writeContract({
    account,
    address: router,
    abi: NETTING_ROUTER_ABI,
    functionName: "executeBatch",
    args: [poolKey, batch.orders, batch.signatures],
    chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Batch transaction reverted: ${hash}`);
  console.log(`transaction hash: ${hash}`);
  for (const entry of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: NETTING_ROUTER_ABI, data: entry.data, topics: entry.topics });
      if (decoded.eventName === "OrderSettled" || decoded.eventName === "BatchExecuted") {
        console.log(`${decoded.eventName}: ${JSON.stringify(decoded.args, (_, value) => typeof value === "bigint" ? value.toString() : value)}`);
      }
    } catch { /* another contract's event */ }
  }
}

export async function nettingNonceCancel(opts: {
  nonce: string; hook?: string; chain?: string; rpc?: string; privateKey?: string;
}): Promise<void> {
  const cfg = withConfig(opts);
  const hook = requireAddress(cfg.hook, "Hook");
  const nonce = requireBytes32(opts.nonce, "Nonce");
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const { account, publicClient, walletClient } = await createExecutionClients({
    chain, rpc: cfg.rpc, legacyPrivateKey: opts.privateKey,
  });
  const hash = await walletClient.writeContract({
    account, address: hook, abi: NETTING_HOOK_ABI, functionName: "cancelNonce", args: [nonce], chain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Nonce cancellation reverted: ${hash}`);
  log.ok(`Nonce cancelled: ${nonce}`);
  console.log(`transaction hash: ${hash}`);
}
