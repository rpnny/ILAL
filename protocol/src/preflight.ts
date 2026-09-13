import {
  getAddress,
  serializeTransaction,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {
  ERC20_PREFLIGHT_ABI,
  GAS_PRICE_ORACLE_ABI,
  NETTING_HOOK_ABI,
  NETTING_ROUTER_ABI,
  ORACLE_GUARD_ABI,
} from "./abis.js";
import { batchExecutionArgs, encodeBatchExecution, parseBatch, type ILALBatch } from "./batch.js";
import { decodeProtocolRevert, isNamedProtocolRevert } from "./errors.js";
import { parseNettingOrder } from "./order.js";

const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const DEFAULT_CALLER = "0x0000000000000000000000000000000000000001" as Address;
const BASE_GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F" as Address;

export interface PreflightReport {
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
  oracle: {
    guard: Address | null;
    provider: "chainlink-data-feeds";
    enforcement: "hook-hard-gate";
    feed0: Address | null; feed1: Address | null;
    price0Wad: string | null; price1Wad: string | null;
    updatedAt0: string | null; updatedAt1: string | null;
    maxAge0: string | null; maxAge1: string | null;
    maxUsdDeviationBps: string | null; maxPairDeviationBps: string | null;
    sequencerUptimeFeed: Address | null; sequencerGracePeriod: string | null;
    sequencerCheckEnabled: boolean | null;
    status: "valid" | "rejected" | "unavailable";
  } | null;
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

type Client = PublicClient | any;

function isRpcFailure(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    const name = String(value["name"] ?? "");
    const message = String(value["shortMessage"] ?? value["message"] ?? "");
    if (/HttpRequest|RpcRequest|Timeout|Network|Socket|WebSocket|Transport|Fetch/i.test(name)
      || /\bRPC\b|network|fetch failed|timed? out|ECONN|socket|HTTP request/i.test(message)) return true;
    current = value["cause"];
  }
  return false;
}

function baseReport(batch: ILALBatch): Pick<PreflightReport, "format" | "generatedAt" | "chainId" | "batch" | "pool" | "warning"> {
  return {
    format: "ilal-netting-preflight-v1",
    generatedAt: new Date().toISOString(),
    chainId: batch.chainId,
    batch: { batchId: batch.batchId, ...batch.summary },
    pool: {
      poolId: parseNettingOrder(batch.orders[0]!.order).poolId,
      router: batch.router,
      hook: batch.poolKey.hooks,
      poolManager: DEFAULT_CALLER,
      currency0: batch.poolKey.currency0,
      currency1: batch.poolKey.currency1,
      fee: batch.poolKey.fee,
      tickSpacing: batch.poolKey.tickSpacing,
      poolManagerBalances: { currency0: "0", currency1: "0" },
    },
    warning: "Preflight is a state snapshot. Signed limits and atomic rollback remain the final safety controls.",
  };
}

export async function preflightBatch(publicClient: Client, batchValue: ILALBatch, options: { from?: Address } = {}): Promise<PreflightReport> {
  const batch = parseBatch(batchValue);
  const base = baseReport(batch);
  const checks: PreflightReport["checks"] = [];
  let block: any;
  try {
    const rpcChainId = await publicClient.getChainId();
    if (rpcChainId !== batch.chainId) throw new Error(`RPC chain mismatch: expected ${batch.chainId}, got ${rpcChainId}.`);
    block = await publicClient.getBlock({ blockTag: "latest" });
  } catch (error) {
    return {
      ...base,
      snapshot: { blockNumber: "0", blockHash: ZERO_HASH, timestamp: "0" },
      oracle: null,
      checks,
      fees: { estimatedExecutionGas: null, gasPriceWei: null, l2ExecutionFeeWei: null, l1SecurityFeeWei: null, estimatedTotalFeeWei: null, model: "Base L2 execution plus GasPriceOracle.getL1Fee(serialized transaction)" },
      status: "rpc-error",
      decodedRevert: decodeProtocolRevert(error),
    };
  }

  const blockNumber = block.number as bigint;
  const now = block.timestamp as bigint;
  const caller = options.from ? getAddress(options.from) : DEFAULT_CALLER;
  const callData = encodeBatchExecution(batch);
  let poolManager = DEFAULT_CALLER;
  let managerBalance0 = 0n;
  let managerBalance1 = 0n;
  let estimatedGas: bigint | null = null;
  let gasPrice: bigint | null = null;
  let l1Fee: bigint | null = null;
  let decodedRevert: PreflightReport["decodedRevert"] = null;
  let simulationPassed = false;
  let rpcFailure = false;
  let oracle: PreflightReport["oracle"] = null;

  try {
    poolManager = await publicClient.readContract({ address: batch.router, abi: NETTING_ROUTER_ABI, functionName: "poolManager", blockNumber });
    [managerBalance0, managerBalance1] = await Promise.all([
      publicClient.readContract({ address: batch.poolKey.currency0, abi: ERC20_PREFLIGHT_ABI, functionName: "balanceOf", args: [poolManager], blockNumber }),
      publicClient.readContract({ address: batch.poolKey.currency1, abi: ERC20_PREFLIGHT_ABI, functionName: "balanceOf", args: [poolManager], blockNumber }),
    ]);
    checks.push({ name: "opposite-directions", ok: BigInt(batch.summary.total0) > 0n && BigInt(batch.summary.total1) > 0n, detail: `total0=${batch.summary.total0}; total1=${batch.summary.total1}` });
    checks.push({ name: "hook-domain", ok: true, detail: batch.poolKey.hooks });

    try {
      const guard = await publicClient.readContract({ address: batch.poolKey.hooks, abi: NETTING_HOOK_ABI, functionName: "oracleGuard", blockNumber }) as Address;
      const [feed0, feed1, maxAge0, maxAge1, maxUsdDeviationBps, maxPairDeviationBps, sequencerUptimeFeed, sequencerGracePeriod] = await Promise.all([
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "feed0", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "feed1", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "maxAge0", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "maxAge1", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "maxUsdDeviationBps", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "maxPairDeviationBps", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "sequencerUptimeFeed", blockNumber }),
        publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "sequencerGracePeriod", blockNumber }),
      ]) as [Address, Address, bigint, bigint, bigint, bigint, Address, bigint];
      oracle = {
        guard: getAddress(guard), provider: "chainlink-data-feeds", enforcement: "hook-hard-gate",
        feed0: getAddress(feed0), feed1: getAddress(feed1), price0Wad: null, price1Wad: null,
        updatedAt0: null, updatedAt1: null, maxAge0: maxAge0.toString(), maxAge1: maxAge1.toString(),
        maxUsdDeviationBps: maxUsdDeviationBps.toString(), maxPairDeviationBps: maxPairDeviationBps.toString(),
        sequencerUptimeFeed: sequencerUptimeFeed.toLowerCase() === zeroAddress ? null : getAddress(sequencerUptimeFeed),
        sequencerGracePeriod: sequencerGracePeriod.toString(), sequencerCheckEnabled: sequencerUptimeFeed.toLowerCase() !== zeroAddress,
        status: "unavailable",
      };
      try {
        const snapshot = await publicClient.readContract({ address: guard, abi: ORACLE_GUARD_ABI, functionName: "validate", blockNumber }) as any;
        oracle.price0Wad = snapshot.price0Wad.toString();
        oracle.price1Wad = snapshot.price1Wad.toString();
        oracle.updatedAt0 = snapshot.updatedAt0.toString();
        oracle.updatedAt1 = snapshot.updatedAt1.toString();
        oracle.sequencerCheckEnabled = snapshot.sequencerCheckEnabled;
        oracle.status = "valid";
        checks.push({ name: "chainlink-oracle-guard", ok: true, detail: `price0Wad=${snapshot.price0Wad}; price1Wad=${snapshot.price1Wad}; updatedAt0=${snapshot.updatedAt0}; updatedAt1=${snapshot.updatedAt1}` });
      } catch (error) {
        const decoded = decodeProtocolRevert(error);
        rpcFailure ||= isRpcFailure(error);
        oracle.status = isNamedProtocolRevert(decoded.selector) ? "rejected" : "unavailable";
        checks.push({ name: "chainlink-oracle-guard", ok: false, detail: decoded.message });
      }
    } catch (error) {
      const decoded = decodeProtocolRevert(error);
      rpcFailure ||= isRpcFailure(error);
      oracle = {
        guard: null, provider: "chainlink-data-feeds", enforcement: "hook-hard-gate", feed0: null, feed1: null,
        price0Wad: null, price1Wad: null, updatedAt0: null, updatedAt1: null, maxAge0: null, maxAge1: null,
        maxUsdDeviationBps: null, maxPairDeviationBps: null, sequencerUptimeFeed: null, sequencerGracePeriod: null,
        sequencerCheckEnabled: null, status: isNamedProtocolRevert(decoded.selector) ? "rejected" : "unavailable",
      };
      checks.push({ name: "chainlink-oracle-guard", ok: false, detail: decoded.message });
    }

    const execution = batchExecutionArgs(batch);
    for (let index = 0; index < execution.orders.length; index += 1) {
      const order = execution.orders[index]!;
      const inputToken = order.zeroForOne ? batch.poolKey.currency0 : batch.poolKey.currency1;
      const [balance, allowance, nonceUsed] = await Promise.all([
        publicClient.readContract({ address: inputToken, abi: ERC20_PREFLIGHT_ABI, functionName: "balanceOf", args: [order.user], blockNumber }),
        publicClient.readContract({ address: inputToken, abi: ERC20_PREFLIGHT_ABI, functionName: "allowance", args: [order.user, batch.router], blockNumber }),
        publicClient.readContract({ address: batch.poolKey.hooks, abi: NETTING_HOOK_ABI, functionName: "nonceUsed", args: [order.user, order.nonce], blockNumber }),
      ]) as [bigint, bigint, boolean];
      checks.push({ name: "deadline", orderIndex: index, ok: order.deadline >= now, detail: `deadline=${order.deadline}; blockTimestamp=${now}` });
      checks.push({ name: "nonce-unused", orderIndex: index, ok: !nonceUsed, detail: `nonce=${order.nonce}` });
      checks.push({ name: "balance", orderIndex: index, ok: balance >= order.amountIn, detail: `balance=${balance}; required=${order.amountIn}` });
      checks.push({ name: "allowance", orderIndex: index, ok: allowance >= order.amountIn, detail: `allowance=${allowance}; required=${order.amountIn}` });
    }

    await publicClient.call({ account: caller, to: batch.router, data: callData, blockNumber });
    simulationPassed = true;
    checks.push({ name: "full-execution-eth-call", ok: true, detail: "executeBatch completed against the pinned state snapshot; signatures and policy were validated on-chain" });
    estimatedGas = await publicClient.estimateGas({ account: caller, to: batch.router, data: callData, blockNumber });
    gasPrice = await publicClient.getGasPrice();
    if (batch.chainId === 8453 || batch.chainId === 84532) {
      const serialized = serializeTransaction({ chainId: batch.chainId, gas: estimatedGas!, gasPrice: gasPrice!, nonce: 0, to: batch.router, data: callData, value: 0n }, { r: `0x${"01".repeat(32)}`, s: `0x${"02".repeat(32)}`, v: 27n });
      l1Fee = await publicClient.readContract({ address: BASE_GAS_PRICE_ORACLE, abi: GAS_PRICE_ORACLE_ABI, functionName: "getL1Fee", args: [serialized], blockNumber });
    }
  } catch (error) {
    rpcFailure ||= isRpcFailure(error);
    decodedRevert = decodeProtocolRevert(error);
    checks.push({ name: "full-execution-eth-call", ok: false, detail: decodedRevert.message });
  }

  const l2Fee = estimatedGas !== null && gasPrice !== null ? estimatedGas * gasPrice : null;
  const totalFee = l2Fee !== null ? l2Fee + (l1Fee ?? 0n) : null;
  const status = rpcFailure ? "rpc-error" : simulationPassed && checks.every(check => check.ok) ? "executable" : "rejected";
  return {
    ...base,
    snapshot: { blockNumber: blockNumber.toString(), blockHash: block.hash, timestamp: now.toString() },
    pool: { ...base.pool, poolManager: getAddress(poolManager), poolManagerBalances: { currency0: managerBalance0.toString(), currency1: managerBalance1.toString() } },
    oracle,
    checks,
    fees: {
      estimatedExecutionGas: estimatedGas?.toString() ?? null,
      gasPriceWei: gasPrice?.toString() ?? null,
      l2ExecutionFeeWei: l2Fee?.toString() ?? null,
      l1SecurityFeeWei: l1Fee?.toString() ?? null,
      estimatedTotalFeeWei: totalFee?.toString() ?? null,
      model: "Base L2 execution plus GasPriceOracle.getL1Fee(serialized transaction)",
    },
    status,
    decodedRevert,
  };
}
