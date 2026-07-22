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
  formatEther,
  formatUnits,
  isAddress,
  isHex,
  parseUnits,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, die, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";
import {
  decodeSessionAuthorization,
  hashSessionAuthorization,
  protocolVersion,
  recoverSessionAuthorization,
  signSessionAuthorization,
  type SessionTokenV1,
  type SessionTokenV2,
} from "../sessionProtocol.js";
import { readEligibilityPolicyV2 } from "./policyV2.js";
import { createExecutionClients } from "../signer.js";

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

const CNF_ABI = [
  { name: "isValid",      type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "credentialOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "merkleRoot",   type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint256" as const }] },
  { name: "zkVerifier",   type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "eas",          type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

// ─── Session helpers ──────────────────────────────────────────────────────────

const GRANT_MANAGER_V2_ABI = [{
  name: "isPolicyGrantValid",
  type: "function" as const,
  stateMutability: "view" as const,
  inputs: [
    { name: "poolId", type: "bytes32" as const },
    { name: "user", type: "address" as const },
  ],
  outputs: [{ type: "bool" as const }],
}] as const;

const ERC1271_ABI = [{
  name: "isValidSignature",
  type: "function" as const,
  stateMutability: "view" as const,
  inputs: [{ name: "hash", type: "bytes32" as const }, { name: "signature", type: "bytes" as const }],
  outputs: [{ type: "bytes4" as const }],
}] as const;
const ERC1271_MAGIC = "0x1626ba7e";

// sqrtPriceLimitX96 — use min/max to let the swap fill fully
const MIN_SQRT_PRICE = 4295128740n;        // TickMath.MIN_SQRT_PRICE + 1
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970341n; // MAX - 1
const DYNAMIC_FEE_FLAG = 8388608;
const PIPS_DENOMINATOR = 1_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = 2n ** 256n - 1n;
const SECP256K1_HALF_ORDER = BigInt("0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0");

function txUrl(chain: Chain, hash: `0x${string}`): string | undefined {
  const baseUrl = chain.blockExplorers?.default?.url;
  return baseUrl ? `${baseUrl}/tx/${hash}` : undefined;
}

function feeLabel(fee: number): string {
  if (fee === DYNAMIC_FEE_FLAG) return `${fmt.badge("verified", "green")} 0.05% (vs 0.30% standard pool)`;
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

function trimDecimals(value: string, places = 8): string {
  const [whole, frac] = value.split(".");
  if (!frac) return whole ?? value;
  const trimmed = frac.slice(0, places).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole ?? value;
}

function tokenAmount(raw: bigint, decimals: number, symbol: string, places = 8): string {
  return `${trimDecimals(formatUnits(raw, decimals), places)} ${symbol}`;
}

function tokenAmountWithWei(raw: bigint, decimals: number, symbol: string, places = 8): string {
  return `${tokenAmount(raw, decimals, symbol, places)} (${raw.toString()} wei)`;
}

function allowanceLabel(raw: bigint, decimals: number, symbol: string): string {
  if (raw >= MAX_UINT256 / 2n) return "unlimited (MAX)";
  return tokenAmountWithWei(raw, decimals, symbol);
}

function secondsSince(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

function validateEcdsaSignature(sig: `0x${string}`): string | undefined {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) return "signature must be 65 bytes";
  const s = BigInt(`0x${sig.slice(66, 130)}`);
  const v = Number.parseInt(sig.slice(130, 132), 16);
  if (s > SECP256K1_HALF_ORDER) return "signature uses high-s form; re-sign to produce canonical EIP-2 low-s signature";
  if (v !== 27 && v !== 28) return "signature recovery id must be 27 or 28";
  return undefined;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function swap(opts: {
  amountIn:      string;
  minAmountOut?: string;  // slippage floor in raw token-out units
  unsafeNoSlippage?: boolean;
  tokenIn?:      string;
  zeroForOne?:   boolean;
  poolId?:       string;
  router?:       string;
  hook?:         string;
  issuer?:       string;
  registry?:     string;
  grantManager?: string;
  protocolVersion?: string;
  tokenA?:       string;
  tokenB?:       string;
  fee?:          string;
  tickSpacing?:  string;
  chain?:        string;
  rpc?:          string;
  privateKey?:   string;
  ttl?:          string;
  hookData?:     string;
  simulate?:     boolean;
  explain?:      boolean;
}) {
  let minAmountOut = 0n;
  if (opts.minAmountOut !== undefined) {
    try {
      minAmountOut = BigInt(opts.minAmountOut);
    } catch {
      die("--min-amount-out must be a non-negative integer in raw token-out units.");
    }
    if (minAmountOut < 0n) die("--min-amount-out must not be negative.");
  }
  if (opts.minAmountOut !== undefined && opts.unsafeNoSlippage) {
    die("Choose either --min-amount-out or --unsafe-no-slippage, not both.");
  }
  if (!opts.simulate && minAmountOut === 0n && !opts.unsafeNoSlippage) {
    die(
      "A positive --min-amount-out is required for a live swap.\n" +
      "  Quote the trade in your execution system and pass the minimum acceptable raw output.\n" +
      "  Testnet demos may explicitly opt out with --unsafe-no-slippage."
    );
  }

  const cfg    = withConfig(opts);
  let version: "1" | "2";
  try {
    version = protocolVersion(cfg.protocolVersion);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  if (!cfg.router)   die("ILALRouter address required. Use --router or set in .ilal.json");
  if (!cfg.hook)     die("ComplianceHook address required. Use --hook or set in .ilal.json");
  if (version === "1" && !cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (version === "2" && !cfg.registry) die("EligibilityPolicyRegistryV2 address required. Set registry in .ilal.json");
  if (version === "2" && !cfg.grantManager) die("PolicyGrantManagerV2 address required. Set grantManager in .ilal.json");
  if (!cfg.poolId)   die("Pool ID required. Use --pool-id or set in .ilal.json");

  if (!isAddress(cfg.router!))  die(`Invalid router address: ${cfg.router}`);
  if (!isAddress(cfg.hook!))    die(`Invalid hook address: ${cfg.hook}`);
  if (version === "1" && !isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);
  if (version === "2" && !isAddress(cfg.registry!)) die(`Invalid v2 registry address: ${cfg.registry}`);
  if (version === "2" && !isAddress(cfg.grantManager!)) die(`Invalid v2 grant manager address: ${cfg.grantManager}`);
  if (!isHex(cfg.poolId!) || cfg.poolId!.length !== 66) die("poolId must be 0x + 64 hex chars");

  const chain     = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const { account, publicClient: pubClient, walletClient: walClient } = await createExecutionClients({
    chain,
    rpc: cfg.rpc,
    legacyPrivateKey: cfg.privateKey,
  });

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
  log.kv("protocol", `v${version}`);
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
  if (amountIn <= 0n) {
    die("amount-in must be greater than 0. Use `ilal swap --simulate` for a dry run.");
  }
  log.kv("amount", `${fmt.cyan(tokenAmountWithWei(amountIn, decimals, symbol))}`);
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

  const preflightSpin = new Spinner("Running preflight checks…").start();
  const balance = await pubClient.readContract({
    address: tokenIn,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  }) as bigint;
  let accessValid = false;
  let accessDescription = "";
  let policyHash: bigint | undefined;
  let policyRevision: bigint | undefined;
  const preflightErrors: string[] = [];

  if (version === "1") {
    const [root, verifier, eas, valid, tokenId] = await Promise.all([
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "merkleRoot" }) as Promise<bigint>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "zkVerifier" }) as Promise<string>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "eas" }) as Promise<string>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "isValid", args: [account.address] }) as Promise<boolean>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "credentialOf", args: [account.address] }) as Promise<bigint>,
    ]);
    accessValid = tokenId !== 0n && valid;
    accessDescription = accessValid ? `CNF credential token #${tokenId.toString()}` : "CNF credential missing or invalid";
    const hasEASPath = eas !== ZERO_ADDRESS;
    const hasZKPath = verifier !== ZERO_ADDRESS && root !== 0n;
    if (tokenId === 0n) {
      preflightErrors.push("wallet has no CNF credential; mint one before trading.");
      if (hasEASPath) preflightErrors.push("first ask the issuer to attest, then run `ilal credential mint --attestation <uid>`.");
      else if (hasZKPath) preflightErrors.push(`run \`ilal credential prove --wallet ${account.address}\`.`);
      else preflightErrors.push("issuer has no active EAS or ZK issuance path.");
    } else if (!valid) {
      preflightErrors.push("wallet CNF credential exists but is not valid.");
    }
  } else {
    const [policy, grantValid] = await Promise.all([
      readEligibilityPolicyV2(pubClient, cfg.registry as `0x${string}`, cfg.poolId as `0x${string}`),
      pubClient.readContract({
        address: cfg.grantManager as `0x${string}`,
        abi: GRANT_MANAGER_V2_ABI,
        functionName: "isPolicyGrantValid",
        args: [cfg.poolId as `0x${string}`, account.address],
      }) as Promise<boolean>,
    ]);
    policyHash = policy.policyHash;
    policyRevision = policy.revision;
    accessValid = policy.enabled && policy.revision > 0n && grantValid;
    accessDescription = accessValid
      ? `Policy grant valid (revision ${policy.revision.toString()})`
      : "Policy grant missing, expired, revoked, or stale";
    if (!policy.enabled || policy.revision === 0n) preflightErrors.push("pool eligibility policy is not enabled.");
    else if (!grantValid) preflightErrors.push("wallet has no current v2 policy grant; run `ilal policy grant activate --proof <proof.json> --public <public.json>`.");
  }
  preflightSpin.stop();

  if (balance < totalDebit) preflightErrors.push(`insufficient ${symbol} balance: need ${tokenAmountWithWei(totalDebit, decimals, symbol)} including ILAL fee, have ${tokenAmountWithWei(balance, decimals, symbol)}.`);

  log.section("Preflight Checks");
  if (accessValid) log.ok(accessDescription);
  else log.fail(accessDescription);
  if (version === "2") log.ok(`Policy ${policyHash!.toString()} at revision ${policyRevision!.toString()}`);
  if (balance >= totalDebit) log.ok(`Wallet balance ${tokenAmount(balance, decimals, symbol)}`);
  else log.fail(`Wallet balance ${tokenAmount(balance, decimals, symbol)}`);
  log.ok(`Route bound to router ${fmt.addr(cfg.router!)} and hook ${fmt.addr(cfg.hook!)}`);
  if (opts.explain) {
    log.info(version === "2"
      ? "A policy grant proves this wallet met the current issuer, KYC-tier, and jurisdiction policy without exposing those private attributes."
      : "CNF proves this wallet is allowed to access the pool without revealing identity data.");
    log.info("Caller binding means the signed authorization can only be used through the ILALRouter.");
  }
  log.line();

  if (preflightErrors.length > 0) {
    log.section("Preflight Failed");
    for (const error of preflightErrors) log.warn(error);
    console.log();
    if (!opts.simulate) {
      die("Swap not sent. Fix the preflight issues above, or use --simulate to inspect session/hookData only.");
    }
  }

  log.deal([
    { label: "verified input", value: `${opts.amountIn} ${symbol}`, note: "exact-in swap", tone: "cyan" },
    { label: "LP fee", value: poolFeePercent(parseInt(cfg.fee ?? "3000")), note: parseInt(cfg.fee ?? "3000") === DYNAMIC_FEE_FLAG ? "6× cheaper than 0.30% standard" : "pool fee", tone: "green" },
    { label: "ILAL fee", value: protocolFeePips > 0 ? pipsToPercent(protocolFeePips) : "off", note: protocolFeePips > 0 ? "protocol revenue" : "legacy router", tone: protocolFeePips > 0 ? "cyan" : "gray" },
  ]);
  log.line();

  const ttl = parseInt(opts.ttl ?? "600");
  let hookData: `0x${string}`;
  let sessionNonce: `0x${string}`;

  if (opts.hookData) {
    if (!isHex(opts.hookData)) die("--hook-data must be 0x-prefixed ABI-encoded hookData.");
    try {
      const { token: externalToken, signature: externalSig } = decodeSessionAuthorization(opts.hookData as `0x${string}`, version);
      const issues: string[] = [];
      if (externalToken.user.toLowerCase() !== account.address.toLowerCase()) issues.push("user does not match signer wallet");
      if (externalToken.authorizedCaller.toLowerCase() !== cfg.router!.toLowerCase()) issues.push("authorizedCaller does not match router");
      if (version === "1" && (externalToken as SessionTokenV1).cnfIssuer.toLowerCase() !== cfg.issuer!.toLowerCase()) issues.push("cnfIssuer does not match config");
      if (version === "2") {
        const v2Token = externalToken as SessionTokenV2;
        if (v2Token.policyHash !== policyHash) issues.push("policyHash does not match the current pool policy");
        if (v2Token.policyRevision !== policyRevision) issues.push("policyRevision does not match the current pool policy");
      }
      if (externalToken.chainId !== BigInt(chain.id)) issues.push(`chainId mismatch: hookData=${externalToken.chainId.toString()} config=${chain.id}`);
      if (externalToken.verifyingHook.toLowerCase() !== cfg.hook!.toLowerCase()) issues.push("verifyingHook does not match config");
      if (externalToken.poolId.toLowerCase() !== cfg.poolId!.toLowerCase()) issues.push("poolId does not match config");
      if (externalToken.action !== 1) issues.push("action is not swap");
      if (externalToken.deadline < BigInt(Math.floor(Date.now() / 1000))) issues.push("session deadline has expired");
      const userCode = await pubClient.getCode({ address: externalToken.user });
      if (userCode && userCode !== "0x") {
        const digest = hashSessionAuthorization({
          token: externalToken,
          version,
          chainId: BigInt(chain.id),
          hook: cfg.hook as `0x${string}`,
        });
        try {
          const magic = await pubClient.readContract({
            address: externalToken.user,
            abi: ERC1271_ABI,
            functionName: "isValidSignature",
            args: [digest, externalSig],
          });
          if (magic.toLowerCase() !== ERC1271_MAGIC) issues.push("ERC-1271 wallet rejected the session signature");
        } catch {
          issues.push("ERC-1271 session signature validation failed");
        }
      } else {
        const sigIssue = validateEcdsaSignature(externalSig);
        if (sigIssue) {
          issues.push(sigIssue);
        } else {
          const recovered = await recoverSessionAuthorization({
            token: externalToken,
            signature: externalSig,
            version,
            chainId: BigInt(chain.id),
            hook: cfg.hook as `0x${string}`,
          });
          if (recovered.toLowerCase() !== externalToken.user.toLowerCase()) {
            issues.push(`signature does not recover to session user ${fmt.addr(externalToken.user)}`);
          }
        }
      }
      if (issues.length > 0) die(`Invalid --hook-data for this swap: ${issues.join("; ")}`);
      sessionNonce = externalToken.nonce;
      hookData = opts.hookData as `0x${string}`;
      log.ok("Using externally supplied one-time session authorization");
    } catch (e) {
      die(`Could not decode --hook-data: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else {
    // Sign session token
    const signSpin = new Spinner("Signing one-time session authorization…").start();
    const signed = await signSessionAuthorization({
      walletClient: walClient,
      account,
      version,
      authorizedCaller: cfg.router as `0x${string}`,
      issuer: cfg.issuer as `0x${string}` | undefined,
      policyHash,
      policyRevision,
      chainId: BigInt(chain.id),
      hook: cfg.hook as `0x${string}`,
      poolId: cfg.poolId as `0x${string}`,
      action: 1,
      ttl,
    });
    hookData = signed.hookData;
    sessionNonce = signed.token.nonce;
    signSpin.succeed(`Session authorization signed (expires in ${ttl}s, one-time nonce)`);
  }
  const fee         = parseInt(cfg.fee ?? "3000");
  const tickSpacing = parseInt(cfg.tickSpacing ?? "60");

  log.section("Gate Checks");
  log.kv(
    version === "2" ? "policy grant" : "credential",
    version === "2"
      ? `${fmt.badge("required", "cyan")} revision ${policyRevision!.toString()}`
      : `${fmt.badge("required", "cyan")} issuer ${fmt.addr(cfg.issuer!)}`
  );
  log.kv("caller", `${fmt.badge("bound", "green")} ${fmt.addr(cfg.router!)}`);
  log.kv("nonce", `${opts.hookData ? fmt.badge("external", "cyan") : fmt.badge("fresh", "green")} ${fmt.hash(sessionNonce)}`);
  if (opts.explain) log.kvdim("", "↳ unique one-time session ID; prevents replay attacks");
  log.kv("fee", feeLabel(fee));
  if (protocolFeePips > 0) {
    log.kv("protocol fee", `${fmt.badge("ILAL", "cyan")} ${pipsToPercent(protocolFeePips)} to ${treasury ? fmt.addr(treasury) : "treasury"}`);
    log.kv("total debit", `${tokenAmountWithWei(totalDebit, decimals, symbol)} input + ILAL fee`);
  }
  log.line();

  if (minAmountOut > 0n) {
    log.kv("min-amount-out", `${fmt.cyan(minAmountOut.toString())} raw units (slippage protection on)`);
  } else if (opts.unsafeNoSlippage) {
    log.warn("Slippage protection explicitly disabled; use only in controlled test environments.");
  }

  if (opts.simulate) {
    log.ok("Simulation mode — skipping approval and on-chain tx");
    log.kv("hookData", hookData.slice(0, 22) + "…");
    console.log();
    return;
  }

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
      args:         [cfg.router as `0x${string}`, totalDebit],
    });
    await pubClient.waitForTransactionReceipt({ hash: approveHash });
    approveSpin.succeed(`Approved exact debit ${tokenAmount(totalDebit, decimals, symbol)} ${fmt.gray(fmt.hash(approveHash))}`);
  } else {
    approveSpin.succeed(`Allowance: ${allowanceLabel(allowed, decimals, symbol)}`);
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

  // Execute swap
  const txSpin = new Spinner("Submitting swap tx…").start();
  let txHash: `0x${string}`;
  let receipt: Awaited<ReturnType<typeof pubClient.waitForTransactionReceipt>> | undefined;
  try {
    const startMs = Date.now();
    txHash = await walClient.writeContract({
      address:      cfg.router as `0x${string}`,
      abi:          ROUTER_ABI,
      functionName: "swap",
      args:         [poolKey, swapParams, minAmountOut, hookData],
      value:        0n,
    });
    txSpin.succeed(`Submitted to mempool ${fmt.gray(fmt.hash(txHash))}`);
    const confirmSpin = new Spinner(`Confirming ${fmt.gray(fmt.hash(txHash))}…`).start();
    receipt = await pubClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      confirmSpin.fail("Transaction reverted");
      die(`Tx failed: ${txHash}`);
    }
    confirmSpin.succeed(`Confirmed in block ${receipt.blockNumber.toString()}`);
    const effectiveGasPrice = (receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice;
    log.metrics([
      { label: "finality", value: secondsSince(startMs), tone: "green" },
      { label: "gas used", value: receipt.gasUsed.toString(), tone: "cyan" },
      ...(effectiveGasPrice ? [{ label: "gas cost", value: `${trimDecimals(formatEther(receipt.gasUsed * effectiveGasPrice), 8)} ETH`, tone: "cyan" as const }] : []),
    ]);
    log.ok(fmt.bold(fmt.green("Swap executed via ILAL channel")));
  } catch (e) {
    txSpin.fail("Swap failed");
    dieOnContract(e);
  }

  log.line();
  log.callout("Hook-enforced swap", "credential, session, caller binding, and nonce all passed on-chain", "green");
  log.kv("tx",    fmt.gray(txHash!));
  log.kv("block", fmt.gray((receipt ?? await pubClient.getTransactionReceipt({ hash: txHash! })).blockNumber.toString()));
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}
