import {
  NETTING_HOOK_ABI,
  NETTING_ORDER_COMPONENTS,
  NETTING_ROUTER_ABI,
  buildBatch,
  createOrderIntent,
  decodeProtocolRevert,
  executeBatch,
  hashOrder,
  parseNettingOrder,
  parseSignedOrder,
  preflightBatch,
  previewBatch,
  serializeOrder,
  SettlementRejectedError,
  signOrder,
  type BatchPreview,
  type ILALBatch,
  type NettingOrder,
  type PreflightReport,
  type SignedOrderFile,
} from "@ilalv3/protocol";
import { createPublicClient, getAddress, http, isAddress, type Address, type Chain, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { withConfig } from "../config.js";
import { createExecutionClients } from "../signer.js";
import { die, header, log } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };
const UINT128_MAX = (1n << 128n) - 1n;

export { NETTING_ORDER_COMPONENTS, NETTING_ROUTER_ABI };
export type NettingPreview = BatchPreview;
export type NettingPreflightReport = PreflightReport;
export type { NettingOrder, SignedOrderFile };

export interface SignedNettingOrderResult {
  output: string;
  orderHash: Hex;
  nonce: Hex;
  file: SignedOrderFile;
}

function requireAddress(value: string | undefined, label: string): Address {
  if (!value || !isAddress(value)) die(`${label} must be a valid address.`);
  return getAddress(value);
}

function requireBytes32(value: string | undefined, label: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) die(`${label} must be a 32-byte hex value.`);
  return value.toLowerCase() as Hex;
}

function uint(value: string | undefined, label: string, maximum = UINT128_MAX): bigint {
  if (!value || !/^\d+$/.test(value)) die(`${label} must be an unsigned decimal integer.`);
  const parsed = BigInt(value);
  if (parsed > maximum) die(`${label} exceeds its on-chain integer range.`);
  return parsed;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    die(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function legacySignedOrders(paths: string[]): SignedOrderFile[] {
  if (paths.length < 2 || paths.length > 16) die("A batch requires 2 to 16 signed order files.");
  const files = paths.map(path => {
    try { return parseSignedOrder(readJson(path)); }
    catch (error) { die(`${path}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  const first = files[0]!;
  for (const file of files) {
    if (file.domain.chainId !== first.domain.chainId || file.domain.verifyingContract.toLowerCase() !== first.domain.verifyingContract.toLowerCase()) {
      die("All orders in a batch must use the same Hook and chain domain.");
    }
  }
  return files.sort((a, b) => hashOrder(parseNettingOrder(a.order)).localeCompare(hashOrder(parseNettingOrder(b.order))));
}

export function orderHash(order: NettingOrder): Hex { return hashOrder(order); }
export { serializeOrder };
export function decodeNettingRevert(error: unknown) { return decodeProtocolRevert(error); }
export function previewNettingOrders(orders: NettingOrder[]): BatchPreview { return previewBatch(orders); }

export function loadBatch(paths: string[]): { files: SignedOrderFile[]; orders: NettingOrder[]; signatures: Hex[] } {
  const files = legacySignedOrders(paths);
  for (let index = 1; index < files.length; index += 1) {
    if (hashOrder(parseNettingOrder(files[index - 1]!.order)) === hashOrder(parseNettingOrder(files[index]!.order))) {
      die(`Duplicate order hash at canonical index ${index}.`);
    }
  }
  return { files, orders: files.map(file => parseNettingOrder(file.order)), signatures: files.map(file => file.signature) };
}

function printPreview(preview: BatchPreview): void {
  console.log("ordering:                 orderHash ascending");
  console.log(`submitted gross:          ${(preview.total0 + preview.total1).toString()}`);
  console.log(`internally matched gross: ${preview.exposureReduction.toString()}`);
  console.log(`matched each side:        ${preview.matchedEachSide.toString()}`);
  console.log(`residual token0:          ${preview.residual0.toString()}`);
  console.log(`residual token1:          ${preview.residual1.toString()}`);
  console.log(`AMM exposure reduction:   ${preview.exposureReduction.toString()}`);
  console.log(`batchId:                  ${preview.batchId}`);
}

function legacyProtocolBatch(opts: {
  orders: string[]; router?: string; hook?: string; tokenA?: string; tokenB?: string;
  fee?: string; tickSpacing?: string; chain?: string; rpc?: string;
}): ILALBatch {
  const cfg = withConfig(opts);
  const files = legacySignedOrders(opts.orders);
  const chainId = Number(cfg.chain ?? files[0]!.domain.chainId);
  if (chainId !== files[0]!.domain.chainId) die("Configured chain does not match the signed order domain.");
  try {
    return buildBatch({
      chainId,
      router: requireAddress(cfg.router, "BatchRouter"),
      poolKey: {
        currency0: requireAddress(cfg.tokenA, "currency0 token"),
        currency1: requireAddress(cfg.tokenB, "currency1 token"),
        fee: Number(cfg.fee ?? "500"),
        tickSpacing: Number(cfg.tickSpacing ?? "10"),
        hooks: requireAddress(cfg.hook, "Hook"),
      },
      orders: files,
    });
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
}

export async function runNettingPreflight(opts: {
  orders: string[]; output?: string; router?: string; hook?: string; tokenA?: string; tokenB?: string;
  fee?: string; tickSpacing?: string; chain?: string; rpc?: string; from?: string;
}, emit = true): Promise<PreflightReport> {
  const cfg = withConfig(opts);
  const batch = legacyProtocolBatch(opts);
  const chain = CHAINS[String(batch.chainId)] ?? baseSepolia;
  const publicClient = createPublicClient({ chain, transport: cfg.rpc ? http(cfg.rpc) : http() });
  const report = await preflightBatch(publicClient, batch, { from: opts.from ? requireAddress(opts.from, "Preflight caller") : undefined });
  if (opts.output) writeFileSync(resolve(opts.output), `${JSON.stringify(report, null, 2)}\n`);
  if (emit) {
    header("Atomic netting preflight", `${batch.orders.length} orders`);
    printPreview(previewBatch(batch.orders));
    console.log(`snapshot:                 ${report.snapshot.blockNumber} (${report.snapshot.blockHash})`);
    console.log(`status:                   ${report.status}`);
    if (opts.output) log.ok(`Wrote ${resolve(opts.output)}`);
    if (report.decodedRevert) console.log(`rejection:                ${report.decodedRevert.selector ?? "unknown"} ${report.decodedRevert.message}`);
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
}): Promise<SignedNettingOrderResult> {
  const cfg = withConfig(opts);
  if (opts.zeroForOne === opts.oneForZero) die("Choose exactly one direction: --zero-for-one or --one-for-zero.");
  const hook = requireAddress(cfg.hook, "Hook");
  const chainId = Number(cfg.chain ?? "84532");
  const chain = CHAINS[String(chainId)] ?? baseSepolia;
  const clients = await createExecutionClients({ chain, rpc: cfg.rpc, legacyPrivateKey: opts.privateKey });
  const user = opts.user ? requireAddress(opts.user, "User") : clients.address;
  if (user.toLowerCase() !== clients.address.toLowerCase()) die("The selected signer must match --user; ERC-1271 order signing is wallet-specific and must be delegated externally.");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = opts.deadline ? uint(opts.deadline, "Deadline", (1n << 64n) - 1n) : now + uint(opts.ttl ?? "600", "TTL", (1n << 64n) - 1n);
  if (deadline <= now) die("Deadline must be in the future.");
  const nonce = opts.nonce ? requireBytes32(opts.nonce, "Nonce") : `0x${randomBytes(32).toString("hex")}` as Hex;
  const intent = createOrderIntent({
    domain: { chainId, verifyingContract: hook },
    order: {
      user,
      poolId: requireBytes32(cfg.pool ?? cfg.poolId, "Pool ID"),
      zeroForOne: Boolean(opts.zeroForOne),
      amountIn: uint(opts.amountIn, "Amount in"),
      minAmountOut: uint(opts.minAmountOut, "Minimum amount out"),
      maxAmmInput: uint(opts.maxAmmInput, "Maximum AMM input"),
      deadline,
      nonce,
    },
  });
  const file = await signOrder(intent, clients.walletClient);
  const output = resolve(opts.output);
  writeFileSync(output, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  const hash = hashOrder(parseNettingOrder(file.order));
  header("Netting order signed", Boolean(opts.zeroForOne) ? "token0 → token1" : "token1 → token0");
  log.ok(`Wrote ${output}`);
  console.log(`orderHash: ${hash}`);
  console.log(`nonce:     ${nonce}`);
  return { output, orderHash: hash, nonce, file };
}

export function previewNettingOrderFiles(paths: string[]): BatchPreview {
  const preview = previewBatch(legacySignedOrders(paths));
  if (preview.total0 === 0n || preview.total1 === 0n) die("Batch must contain at least one order in each direction.");
  return preview;
}

export async function nettingBatchPreview(opts: { orders: string[] }): Promise<void> {
  const preview = previewNettingOrderFiles(opts.orders);
  header("Atomic netting preview", `${preview.orderCount} orders`);
  printPreview(preview);
}

export async function nettingBatchExecute(opts: {
  orders: string[]; router?: string; hook?: string; tokenA?: string; tokenB?: string;
  fee?: string; tickSpacing?: string; chain?: string; rpc?: string; privateKey?: string; from?: string;
}): Promise<void> {
  const cfg = withConfig(opts);
  const batch = legacyProtocolBatch(opts);
  const chain = CHAINS[String(batch.chainId)] ?? baseSepolia;
  const publicClient = createPublicClient({ chain, transport: cfg.rpc ? http(cfg.rpc) : http() });
  const initialPreflight = await preflightBatch(publicClient, batch, { from: opts.from ? requireAddress(opts.from, "Preflight caller") : undefined });
  if (initialPreflight.status !== "executable") throw new SettlementRejectedError(initialPreflight);
  const clients = await createExecutionClients({ chain, rpc: cfg.rpc, legacyPrivateKey: opts.privateKey });
  const result = await executeBatch({ publicClient: clients.publicClient, walletClient: clients.walletClient, account: clients.account, batch });
  header("Executing atomic netting batch", `${batch.orders.length} orders`);
  printPreview(previewBatch(batch.orders));
  console.log(`transaction hash: ${result.hash}`);
  for (const order of result.receipt.orders) console.log(`OrderSettled: ${JSON.stringify(order.settlement)}`);
  console.log(`BatchExecuted: ${JSON.stringify(result.receipt.batch.summary)}`);
}

export async function nettingNonceCancel(opts: { nonce: string; hook?: string; chain?: string; rpc?: string; privateKey?: string }): Promise<void> {
  const cfg = withConfig(opts);
  const hook = requireAddress(cfg.hook, "Hook");
  const nonce = requireBytes32(opts.nonce, "Nonce");
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const { account, publicClient, walletClient } = await createExecutionClients({ chain, rpc: cfg.rpc, legacyPrivateKey: opts.privateKey });
  const hash = await walletClient.writeContract({ account, address: hook, abi: NETTING_HOOK_ABI, functionName: "cancelNonce", args: [nonce], chain });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") die(`Nonce cancellation reverted: ${hash}`);
  log.ok(`Nonce cancelled: ${nonce}`);
  console.log(`transaction hash: ${hash}`);
}
