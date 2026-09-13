import {
  buildBatch,
  createOrderIntent,
  executeBatch,
  hashOrder,
  inspectSettlement,
  parseBatch,
  parseNettingOrder,
  parseOrderIntent,
  parseSignedOrder,
  preflightBatch,
  previewBatch,
  signOrder,
  SettlementRejectedError,
  type ILALBatch,
  type SettlementReceipt,
} from "@ilalv3/protocol";
import { createPublicClient, getAddress, http, isAddress, type Address, type Chain, type Hex } from "viem";
import { base, baseSepolia } from "viem/chains";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { artifactJson, ensureWritable, writeArtifact } from "../artifacts.js";
import { withConfig } from "../config.js";
import { createExecutionClients } from "../signer.js";
import { die } from "../ui.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };
const UINT128_MAX = (1n << 128n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;

interface OutputOptions { output?: string; json?: boolean; force?: boolean }

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(resolve(path), "utf8")); }
  catch (error) { die(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`); }
}

function address(value: string | undefined, label: string): Address {
  if (!value || !isAddress(value)) die(`${label} must be a valid address.`);
  return getAddress(value);
}

function bytes32(value: string | undefined, label: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) die(`${label} must be 32-byte hex.`);
  return value.toLowerCase() as Hex;
}

function uint(value: string | undefined, label: string, maximum: bigint): bigint {
  if (!value || !/^\d+$/.test(value)) die(`${label} must be an unsigned decimal integer.`);
  const parsed = BigInt(value);
  if (parsed > maximum) die(`${label} exceeds its on-chain integer range.`);
  return parsed;
}

function chainFor(chainId: number): Chain { return CHAINS[String(chainId)] ?? { ...baseSepolia, id: chainId }; }

function emit(value: unknown, options: OutputOptions, lines: string[]): void {
  if (options.json) process.stdout.write(artifactJson(value));
  else for (const line of lines) process.stderr.write(`${line}\n`);
}

function batchLines(batch: ILALBatch): string[] {
  return [
    `batchId: ${batch.batchId}`,
    `orders: ${batch.summary.orderCount}`,
    `submitted: token0=${batch.summary.total0} token1=${batch.summary.total1}`,
    `matched each side: ${batch.summary.matchedEachSide}`,
    `residual: token0=${batch.summary.residual0} token1=${batch.summary.residual1}`,
  ];
}

function receiptLines(receipt: SettlementReceipt): string[] {
  return [
    `transaction: ${receipt.transaction.hash}`,
    `receiptId: ${receipt.receiptId}`,
    `batchId: ${receipt.batch.batchId}`,
    `matched each side: ${receipt.batch.summary.matchedEachSide}`,
    `residual: token0=${receipt.batch.summary.residual0} token1=${receipt.batch.summary.residual1}`,
  ];
}

export async function orderCreate(opts: {
  user: string; pool?: string; hook?: string; amountIn: string; minAmountOut: string; maxAmmInput: string;
  zeroForOne?: boolean; oneForZero?: boolean; deadline?: string; ttl?: string; nonce?: string; chain?: string;
} & Required<Pick<OutputOptions, "output">> & OutputOptions): Promise<void> {
  const cfg = withConfig(opts);
  if (opts.zeroForOne === opts.oneForZero) die("Choose exactly one direction: --zero-for-one or --one-for-zero.");
  const now = BigInt(Math.floor(Date.now() / 1000));
  const deadline = opts.deadline ? uint(opts.deadline, "Deadline", UINT64_MAX) : now + uint(opts.ttl ?? "600", "TTL", UINT64_MAX);
  if (deadline <= now) die("Deadline must be in the future.");
  const intent = createOrderIntent({
    domain: { chainId: Number(cfg.chain ?? "84532"), verifyingContract: address(cfg.hook, "Hook") },
    order: {
      user: address(opts.user, "User"),
      poolId: bytes32(cfg.pool ?? cfg.poolId, "Pool ID"),
      zeroForOne: Boolean(opts.zeroForOne),
      amountIn: uint(opts.amountIn, "Amount in", UINT128_MAX),
      minAmountOut: uint(opts.minAmountOut, "Minimum amount out", UINT128_MAX),
      maxAmmInput: uint(opts.maxAmmInput, "Maximum AMM input", UINT128_MAX),
      deadline,
      nonce: opts.nonce ? bytes32(opts.nonce, "Nonce") : `0x${randomBytes(32).toString("hex")}` as Hex,
    },
  });
  const output = writeArtifact(opts.output, intent, opts.force);
  emit(intent, opts, [`Order intent created: ${output}`, `orderHash: ${hashOrder(parseNettingOrder(intent.order))}`]);
}

export async function orderSign(input: string, opts: { rpc?: string } & Required<Pick<OutputOptions, "output">> & OutputOptions): Promise<void> {
  const intent = parseOrderIntent(readJson(input));
  const cfg = withConfig(opts);
  const chain = chainFor(intent.domain.chainId);
  const clients = await createExecutionClients({ chain, rpc: cfg.rpc });
  const order = parseNettingOrder(intent.order);
  if (clients.address.toLowerCase() !== order.user.toLowerCase()) die(`Selected signer ${clients.address} does not match order user ${order.user}.`);
  const signed = await signOrder(intent, clients.walletClient);
  const output = writeArtifact(opts.output, signed, opts.force);
  emit(signed, opts, [`Order signed: ${output}`, `orderHash: ${hashOrder(order)}`]);
}

export async function batchBuild(opts: {
  orders: string[]; router?: string; hook?: string; tokenA?: string; tokenB?: string;
  fee?: string; tickSpacing?: string; chain?: string;
} & Required<Pick<OutputOptions, "output">> & OutputOptions): Promise<void> {
  const cfg = withConfig(opts);
  const orders = opts.orders.map(path => parseSignedOrder(readJson(path)));
  const chainId = Number(cfg.chain ?? orders[0]?.domain.chainId ?? "84532");
  const batch = buildBatch({
    chainId,
    router: address(cfg.router, "BatchRouter"),
    poolKey: {
      currency0: address(cfg.tokenA, "currency0 token"),
      currency1: address(cfg.tokenB, "currency1 token"),
      fee: Number(cfg.fee ?? "500"),
      tickSpacing: Number(cfg.tickSpacing ?? "10"),
      hooks: address(cfg.hook, "Hook"),
    },
    orders,
  });
  const output = writeArtifact(opts.output, batch, opts.force);
  emit(batch, opts, [`Batch built: ${output}`, ...batchLines(batch)]);
}

export async function batchPreview(input: string, opts: OutputOptions): Promise<void> {
  const batch = parseBatch(readJson(input));
  emit(batch.summary, opts, batchLines(batch));
}

export async function batchPreflight(input: string, opts: { rpc?: string; from?: string } & Required<Pick<OutputOptions, "output">> & OutputOptions): Promise<void> {
  const batch = parseBatch(readJson(input));
  const cfg = withConfig(opts);
  const publicClient = createPublicClient({ chain: chainFor(batch.chainId), transport: cfg.rpc ? http(cfg.rpc) : http() });
  const report = await preflightBatch(publicClient, batch, { from: opts.from ? address(opts.from, "Preflight caller") : undefined });
  const output = writeArtifact(opts.output, report, opts.force);
  emit(report, opts, [`Preflight ${report.status}: ${output}`, `snapshot: ${report.snapshot.blockNumber} (${report.snapshot.blockHash})`, ...batchLines(batch)]);
  process.exitCode = report.status === "executable" ? 0 : report.status === "rejected" ? 2 : 1;
}

export async function batchExecute(input: string, opts: { rpc?: string; receipt?: string; json?: boolean; force?: boolean }): Promise<void> {
  const batch = parseBatch(readJson(input));
  const cfg = withConfig(opts);
  if (opts.receipt) ensureWritable(opts.receipt, opts.force);
  const chain = chainFor(batch.chainId);
  const publicClient = createPublicClient({ chain, transport: cfg.rpc ? http(cfg.rpc) : http() });
  const initialPreflight = await preflightBatch(publicClient, batch);
  if (initialPreflight.status !== "executable") throw new SettlementRejectedError(initialPreflight);
  const clients = await createExecutionClients({ chain, rpc: cfg.rpc });
  const result = await executeBatch({ publicClient: clients.publicClient, walletClient: clients.walletClient, account: clients.account, batch });
  const output = writeArtifact(opts.receipt ?? `receipt-${result.hash}.json`, result.receipt, opts.force);
  emit(result.receipt, opts, [`Settlement receipt written: ${output}`, ...receiptLines(result.receipt)]);
}

export async function settlementInspect(transactionHash: string, opts: { chain?: string; rpc?: string } & OutputOptions): Promise<void> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) die("Transaction hash must be 32-byte hex.");
  const cfg = withConfig(opts);
  const chainId = Number(cfg.chain ?? "84532");
  const publicClient = createPublicClient({ chain: chainFor(chainId), transport: cfg.rpc ? http(cfg.rpc) : http() });
  const receipt = await inspectSettlement(publicClient, transactionHash as Hex);
  let lines = receiptLines(receipt);
  if (opts.output) {
    const output = writeArtifact(opts.output, receipt, opts.force);
    lines = [`Settlement receipt written: ${output}`, ...lines];
  }
  emit(receipt, opts, lines);
}
