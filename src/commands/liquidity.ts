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
 *     --liquidity  1000000000000000000 \
 *     --router 0xROUTER --hook 0xHOOK --issuer 0xISSUER \
 *     --pool-id 0xPOOLID --token-a 0xTOKA --token-b 0xTOKB
 */

import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  isAddress,
  isHex,
  parseAbiParameters,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, die, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = [
  { name: "symbol",    type: "function" as const, stateMutability: "view" as const,       inputs: [], outputs: [{ type: "string" as const }] },
  { name: "decimals",  type: "function" as const, stateMutability: "view" as const,       inputs: [], outputs: [{ type: "uint8" as const }] },
  { name: "allowance", type: "function" as const, stateMutability: "view" as const,       inputs: [{ name: "owner", type: "address" as const }, { name: "spender", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
  { name: "approve",   type: "function" as const, stateMutability: "nonpayable" as const, inputs: [{ name: "spender", type: "address" as const }, { name: "amount", type: "uint256" as const }], outputs: [{ type: "bool" as const }] },
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
      { name: "hookData", type: "bytes" as const },
    ],
    outputs: [
      { name: "callerDelta",  type: "int256" as const },
      { name: "feesAccrued",  type: "int256" as const },
    ],
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

function txUrl(chain: Chain, hash: `0x${string}`): string | undefined {
  const baseUrl = chain.blockExplorers?.default?.url;
  return baseUrl ? `${baseUrl}/tx/${hash}` : undefined;
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
    tokenA?:     string;
    tokenB?:     string;
    fee?:        string;
    tickSpacing?: string;
    chain?:      string;
    rpc?:        string;
    privateKey?: string;
    ttl?:        string;
  }
) {
  const cfg    = withConfig(opts);
  const rawKey = cfg.privateKey ?? process.env["PRIVATE_KEY"];
  if (!rawKey)       die("Private key required. Use --private-key or set PRIVATE_KEY env var.");
  if (!cfg.router)   die("ILALRouter address required. Use --router or set in .ilal.json");
  if (!cfg.hook)     die("ComplianceHook address required. Use --hook or set in .ilal.json");
  if (!cfg.issuer)   die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!cfg.poolId)   die("Pool ID required. Use --pool-id or set in .ilal.json");

  if (!isAddress(cfg.router!)) die(`Invalid router address: ${cfg.router}`);
  if (!isAddress(cfg.hook!))   die(`Invalid hook address: ${cfg.hook}`);
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);
  if (!isHex(cfg.poolId!) || cfg.poolId!.length !== 66) die("poolId must be 0x + 64 hex chars");

  const tokenA = (cfg.tokenA ?? opts.tokenA) as `0x${string}` | undefined;
  const tokenB = (cfg.tokenB ?? opts.tokenB) as `0x${string}` | undefined;
  if (!tokenA || !tokenB) die("Token addresses required. Use --token-a/--token-b or set in .ilal.json");

  const chain     = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const account   = privateKeyToAccount(rawKey as `0x${string}`);
  const transport = cfg.rpc ? http(cfg.rpc) : http();
  const pubClient = createPublicClient({ chain, transport });
  const walClient = createWalletClient({ account, chain, transport });

  // Ensure currency0 < currency1
  const c0 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenA : tokenB;
  const c1 = tokenA.toLowerCase() < tokenB.toLowerCase() ? tokenB : tokenA;

  const tickLower   = parseInt(opts.tickLower);
  const tickUpper   = parseInt(opts.tickUpper);
  const liquidity   = BigInt(opts.liquidity);
  const fee         = parseInt(cfg.fee ?? "3000");
  const tickSpacing = parseInt(cfg.tickSpacing ?? "60");
  const salt        = (opts.salt ?? "0x0000000000000000000000000000000000000000000000000000000000000000") as `0x${string}`;

  const verb = action === "add" ? "Add" : "Remove";
  header(`ILAL ${verb} Liquidity`, chain.name);
  log.kv("router",      fmt.cyan(cfg.router!));
  log.kv("hook",        fmt.cyan(cfg.hook!));
  log.kv("pool",        fmt.gray(cfg.poolId!.slice(0, 18) + "…"));
  log.kv("tickLower",   tickLower.toString());
  log.kv("tickUpper",   tickUpper.toString());
  log.kv("liquidity",   liquidity.toString());
  log.line();

  // Approve both tokens if adding liquidity
  if (action === "add") {
    const MAX = 2n ** 256n - 1n;
    for (const token of [c0, c1] as `0x${string}`[]) {
      const sym = await pubClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }) as string;
      const allowed = await pubClient.readContract({
        address: token, abi: ERC20_ABI, functionName: "allowance",
        args: [account.address, cfg.router as `0x${string}`],
      }) as bigint;

      if (allowed < MAX / 2n) {
        const appSpin = new Spinner(`Approving ${sym}…`).start();
        const h = await walClient.writeContract({
          address: token, abi: ERC20_ABI, functionName: "approve",
          args: [cfg.router as `0x${string}`, MAX],
        });
        await pubClient.waitForTransactionReceipt({ hash: h });
        appSpin.succeed(`Approved ${sym} ${fmt.gray(fmt.hash(h))}`);
      }
    }
  }

  // Sign session token
  const signSpin = new Spinner("Signing session token…").start();
  const ttl      = parseInt(opts.ttl ?? "600");
  const deadline = BigInt(Math.floor(Date.now() / 1000) + ttl);
  const nonce    = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as `0x${string}`;

  // action: 2 = ADD_LIQUIDITY, 3 = REMOVE_LIQUIDITY
  const actionCode = action === "add" ? 2 : 3;

  const token = {
    user:          account.address as `0x${string}`,
    authorizedCaller: cfg.router as `0x${string}`,
    cnfIssuer:     cfg.issuer as `0x${string}`,
    chainId:       BigInt(chain.id),
    verifyingHook: cfg.hook as `0x${string}`,
    poolId:        cfg.poolId as `0x${string}`,
    action:        actionCode as 2 | 3,
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
  log.section("Gate Checks");
  log.kv("credential", `${fmt.badge("required", "cyan")} issuer ${fmt.addr(cfg.issuer!)}`);
  log.kv("caller", `${fmt.badge("bound", "green")} ${fmt.addr(cfg.router!)}`);
  log.kv("nonce", `${fmt.badge("fresh", "green")} ${fmt.hash(nonce)}`);
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
  const txSpin = new Spinner(`Sending ${fnName}…`).start();
  let txHash: `0x${string}`;
  try {
    const baseArgs = [poolKey, liquidityParams, hookData] as const;
    txHash = await (action === "add"
      ? walClient.writeContract({ address: cfg.router as `0x${string}`, abi: ROUTER_LIQUIDITY_ABI, functionName: "addLiquidity",    args: baseArgs, value: 0n })
      : walClient.writeContract({ address: cfg.router as `0x${string}`, abi: ROUTER_LIQUIDITY_ABI, functionName: "removeLiquidity", args: baseArgs }));
    txSpin.update(`Confirming ${fmt.gray(fmt.hash(txHash))}…`);
    const receipt = await pubClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      txSpin.fail("Transaction reverted");
      die(`Tx failed: ${txHash}`);
    }
    txSpin.succeed(fmt.bold(fmt.green(`Liquidity ${action === "add" ? "added" : "removed"} via ILAL channel ✓`)));
  } catch (e) {
    txSpin.fail(`${fnName} failed`);
    dieOnContract(e);
  }

  log.line();
  log.callout(
    action === "add" ? "Hook-enforced liquidity add" : "Hook-enforced liquidity removal",
    "pool policy, credential type, session binding, and nonce all passed on-chain",
    "green"
  );
  log.kv("tx",    fmt.gray(txHash!));
  log.kv("block", fmt.gray((await pubClient.getTransactionReceipt({ hash: txHash! })).blockNumber.toString()));
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
}) {
  await executeLiquidity("remove", opts);
}
