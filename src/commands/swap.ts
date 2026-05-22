/**
 * swap.ts — `ilal swap`
 *
 * Execute a compliant token swap through the ILAL channel.
 *
 * Signs a fresh SessionToken internally, then calls ILALRouter.swap()
 * on-chain.  The ComplianceHook verifies the session + CNF credential
 * before the swap is executed.
 *
 * Usage:
 *   ilal swap \
 *     --amount-in 100 \
 *     --token-in  0xTOKA \
 *     --zero-for-one \
 *     --router    0xROUTER \
 *     --hook      0xHOOK \
 *     --issuer    0xISSUER \
 *     --pool-id   0xPOOLID \
 *     --chain     84532
 */

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  isAddress,
  isHex,
  parseAbiParameters,
  parseUnits,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, die, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  { name: "decimals",   type: "function" as const, stateMutability: "view" as const,       inputs: [], outputs: [{ type: "uint8" as const }] },
  { name: "symbol",     type: "function" as const, stateMutability: "view" as const,       inputs: [], outputs: [{ type: "string" as const }] },
  { name: "balanceOf",  type: "function" as const, stateMutability: "view" as const,       inputs: [{ name: "owner", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "allowance",  type: "function" as const, stateMutability: "view" as const,       inputs: [{ name: "owner", type: "address" as const }, { name: "spender", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "approve",    type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "spender", type: "address" as const }, { name: "amount", type: "uint256" as const }], outputs: [{ type: "bool" as const }] },
] as const;

const ROUTER_ABI = [
  { name: "protocolFeePips", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint24" as const }] },
  { name: "treasury", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  {
    name: "swap", type: "function" as const, stateMutability: "payable" as const,
    inputs: [
      { name: "key", type: "tuple" as const, components: [
        { name: "currency0",   type: "address" as const },
        { name: "currency1",   type: "address" as const },
        { name: "fee",         type: "uint24" as const  },
        { name: "tickSpacing", type: "int24" as const   },
        { name: "hooks",       type: "address" as const },
      ]},
      { name: "params", type: "tuple" as const, components: [
        { name: "zeroForOne",        type: "bool" as const    },
        { name: "amountSpecified",   type: "int256" as const  },
        { name: "sqrtPriceLimitX96", type: "uint160" as const },
      ]},
      { name: "minAmountOut", type: "uint256" as const },
      { name: "hookData", type: "bytes" as const },
    ],
    outputs: [{ name: "delta", type: "int256" as const }],
  },
] as const;

// ─── Session helpers ──────────────────────────────────────────────────────────

const SESSION_TOKEN_TYPE = [
  { name: "user",          type: "address" },
  { name: "authorizedCaller", type: "address" },
  { name: "cnfIssuer",     type: "address" },
  { name: "chainId",       type: "uint256" },
  { name: "verifyingHook", type: "address" },
  { name: "poolId",        type: "bytes32" },
  { name: "action",        type: "uint8"   },
  { name: "deadline",      type: "uint64"  },
  { name: "nonce",         type: "bytes32" },
] as const;

const HOOK_DATA_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, address cnfIssuer, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

// sqrtPriceLimitX96 — use min/max to let the swap fill fully
const MIN_SQRT_PRICE = 4295128740n;        // TickMath.MIN_SQRT_PRICE + 1
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970341n; // MAX - 1
const DYNAMIC_FEE_FLAG = 8388608;
const PIPS_DENOMINATOR = 1_000_000n;

function txUrl(chain: Chain, hash: `0x${string}`): string | undefined {
  const baseUrl = chain.blockExplorers?.default?.url;
  return baseUrl ? `${baseUrl}/tx/${hash}` : undefined;
}

function feeLabel(fee: number): string {
  if (fee === DYNAMIC_FEE_FLAG) return `${fmt.badge("fair flow", "green")} verified swap fee 0.05%`;
  return `${fmt.badge("static", "gray")} ${(fee / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function pipsToPercent(pips: number): string {
  return `${(pips / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

function poolFeePercent(fee: number): string {
  return fee === DYNAMIC_FEE_FLAG
    ? "0.05%"
    : `${(fee / 10_000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}%`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function swap(opts: {
  amountIn:      string;
  minAmountOut?: string;  // optional slippage floor in token-out human units
  tokenIn?:      string;
  zeroForOne?:   boolean;
  poolId?:       string;
  router?:       string;
  hook?:         string;
  issuer?:       string;
  tokenA?:       string;
  tokenB?:       string;
  fee?:          string;
  tickSpacing?:  string;
  chain?:        string;
  rpc?:          string;
  privateKey?:   string;
  ttl?:          string;
  simulate?:     boolean;
}) {
  const cfg    = withConfig(opts);
  const rawKey = cfg.privateKey ?? process.env["PRIVATE_KEY"];
  if (!rawKey)       die("Private key required. Use --private-key or set PRIVATE_KEY env var.");
  if (!cfg.router)   die("ILALRouter address required. Use --router or set in .ilal.json");
  if (!cfg.hook)     die("ComplianceHook address required. Use --hook or set in .ilal.json");
  if (!cfg.issuer)   die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!cfg.poolId)   die("Pool ID required. Use --pool-id or set in .ilal.json");

  if (!isAddress(cfg.router!))  die(`Invalid router address: ${cfg.router}`);
  if (!isAddress(cfg.hook!))    die(`Invalid hook address: ${cfg.hook}`);
  if (!isAddress(cfg.issuer!))  die(`Invalid issuer address: ${cfg.issuer}`);
  if (!isHex(cfg.poolId!) || cfg.poolId!.length !== 66) die("poolId must be 0x + 64 hex chars");

  const chain     = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const account   = privateKeyToAccount(rawKey as `0x${string}`);
  const transport = cfg.rpc ? http(cfg.rpc) : http();
  const pubClient = createPublicClient({ chain, transport });
  const walClient = createWalletClient({ account, chain, transport });

  // Determine token order
  const tokenA = (cfg.tokenA ?? opts.tokenA) as `0x${string}` | undefined;
  const tokenB = (cfg.tokenB ?? opts.tokenB) as `0x${string}` | undefined;
  if (!tokenA || !tokenB) die("Token addresses required. Use --token-a/--token-b or set in .ilal.json");

  // currency0 < currency1
  const c0 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenA : tokenB;
  const c1 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenB : tokenA;

  const tokenIn = (opts.tokenIn ?? tokenA) as `0x${string}`;
  if (!isAddress(tokenIn)) die(`Invalid token-in address: ${tokenIn}`);

  const zeroForOne = tokenIn.toLowerCase() === c0.toLowerCase();

  header("ILAL Swap", chain.name);
  log.kv("router",  fmt.cyan(cfg.router!));
  log.kv("hook",    fmt.cyan(cfg.hook!));
  log.kv("pool",    fmt.gray(cfg.poolId!.slice(0, 18) + "…"));
  log.kv("tokenIn", fmt.cyan(tokenIn));
  log.kv("direction", zeroForOne ? "currency0 → currency1" : "currency1 → currency0");
  log.line();

  // Fetch token decimals + symbol
  const spin = new Spinner("Fetching token info…").start();
  const [decimals, symbol] = await Promise.all([
    pubClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    pubClient.readContract({ address: tokenIn, abi: ERC20_ABI, functionName: "symbol"   }) as Promise<string>,
  ]);
  spin.stop();

  const amountIn = parseUnits(opts.amountIn, decimals);
  log.kv("amount", `${opts.amountIn} ${fmt.cyan(symbol)} (${amountIn.toString()} wei)`);
  let protocolFeePips = 0;
  let treasury: string | undefined;
  try {
    [protocolFeePips, treasury] = await Promise.all([
      pubClient.readContract({ address: cfg.router as `0x${string}`, abi: ROUTER_ABI, functionName: "protocolFeePips" }) as Promise<number>,
      pubClient.readContract({ address: cfg.router as `0x${string}`, abi: ROUTER_ABI, functionName: "treasury" }) as Promise<string>,
    ]);
  } catch {
    protocolFeePips = 0;
  }
  const protocolFeeAmount = amountIn * BigInt(protocolFeePips) / PIPS_DENOMINATOR;
  const totalDebit = amountIn + protocolFeeAmount;
  log.deal([
    { label: "verified input", value: `${opts.amountIn} ${symbol}`, note: "exact-in swap", tone: "cyan" },
    { label: "LP fee", value: poolFeePercent(parseInt(cfg.fee ?? "3000")), note: "hook-priced flow", tone: "green" },
    { label: "ILAL fee", value: protocolFeePips > 0 ? pipsToPercent(protocolFeePips) : "off", note: protocolFeePips > 0 ? "protocol revenue" : "legacy router", tone: protocolFeePips > 0 ? "cyan" : "gray" },
  ]);
  log.line();

  // Check allowance — approve if needed
  const approveSpin = new Spinner("Checking allowance…").start();
  const allowed = await pubClient.readContract({
    address: tokenIn,
    abi:     ERC20_ABI,
    functionName: "allowance",
    args:    [account.address, cfg.router as `0x${string}`],
  }) as bigint;

  if (allowed < totalDebit) {
    approveSpin.update(`Approving ${symbol} for ILALRouter…`);
    const approveHash = await walClient.writeContract({
      address:      tokenIn,
      abi:          ERC20_ABI,
      functionName: "approve",
      args:         [cfg.router as `0x${string}`, totalDebit * 10n], // approve 10× for future swaps
    });
    await pubClient.waitForTransactionReceipt({ hash: approveHash });
    approveSpin.succeed(`Approved ${symbol} ${fmt.gray(fmt.hash(approveHash))}`);
  } else {
    approveSpin.succeed(`Allowance ok (${fmt.gray(allowed.toString())} wei)`);
  }

  // Sign session token
  const signSpin = new Spinner("Signing session token…").start();
  const ttl      = parseInt(opts.ttl ?? "600");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ttl);
  const nonce    = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as `0x${string}`;

  const token = {
    user:          account.address as `0x${string}`,
    authorizedCaller: cfg.router as `0x${string}`,
    cnfIssuer:     cfg.issuer as `0x${string}`,
    chainId:       BigInt(chain.id),
    verifyingHook: cfg.hook as `0x${string}`,
    poolId:        cfg.poolId as `0x${string}`,
    action:        1 as const, // ACTION_SWAP
    deadline,
    nonce,
  };

  const signature = await walClient.signTypedData({
    account,
    domain: {
      name:              "ILAL ComplianceHook",
      version:           "1",
      chainId:           BigInt(chain.id),
      verifyingContract: cfg.hook as `0x${string}`,
    },
    types:       { SessionToken: SESSION_TOKEN_TYPE },
    primaryType: "SessionToken",
    message:     token,
  });

  const hookData = encodeAbiParameters(HOOK_DATA_ABI, [token, signature]);
  signSpin.succeed(`Session signed (expires in ${ttl}s)`);
  const fee         = parseInt(cfg.fee ?? "3000");
  const tickSpacing = parseInt(cfg.tickSpacing ?? "60");

  log.section("Gate Checks");
  log.kv("credential", `${fmt.badge("required", "cyan")} issuer ${fmt.addr(cfg.issuer!)}`);
  log.kv("caller", `${fmt.badge("bound", "green")} ${fmt.addr(cfg.router!)}`);
  log.kv("nonce", `${fmt.badge("fresh", "green")} ${fmt.hash(nonce)}`);
  log.kv("fee", feeLabel(fee));
  if (protocolFeePips > 0) {
    log.kv("protocol fee", `${fmt.badge("ILAL", "cyan")} ${pipsToPercent(protocolFeePips)} to ${treasury ? fmt.addr(treasury) : "treasury"}`);
    log.kv("total debit", `${totalDebit.toString()} wei (${symbol} input + ILAL fee)`);
  }
  log.line();

  if (opts.simulate) {
    log.ok("Simulation mode — skipping on-chain tx");
    log.kv("hookData", hookData.slice(0, 22) + "…");
    console.log();
    return;
  }

  // Build PoolKey
  const poolKey = {
    currency0:   c0 as `0x${string}`,
    currency1:   c1 as `0x${string}`,
    fee,
    tickSpacing,
    hooks:       cfg.hook as `0x${string}`,
  };

  const swapParams = {
    zeroForOne,
    amountSpecified:   -amountIn,   // negative = exactIn
    sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE : MAX_SQRT_PRICE,
  };

  // Slippage: parse --min-amount-out if provided (0 = disabled)
  // We don't know the tokenOut decimals here without another RPC call,
  // so we accept wei (raw bigint) from the flag.  The CLI documents this.
  const minAmountOut = opts.minAmountOut ? BigInt(opts.minAmountOut) : 0n;
  if (minAmountOut > 0n) {
    log.kv("min-amount-out", `${fmt.cyan(minAmountOut.toString())} wei (slippage protection on)`);
  }

  // Execute swap
  const txSpin = new Spinner("Sending swap tx…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      address:      cfg.router as `0x${string}`,
      abi:          ROUTER_ABI,
      functionName: "swap",
      args:         [poolKey, swapParams, minAmountOut, hookData],
      value:        0n,
    });
    txSpin.update(`Confirming ${fmt.gray(fmt.hash(txHash))}…`);
    const receipt = await pubClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      txSpin.fail("Transaction reverted");
      die(`Tx failed: ${txHash}`);
    }
    txSpin.succeed(fmt.bold(fmt.green(`Swap executed via ILAL channel ✓`)));
  } catch (e) {
    txSpin.fail("Swap failed");
    dieOnContract(e);
  }

  log.line();
  log.callout("Hook-enforced swap", "credential, session, caller binding, and nonce all passed on-chain", "green");
  log.kv("tx",    fmt.gray(txHash!));
  log.kv("block", fmt.gray((await pubClient.getTransactionReceipt({ hash: txHash! })).blockNumber.toString()));
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}
