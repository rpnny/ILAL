/**
 * liquidity.ts — `ilal pool add-liquidity` / `ilal pool remove-liquidity`
 *
 * Add or remove liquidity from an ILAL-compliant Uniswap v4 pool.
 *
 * Signs a fresh SessionToken internally, calls ILALRouter.addLiquidity()
 * or removeLiquidity().  The ComplianceHook verifies session + CNF.
 *
 * Usage:
 *   ilal pool add-liquidity \
 *     --tick-lower -600 --tick-upper 600 \
 *     --liquidity  1000000000000 \
 *     --max-amount-0 1000000000000000000 \
 *     --max-amount-1 1000000000000000000 \
 *     --router 0xROUTER --hook 0xHOOK --issuer 0xISSUER \
 *     --pool-id 0xPOOLID --token-a 0xTOKA --token-b 0xTOKB
 */

import {
  formatEther,
  formatUnits,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, die, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";
import { protocolVersion, signSessionAuthorization } from "../sessionProtocol.js";
import { readEligibilityPolicyV2 } from "./policyV2.js";
import { createExecutionClients } from "../signer.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  { name: "symbol",    type: "function" as const, stateMutability: "view" as const,       inputs: [], outputs: [{ type: "string" as const }] },
  { name: "decimals",  type: "function" as const, stateMutability: "view" as const,       inputs: [], outputs: [{ type: "uint8" as const }] },
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const,       inputs: [{ name: "owner", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "allowance", type: "function" as const, stateMutability: "view" as const,       inputs: [{ name: "owner", type: "address" as const }, { name: "spender", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "approve",   type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "spender", type: "address" as const }, { name: "amount", type: "uint256" as const }], outputs: [{ type: "bool" as const }] },
] as const;

const CNF_ABI = [
  { name: "isValid",      type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "credentialOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "merkleRoot",   type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint256" as const }] },
  { name: "zkVerifier",   type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "eas",          type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

const ROUTER_LIQUIDITY_ABI = [
  {
    name: "addLiquidity", type: "function" as const, stateMutability: "payable" as const,
    inputs: [
      { name: "key", type: "tuple" as const, components: [
        { name: "currency0",   type: "address" as const },
        { name: "currency1",   type: "address" as const },
        { name: "fee",         type: "uint24" as const  },
        { name: "tickSpacing", type: "int24" as const   },
        { name: "hooks",       type: "address" as const },
      ]},
      { name: "params", type: "tuple" as const, components: [
        { name: "tickLower",      type: "int24" as const   },
        { name: "tickUpper",      type: "int24" as const   },
        { name: "liquidityDelta", type: "int256" as const  },
        { name: "salt",           type: "bytes32" as const },
      ]},
      { name: "maxAmount0", type: "uint256" as const },
      { name: "maxAmount1", type: "uint256" as const },
      { name: "hookData", type: "bytes" as const },
    ],
    outputs: [
      { name: "callerDelta",  type: "int256" as const },
      { name: "feesAccrued",  type: "int256" as const },
    ],
  },
  {
    name: "removeLiquidity", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [
      { name: "key", type: "tuple" as const, components: [
        { name: "currency0",   type: "address" as const },
        { name: "currency1",   type: "address" as const },
        { name: "fee",         type: "uint24" as const  },
        { name: "tickSpacing", type: "int24" as const   },
        { name: "hooks",       type: "address" as const },
      ]},
      { name: "params", type: "tuple" as const, components: [
        { name: "tickLower",      type: "int24" as const   },
        { name: "tickUpper",      type: "int24" as const   },
        { name: "liquidityDelta", type: "int256" as const  },
        { name: "salt",           type: "bytes32" as const },
      ]},
      { name: "minAmount0", type: "uint256" as const },
      { name: "minAmount1", type: "uint256" as const },
      { name: "hookData", type: "bytes" as const },
    ],
    outputs: [
      { name: "callerDelta",  type: "int256" as const },
      { name: "feesAccrued",  type: "int256" as const },
    ],
  },
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

function txUrl(chain: Chain, hash: `0x${string}`): string | undefined {
  const baseUrl = chain.blockExplorers?.default?.url;
  return baseUrl ? `${baseUrl}/tx/${hash}` : undefined;
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const MAX_UINT256 = 2n ** 256n - 1n;

function trimDecimals(value: string, places = 8): string {
  const [whole, frac] = value.split(".");
  if (!frac) return whole ?? value;
  const trimmed = frac.slice(0, places).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole ?? value;
}

function tokenAmount(raw: bigint, decimals: number, symbol: string, places = 8): string {
  return `${trimDecimals(formatUnits(raw, decimals), places)} ${symbol}`;
}

function allowanceLabel(raw: bigint, decimals: number, symbol: string): string {
  if (raw >= MAX_UINT256 / 2n) return "unlimited (MAX)";
  return `${tokenAmount(raw, decimals, symbol)} (${raw.toString()} wei)`;
}

export async function waitForAllowance(
  readAllowance: () => Promise<bigint>,
  required: bigint,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<bigint> {
  const attempts = options.attempts ?? 5;
  const delayMs = options.delayMs ?? 750;
  let allowance = 0n;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    allowance = await readAllowance();
    if (allowance >= required) return allowance;
    if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
  return allowance;
}

function secondsSince(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

function defaultUserSalt(address: `0x${string}`): `0x${string}` {
  return `0x000000000000000000000000${address.slice(2)}`;
}

// ─── Shared core ──────────────────────────────────────────────────────────────

async function executeLiquidity(
  action: "add" | "remove",
  opts: {
    tickLower:   string;
    tickUpper:   string;
    liquidity:   string;
    salt?:       string;
    poolId?:     string;
    router?:     string;
    hook?:       string;
    issuer?:     string;
    registry?:   string;
    grantManager?: string;
    protocolVersion?: string;
    tokenA?:     string;
    tokenB?:     string;
    fee?:        string;
    tickSpacing?: string;
    chain?:      string;
    rpc?:        string;
    privateKey?: string;
    ttl?:        string;
    maxAmount0?: string;
    maxAmount1?: string;
    minAmount0?: string;
    minAmount1?: string;
    unsafeNoAmountLimits?: boolean;
  }
) {
  const cfg    = withConfig(opts);
  let version: "1" | "2";
  try {
    version = protocolVersion(cfg.protocolVersion);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  const unsafeNoAmountLimits = opts.unsafeNoAmountLimits ?? false;
  const rawAmount0Limit = action === "add" ? opts.maxAmount0 : opts.minAmount0;
  const rawAmount1Limit = action === "add" ? opts.maxAmount1 : opts.minAmount1;
  if (!unsafeNoAmountLimits && (rawAmount0Limit === undefined || rawAmount1Limit === undefined)) {
    die(
      action === "add"
        ? "Live add-liquidity requires --max-amount-0 and --max-amount-1 (raw units). Use --unsafe-no-amount-limits only for test environments."
        : "Live remove-liquidity requires --min-amount-0 and --min-amount-1 (raw units). Use --unsafe-no-amount-limits only for test environments."
    );
  }
  const amount0Limit = unsafeNoAmountLimits
    ? (action === "add" ? MAX_UINT256 : 0n)
    : BigInt(rawAmount0Limit!);
  const amount1Limit = unsafeNoAmountLimits
    ? (action === "add" ? MAX_UINT256 : 0n)
    : BigInt(rawAmount1Limit!);
  if (amount0Limit < 0n || amount1Limit < 0n) die("Liquidity amount limits cannot be negative");
  if (!unsafeNoAmountLimits && amount0Limit === 0n && amount1Limit === 0n) {
    die("At least one liquidity amount limit must be greater than zero");
  }

  if (!cfg.router)   die("ILALRouter address required. Use --router or set in .ilal.json");
  if (!cfg.hook)     die("ComplianceHook address required. Use --hook or set in .ilal.json");
  if (version === "1" && !cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (version === "2" && !cfg.registry) die("EligibilityPolicyRegistryV2 address required. Set registry in .ilal.json");
  if (version === "2" && !cfg.grantManager) die("PolicyGrantManagerV2 address required. Set grantManager in .ilal.json");
  if (!cfg.poolId)   die("Pool ID required. Use --pool-id or set in .ilal.json");

  if (!isAddress(cfg.router!)) die(`Invalid router address: ${cfg.router}`);
  if (!isAddress(cfg.hook!))   die(`Invalid hook address: ${cfg.hook}`);
  if (version === "1" && !isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);
  if (version === "2" && !isAddress(cfg.registry!)) die(`Invalid v2 registry address: ${cfg.registry}`);
  if (version === "2" && !isAddress(cfg.grantManager!)) die(`Invalid v2 grant manager address: ${cfg.grantManager}`);
  if (!isHex(cfg.poolId!) || cfg.poolId!.length !== 66) die("poolId must be 0x + 64 hex chars");

  const tokenA = (cfg.tokenA ?? opts.tokenA) as `0x${string}` | undefined;
  const tokenB = (cfg.tokenB ?? opts.tokenB) as `0x${string}` | undefined;
  if (!tokenA || !tokenB) die("Token addresses required. Use --token-a/--token-b or set in .ilal.json");

  const chain     = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const { account, publicClient: pubClient, walletClient: walClient } = await createExecutionClients({
    chain,
    rpc: cfg.rpc,
    legacyPrivateKey: cfg.privateKey,
  });

  // Ensure currency0 < currency1
  const c0 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenA : tokenB;
  const c1 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenB : tokenA;

  const tickLower   = parseInt(opts.tickLower);
  const tickUpper   = parseInt(opts.tickUpper);
  const liquidity   = BigInt(opts.liquidity);
  const fee         = parseInt(cfg.fee ?? "3000");
  const tickSpacing = parseInt(cfg.tickSpacing ?? "60");
  const salt        = (opts.salt ?? defaultUserSalt(account.address)) as `0x${string}`;

  const verb = action === "add" ? "Add" : "Remove";
  header(`ILAL ${verb} Liquidity`, chain.name);
  log.kv("router",      fmt.cyan(cfg.router!));
  log.kv("hook",        fmt.cyan(cfg.hook!));
  log.kv("pool",        fmt.gray(cfg.poolId!.slice(0, 18) + "…"));
  log.kv("protocol",    `v${version}`);
  log.kv("tickLower",   tickLower.toString());
  log.kv("tickUpper",   tickUpper.toString());
  log.kv("liquidity",   liquidity.toString());
  log.kv(
    action === "add" ? "max token spend" : "min token receive",
    unsafeNoAmountLimits
      ? fmt.yellow("disabled (unsafe test mode)")
      : `${amount0Limit.toString()} / ${amount1Limit.toString()} raw`
  );
  log.kv("salt",        opts.salt ? fmt.hash(salt) : `${fmt.hash(salt)} ${fmt.gray("user-scoped default")}`);
  log.line();

  if (liquidity <= 0n) {
    die("liquidity must be greater than 0. No approval or liquidity transaction was sent.");
  }

  const preflightSpin = new Spinner("Running preflight checks…").start();
  const [sym0, sym1, dec0, dec1, bal0, bal1] = await Promise.all([
    pubClient.readContract({ address: c0, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
    pubClient.readContract({ address: c1, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
    pubClient.readContract({ address: c0, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    pubClient.readContract({ address: c1, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    pubClient.readContract({ address: c0, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
    pubClient.readContract({ address: c1, abi: ERC20_ABI, functionName: "balanceOf", args: [account.address] }) as Promise<bigint>,
  ]);
  const preflightErrors: string[] = [];
  let accessValid = action === "remove";
  let accessDescription = action === "remove" ? "Exit-only removal permitted without current eligibility" : "";
  let policyHash: bigint | undefined;
  let policyRevision: bigint | undefined;

  if (version === "1") {
    const [root, verifier, eas, valid, tokenId] = await Promise.all([
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "merkleRoot" }) as Promise<bigint>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "zkVerifier" }) as Promise<string>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "eas" }) as Promise<string>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "isValid", args: [account.address] }) as Promise<boolean>,
      pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "credentialOf", args: [account.address] }) as Promise<bigint>,
    ]);
    if (action === "add") {
      accessValid = tokenId !== 0n && valid;
      accessDescription = accessValid ? `CNF credential token #${tokenId.toString()}` : "CNF credential missing or invalid";
      const hasEASPath = eas !== ZERO_ADDRESS;
      const hasZKPath = verifier !== ZERO_ADDRESS && root !== 0n;
      if (tokenId === 0n) {
        preflightErrors.push("wallet has no CNF credential; mint one before changing liquidity.");
        if (hasEASPath) preflightErrors.push("first ask the issuer to attest, then run `ilal credential mint --attestation <uid>`.");
        else if (hasZKPath) preflightErrors.push(`run \`ilal credential prove --wallet ${account.address}\`.`);
        else preflightErrors.push("issuer has no active EAS or ZK issuance path.");
      } else if (!valid) {
        preflightErrors.push("wallet CNF credential exists but is not valid.");
      }
    }
  } else {
    const policy = await readEligibilityPolicyV2(
      pubClient,
      cfg.registry as `0x${string}`,
      cfg.poolId as `0x${string}`
    );
    policyHash = policy.policyHash;
    policyRevision = policy.revision;
    if (action === "add") {
      const grantValid = await pubClient.readContract({
        address: cfg.grantManager as `0x${string}`,
        abi: GRANT_MANAGER_V2_ABI,
        functionName: "isPolicyGrantValid",
        args: [cfg.poolId as `0x${string}`, account.address],
      }) as boolean;
      accessValid = policy.enabled && policy.revision > 0n && grantValid;
      accessDescription = accessValid
        ? `Policy grant valid (revision ${policy.revision.toString()})`
        : "Policy grant missing, expired, revoked, or stale";
      if (!policy.enabled || policy.revision === 0n) preflightErrors.push("pool eligibility policy is not enabled.");
      else if (!grantValid) preflightErrors.push("wallet has no current v2 policy grant; activate one before adding liquidity.");
    }
  }
  preflightSpin.stop();

  if (action === "add" && ((amount0Limit > 0n && bal0 === 0n) || (amount1Limit > 0n && bal1 === 0n))) {
    preflightErrors.push(`token balances are not ready for adding liquidity: ${sym0}=${tokenAmount(bal0, dec0, sym0)}, ${sym1}=${tokenAmount(bal1, dec1, sym1)}.`);
  }

  log.section("Preflight Checks");
  if (accessValid) log.ok(accessDescription);
  else log.fail(accessDescription);
  if (version === "2") log.ok(`Policy ${policyHash!.toString()} at revision ${policyRevision!.toString()}`);
  if (action !== "add" || amount0Limit === 0n || bal0 > 0n) log.ok(`${sym0} balance ${tokenAmount(bal0, dec0, sym0)}`);
  else log.fail(`${sym0} balance ${tokenAmount(bal0, dec0, sym0)}`);
  if (action !== "add" || amount1Limit === 0n || bal1 > 0n) log.ok(`${sym1} balance ${tokenAmount(bal1, dec1, sym1)}`);
  else log.fail(`${sym1} balance ${tokenAmount(bal1, dec1, sym1)}`);
  log.ok(`Route bound to router ${fmt.addr(cfg.router!)} and hook ${fmt.addr(cfg.hook!)}`);
  log.line();

  if (preflightErrors.length > 0) {
    log.section("Preflight Failed");
    for (const error of preflightErrors) log.warn(error);
    console.log();
    die(`${verb} liquidity not sent. Fix the preflight issues above.`);
  }

  // Approve both tokens if adding liquidity
  if (action === "add") {
    const approvals = [
      { token: c0, symbol: sym0, decimals: dec0, cap: unsafeNoAmountLimits ? bal0 : amount0Limit },
      { token: c1, symbol: sym1, decimals: dec1, cap: unsafeNoAmountLimits ? bal1 : amount1Limit },
    ] as const;
    for (const { token, symbol: sym, decimals, cap } of approvals) {
      if (cap === 0n) {
        log.ok(`${sym} approval not required (maximum spend is zero)`);
        continue;
      }
      const allowed = await pubClient.readContract({
        address: token, abi: ERC20_ABI, functionName: "allowance",
        args: [account.address, cfg.router as `0x${string}`],
      }) as bigint;

      if (allowed < cap) {
        const appSpin = new Spinner(`Approving ${sym}…`).start();
        const h = await walClient.writeContract({
          address: token, abi: ERC20_ABI, functionName: "approve",
          args: [cfg.router as `0x${string}`, cap],
        });
        const receipt = await pubClient.waitForTransactionReceipt({ hash: h });
        if (receipt.status !== "success") {
          appSpin.fail(`Approval reverted ${fmt.gray(fmt.hash(h))}`);
          die(`${sym} approval reverted; liquidity was not sent.`);
        }
        const reflectedAllowance = await waitForAllowance(async () => pubClient.readContract({
          address: token, abi: ERC20_ABI, functionName: "allowance",
          args: [account.address, cfg.router as `0x${string}`],
        }) as Promise<bigint>, cap);
        if (reflectedAllowance < cap) {
          appSpin.fail(`Approval mined but RPC state is not current ${fmt.gray(fmt.hash(h))}`);
          die(`${sym} approval is not visible after 5 bounded checks; retry after the RPC catches up.`);
        }
        appSpin.succeed(`Approval capped at ${tokenAmount(cap, decimals, sym)} ${fmt.gray(fmt.hash(h))}`);
      } else {
        log.ok(`${sym} allowance: ${allowanceLabel(allowed, decimals, sym)}`);
      }
    }
  }

  // Sign session token
  const signSpin = new Spinner("Signing session token…").start();
  const ttl = parseInt(opts.ttl ?? "600");

  // action: 2 = ADD_LIQUIDITY, 3 = REMOVE_LIQUIDITY
  const actionCode = action === "add" ? 2 : 3;

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
    action: actionCode,
    ttl,
  });
  const hookData = signed.hookData;
  signSpin.succeed(`Session authorization signed (expires in ${ttl}s, one-time nonce)`);
  log.section("Gate Checks");
  log.kv(
    version === "2" ? "policy grant" : "credential",
    action === "add"
      ? version === "2"
        ? `${fmt.badge("required", "cyan")} revision ${policyRevision!.toString()}`
        : `${fmt.badge("required", "cyan")} issuer ${fmt.addr(cfg.issuer!)}`
      : `${fmt.badge("exit-only", "green")} current eligibility not required`
  );
  log.kv("caller", `${fmt.badge("bound", "green")} ${fmt.addr(cfg.router!)}`);
  log.kv("nonce", `${fmt.badge("fresh", "green")} ${fmt.hash(signed.token.nonce)}`);
  log.line();

  // Build PoolKey + params
  const poolKey = {
    currency0:   c0 as `0x${string}`,
    currency1:   c1 as `0x${string}`,
    fee,
    tickSpacing,
    hooks:       cfg.hook as `0x${string}`,
  };

  const liquidityDelta = action === "add" ? liquidity : -liquidity;
  const liquidityParams = { tickLower, tickUpper, liquidityDelta, salt };
  const fnName = action === "add" ? "addLiquidity" : "removeLiquidity";

  // Execute
  const txSpin = new Spinner(`Submitting ${fnName} tx…`).start();
  let txHash: `0x${string}`;
  let receipt: Awaited<ReturnType<typeof pubClient.waitForTransactionReceipt>> | undefined;
  try {
    const startMs = Date.now();
    const baseArgs = [poolKey, liquidityParams, amount0Limit, amount1Limit, hookData] as const;
    txHash = await (action === "add"
      ? walClient.writeContract({ address: cfg.router as `0x${string}`, abi: ROUTER_LIQUIDITY_ABI, functionName: "addLiquidity",    args: baseArgs, value: 0n })
      : walClient.writeContract({ address: cfg.router as `0x${string}`, abi: ROUTER_LIQUIDITY_ABI, functionName: "removeLiquidity", args: baseArgs }));
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
    log.ok(fmt.bold(fmt.green(`Liquidity ${action === "add" ? "added" : "removed"} via ILAL channel`)));
  } catch (e) {
    txSpin.fail(`${fnName} failed`);
    dieOnContract(e);
  }

  log.line();
  log.callout(
    action === "add" ? "Hook-enforced liquidity add" : "Hook-enforced liquidity removal",
    action === "add"
      ? "pool policy, credential type, session binding, and nonce all passed on-chain"
      : "user-scoped position ownership, session binding, and nonce all passed on-chain",
    "green"
  );
  log.kv("tx",    fmt.gray(txHash!));
  log.kv("block", fmt.gray((receipt ?? await pubClient.getTransactionReceipt({ hash: txHash! })).blockNumber.toString()));
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}

// ─── Public exports ───────────────────────────────────────────────────────────

export async function addLiquidity(opts: {
  tickLower:   string;
  tickUpper:   string;
  liquidity:   string;
  salt?:       string;
  poolId?:     string;
  router?:     string;
  hook?:       string;
  issuer?:     string;
  tokenA?:     string;
  tokenB?:     string;
  fee?:        string;
  tickSpacing?: string;
  chain?:      string;
  rpc?:        string;
  privateKey?: string;
  ttl?:        string;
  maxAmount0?: string;
  maxAmount1?: string;
  unsafeNoAmountLimits?: boolean;
}) {
  await executeLiquidity("add", opts);
}

export async function removeLiquidity(opts: {
  tickLower:   string;
  tickUpper:   string;
  liquidity:   string;
  salt?:       string;
  poolId?:     string;
  router?:     string;
  hook?:       string;
  issuer?:     string;
  tokenA?:     string;
  tokenB?:     string;
  fee?:        string;
  tickSpacing?: string;
  chain?:      string;
  rpc?:        string;
  privateKey?: string;
  ttl?:        string;
  minAmount0?: string;
  minAmount1?: string;
  unsafeNoAmountLimits?: boolean;
}) {
  await executeLiquidity("remove", opts);
}
