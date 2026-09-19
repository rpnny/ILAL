import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  hashTypedData,
  http,
  isAddress,
  parseUnits,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";

import { loadConfig } from "../config.js";
import { encodeSessionAuthorization, SESSION_TOKEN_V2_TYPE, type SessionTokenV2 } from "../sessionProtocol.js";
import { signerOptions } from "../signer.js";
import { configureFatalErrorHandling } from "../ui.js";
import {
  nettingOrderSign,
  NETTING_ORDER_COMPONENTS,
  NETTING_ROUTER_ABI,
  loadBatch,
  orderHash,
  previewNettingOrderFiles,
  runNettingPreflight,
  serializeOrder,
  type NettingOrder,
  type NettingPreview,
  type SignedOrderFile,
} from "./netting.js";
import { swap, type SwapExecutionResult } from "./swap.js";
import { readPolicyGrantSnapshotV2 } from "./policyV2.js";

const LOOPBACK = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;
const SWAP_CONFIRMATION = "BROADCAST BASE SEPOLIA";
const SWAP_CHALLENGE_TTL_MS = 2 * 60 * 1000;
const MIN_SQRT_PRICE = 4295128740n;
const MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970341n;
const PIPS_DENOMINATOR = 1_000_000n;

const SOEE = {
  chainId: 84532,
  network: "Base Sepolia",
  rpc: "https://sepolia.base.org",
  poolId: "0xeab91a1421cb5c170df74c1eaf676a8836eda1fc5a833f62ab9c2d516acfbc87" as Hex,
  hook: "0x8d1fA43F848701b2adB105D5c925A9247E600088" as Address,
  router: "0x96456C68f25A1Fa6C2F2751183401ac26A732506" as Address,
  issuer: "0x4B3fAf8664eB85ED59059491925F763459E72386" as Address,
  registry: "0x12C7982Fe897037c6A6c80c52f6bf3e180D85a61" as Address,
  oracle: "0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3" as Address,
  token0: { symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address, decimals: 6 },
  token1: { symbol: "hUSDT", address: "0xC4946fEC334f4B9350dF08E311261e4361B7c72C" as Address, decimals: 6 },
  fee: 500,
  tickSpacing: 10,
} as const;

const CNF_ABI = [{
  name: "isValid", type: "function", stateMutability: "view",
  inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "bool" }],
}] as const;

const POLICY_ABI = [{
  name: "getPolicy", type: "function", stateMutability: "view",
  inputs: [{ name: "poolId", type: "bytes32" }],
  outputs: [{
    type: "tuple", components: [
      { name: "cnfIssuer", type: "address" },
      { name: "requiredCredentialType", type: "bytes32" },
      { name: "enabled", type: "bool" },
    ],
  }],
}] as const;

const ERC20_METADATA_ABI = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const ERC20_EXECUTION_ABI = [
  ...ERC20_METADATA_ABI,
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "allowance", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const ROUTER_EXECUTION_ABI = [
  { name: "protocolFeePips", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { name: "swap", type: "function", stateMutability: "payable", inputs: [
    { name: "key", type: "tuple", components: [
      { name: "currency0", type: "address" }, { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" },
    ] },
    { name: "params", type: "tuple", components: [
      { name: "zeroForOne", type: "bool" }, { name: "amountSpecified", type: "int256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
    ] },
    { name: "minAmountOut", type: "uint256" }, { name: "hookData", type: "bytes" },
  ], outputs: [{ name: "delta", type: "int256" }] },
] as const;

const ERC1271_ABI = [{
  name: "isValidSignature", type: "function", stateMutability: "view",
  inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }],
  outputs: [{ name: "magicValue", type: "bytes4" }],
}] as const;

const ERC1271_MAGIC_VALUE = "0x1626ba7e";

interface PreparedSwap {
  challengeId: string;
  expiresAt: number;
  amountIn: string;
  minAmountOut: string;
  tokenIn: Address;
  ttl: string;
  preview: SwapExecutionResult;
}

interface BrowserPreparedSwap {
  challengeId: string;
  expiresAt: number;
  token: SessionTokenV2;
  tokenIn: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  totalDebit: bigint;
  allowance: bigint;
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  symbol: string;
  decimals: number;
}

interface BrowserPreparedOrder {
  challengeId: string;
  expiresAt: number;
  order: NettingOrder;
  domain: { name: "ILAL Institutional Netting"; version: "1"; chainId: number; verifyingContract: Address };
  tokenIn: Address;
  symbol: string;
  decimals: number;
  balance: bigint;
  allowance: bigint;
}

interface BrowserPreparedBatch {
  challengeId: string;
  expiresAt: number;
  orderNames: string[];
  report: Awaited<ReturnType<typeof runNettingPreflight>>;
  transaction: { to: Address; data: Hex };
}

interface ConsoleOptions {
  port?: string;
  open?: boolean;
}

interface ApiError extends Error {
  statusCode?: number;
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = jsonValue(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function apiError(message: string, statusCode = 400): ApiError {
  const error = new Error(message) as ApiError;
  error.statusCode = statusCode;
  return error;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw apiError("Request body is too large.", 413);
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw apiError("Request body must be valid JSON.");
  }
}

function findAssetsDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env["ILAL_CONSOLE_ASSETS"],
    resolve(process.cwd(), "site"),
    resolve(moduleDir, "../console-assets"),
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "app.html")) && existsSync(join(candidate, "console.html"))) return candidate;
  }
  throw new Error("ILAL Console assets were not found. Rebuild the CLI package.");
}

function consoleDataDir(): string {
  const path = resolve(process.cwd(), ".ilal-console", "orders");
  mkdirSync(path, { recursive: true, mode: 0o700 });
  return path;
}

function signerSummary(): { kind: string; address: string | null; ready: boolean } {
  const options = signerOptions();
  if (options.keystore) {
    try {
      const parsed = JSON.parse(readFileSync(resolve(options.keystore), "utf8")) as { address?: string };
      const candidate = parsed.address?.startsWith("0x") ? parsed.address : `0x${parsed.address ?? ""}`;
      return { kind: "encrypted-keystore", address: isAddress(candidate) ? candidate : null, ready: Boolean(options.passwordFile) };
    } catch {
      return { kind: "encrypted-keystore", address: null, ready: false };
    }
  }
  if (options.rpcAccount) return { kind: "rpc-account", address: options.rpcAccount, ready: isAddress(options.rpcAccount) };
  if (options.unsafePrivateKey && process.env["PRIVATE_KEY"]) return { kind: "testnet-private-key", address: null, ready: true };
  return { kind: "none", address: null, ready: false };
}

async function liveStatus(): Promise<Record<string, unknown>> {
  const signer = signerSummary();
  const client = createPublicClient({ chain: baseSepolia, transport: http(SOEE.rpc) });
  try {
    const [chainId, blockNumber, codes] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      Promise.all([SOEE.hook, SOEE.router, SOEE.issuer, SOEE.registry, SOEE.oracle]
        .map(address => client.getBytecode({ address }))),
    ]);
    let credential: boolean | null = null;
    let policy: boolean | null = null;
    if (signer.address && isAddress(signer.address)) {
      credential = await client.readContract({ address: SOEE.issuer, abi: CNF_ABI, functionName: "isValid", args: [signer.address] });
    }
    try {
      const configured = await client.readContract({ address: SOEE.registry, abi: POLICY_ABI, functionName: "getPolicy", args: [SOEE.poolId] });
      policy = configured.enabled;
    } catch {
      policy = null;
    }
    const cfg = loadConfig();
    let instantCandidate: Record<string, unknown> | null = null;
    if (cfg.chain === "84532" && cfg.tokenA && cfg.tokenB && isAddress(cfg.tokenA) && isAddress(cfg.tokenB)) {
      const instantClient = createPublicClient({ chain: baseSepolia, transport: http(cfg.rpc ?? SOEE.rpc) });
      const [tokenAMeta, tokenBMeta] = await Promise.all([cfg.tokenA, cfg.tokenB].map(async address => {
        const [symbol, decimals] = await Promise.all([
          instantClient.readContract({ address: address as Address, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
          instantClient.readContract({ address: address as Address, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
        ]);
        return { address, symbol, decimals };
      }));
      instantCandidate = {
        protocolVersion: cfg.protocolVersion ?? "1",
        chainId: Number(cfg.chain), network: "Base Sepolia",
        router: cfg.router, hook: cfg.hook, poolId: cfg.poolId,
        tokens: [tokenAMeta, tokenBMeta],
      };
    }
    return {
      mode: "live", connected: chainId === SOEE.chainId, blockNumber: blockNumber.toString(),
      contractsReady: codes.every(code => Boolean(code && code !== "0x")), credential, policy, signer, candidate: SOEE,
      instantCandidate,
    };
  } catch (error) {
    return {
      mode: "offline", connected: false, error: error instanceof Error ? error.message.split("\n")[0] : String(error),
      contractsReady: false, credential: null, policy: null, signer, candidate: SOEE,
    };
  }
}

function requireDecimalAmount(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value) || Number(value) <= 0) {
    throw apiError(`${key} must be a positive decimal string with at most 18 decimal places.`);
  }
  return value;
}

function requireAddress(body: Record<string, unknown>, key: string): Address {
  const value = body[key];
  if (typeof value !== "string" || !isAddress(value)) throw apiError(`${key} must be a valid address.`);
  return value;
}

function requestedSwap(body: Record<string, unknown>): Omit<PreparedSwap, "challengeId" | "expiresAt" | "preview"> {
  const cfg = loadConfig();
  if (cfg.chain !== "84532") throw apiError("The local institution app only broadcasts to Base Sepolia.", 409);
  const tokenIn = requireAddress(body, "tokenIn");
  const configuredTokens = [cfg.tokenA, cfg.tokenB].filter((value): value is string => Boolean(value));
  if (!configuredTokens.some(value => value.toLowerCase() === tokenIn.toLowerCase())) {
    throw apiError("tokenIn must be one of the two tokens in the configured ILAL pool.");
  }
  const minAmountOut = requireUnsignedInteger(body, "minAmountOut");
  if (BigInt(minAmountOut) <= 0n) throw apiError("minAmountOut must be greater than zero for a live swap.");
  const ttl = requireUnsignedInteger(body, "ttl");
  if (Number(ttl) < 60 || Number(ttl) > 900) throw apiError("ttl must be between 60 and 900 seconds.");
  return { amountIn: requireDecimalAmount(body, "amountIn"), minAmountOut, tokenIn, ttl };
}

async function preflightSwap(body: Record<string, unknown>): Promise<Omit<PreparedSwap, "challengeId" | "expiresAt">> {
  if (!signerSummary().ready) {
    throw apiError("No transaction signer is configured. Restart with --keystore and --password-file, or --rpc-account.", 409);
  }
  const request = requestedSwap(body);
  const preview = await swap({
    amountIn: request.amountIn,
    minAmountOut: request.minAmountOut,
    tokenIn: request.tokenIn,
    ttl: request.ttl,
    simulate: true,
  });
  if (preview.preflightErrors.length > 0) {
    throw apiError(`Preflight failed: ${preview.preflightErrors.join(" ")}`, 409);
  }
  return { ...request, preview };
}

async function prepareBrowserSwap(body: Record<string, unknown>): Promise<Omit<BrowserPreparedSwap, "challengeId" | "expiresAt"> & { typedData: Record<string, unknown> }> {
  const request = requestedSwap(body);
  const user = requireAddress(body, "user");
  const cfg = loadConfig();
  if (!cfg.router || !cfg.hook || !cfg.registry || !cfg.grantManager || !cfg.poolId || !cfg.tokenA || !cfg.tokenB) {
    throw apiError("The V2 public candidate configuration is incomplete.", 409);
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(cfg.rpc ?? SOEE.rpc) });
  const tokenIn = request.tokenIn;
  const tokenOut = tokenIn.toLowerCase() === cfg.tokenA.toLowerCase() ? cfg.tokenB as Address : cfg.tokenA as Address;
  const currency0 = (cfg.tokenA.toLowerCase() < cfg.tokenB.toLowerCase() ? cfg.tokenA : cfg.tokenB) as Address;
  const currency1 = (cfg.tokenA.toLowerCase() < cfg.tokenB.toLowerCase() ? cfg.tokenB : cfg.tokenA) as Address;
  const [symbol, decimals, outputDecimals, balance, allowance, protocolFeePips, snapshot] = await Promise.all([
    client.readContract({ address: tokenIn, abi: ERC20_EXECUTION_ABI, functionName: "symbol" }),
    client.readContract({ address: tokenIn, abi: ERC20_EXECUTION_ABI, functionName: "decimals" }),
    client.readContract({ address: tokenOut, abi: ERC20_EXECUTION_ABI, functionName: "decimals" }),
    client.readContract({ address: tokenIn, abi: ERC20_EXECUTION_ABI, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: tokenIn, abi: ERC20_EXECUTION_ABI, functionName: "allowance", args: [user, cfg.router as Address] }),
    client.readContract({ address: cfg.router as Address, abi: ROUTER_EXECUTION_ABI, functionName: "protocolFeePips" }),
    readPolicyGrantSnapshotV2(
      client as Parameters<typeof readPolicyGrantSnapshotV2>[0],
      cfg.registry as Address, cfg.grantManager as Address, cfg.poolId as Hex, user
    ),
  ]);
  const amountIn = parseUnits(request.amountIn, decimals);
  const minAmountOut = BigInt(request.minAmountOut);
  const protocolFee = amountIn * BigInt(protocolFeePips) / PIPS_DENOMINATOR;
  const totalDebit = amountIn + protocolFee;
  if (!snapshot.valid) throw apiError("This wallet does not have a current V2 Policy Grant.", 409);
  if (balance < totalDebit) throw apiError(`Insufficient ${symbol} balance for the exact input and ILAL fee.`, 409);
  if (minAmountOut <= 0n) throw apiError("A positive minimum output is required.");
  if (outputDecimals > 18) throw apiError("Unsupported output token decimals.", 409);
  const token: SessionTokenV2 = {
    user,
    authorizedCaller: cfg.router as Address,
    policyHash: snapshot.policy.policyHash,
    policyRevision: snapshot.policy.revision,
    chainId: 84532n,
    verifyingHook: cfg.hook as Address,
    poolId: cfg.poolId as Hex,
    action: 1,
    deadline: BigInt(Math.floor(Date.now() / 1000) + Number(request.ttl)),
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  const typedData = {
    domain: { name: "ILAL ComplianceHook", version: "2", chainId: 84532, verifyingContract: cfg.hook },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      SessionTokenV2: SESSION_TOKEN_V2_TYPE,
    },
    primaryType: "SessionTokenV2",
    message: {
      ...token,
      policyHash: token.policyHash.toString(), policyRevision: token.policyRevision.toString(),
      chainId: token.chainId.toString(), deadline: token.deadline.toString(),
    },
  };
  return {
    token, tokenIn, amountIn, minAmountOut, totalDebit, allowance,
    currency0, currency1, fee: Number(cfg.fee ?? "8388608"), tickSpacing: Number(cfg.tickSpacing ?? "60"),
    symbol, decimals, typedData,
  };
}

async function buildBrowserSwap(prepared: BrowserPreparedSwap, signature: unknown): Promise<Record<string, unknown>> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw apiError("A wallet signature is required.");
  const cfg = loadConfig();
  const typedData = {
    domain: { name: "ILAL ComplianceHook", version: "2", chainId: 84532n, verifyingContract: cfg.hook as Address },
    types: { SessionTokenV2: SESSION_TOKEN_V2_TYPE }, primaryType: "SessionTokenV2" as const,
    message: prepared.token,
  };
  let validSignature = false;
  try {
    const recovered = await recoverTypedDataAddress({ ...typedData, signature: signature as Hex });
    validSignature = recovered.toLowerCase() === prepared.token.user.toLowerCase();
  } catch {
    // Contract-wallet signatures do not necessarily have the EOA 65-byte format.
  }
  if (!validSignature) {
    const client = createPublicClient({ chain: baseSepolia, transport: http(cfg.rpc ?? SOEE.rpc) });
    try {
      const magicValue = await client.readContract({
        address: prepared.token.user,
        abi: ERC1271_ABI,
        functionName: "isValidSignature",
        args: [hashTypedData(typedData), signature as Hex],
      });
      validSignature = magicValue.toLowerCase() === ERC1271_MAGIC_VALUE;
    } catch {
      validSignature = false;
    }
  }
  if (!validSignature) throw apiError("Session signature does not match the connected wallet.", 403);
  const hookData = encodeSessionAuthorization(prepared.token, signature as Hex, "2");
  const zeroForOne = prepared.tokenIn.toLowerCase() === prepared.currency0.toLowerCase();
  const approval = prepared.allowance < prepared.totalDebit ? {
    to: prepared.tokenIn,
    data: encodeFunctionData({ abi: ERC20_EXECUTION_ABI, functionName: "approve", args: [cfg.router as Address, prepared.totalDebit] }),
  } : null;
  const swapData = encodeFunctionData({
    abi: ROUTER_EXECUTION_ABI, functionName: "swap",
    args: [
      { currency0: prepared.currency0, currency1: prepared.currency1, fee: prepared.fee, tickSpacing: prepared.tickSpacing, hooks: cfg.hook as Address },
      { zeroForOne, amountSpecified: -prepared.amountIn, sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE : MAX_SQRT_PRICE },
      prepared.minAmountOut, hookData,
    ],
  });
  return {
    approval,
    swap: { to: cfg.router, data: swapData },
    summary: { amountIn: prepared.amountIn.toString(), minAmountOut: prepared.minAmountOut.toString(), symbol: prepared.symbol },
  };
}

function requireNonnegativeDecimal(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
    throw apiError(`${key} must be a non-negative decimal string with at most 18 decimal places.`);
  }
  return value;
}

async function prepareBrowserOrder(body: Record<string, unknown>): Promise<Omit<BrowserPreparedOrder, "challengeId" | "expiresAt"> & { typedData: Record<string, unknown>; approval: Record<string, unknown> | null }> {
  const user = requireAddress(body, "user");
  const direction = body["direction"];
  if (direction !== "zeroForOne" && direction !== "oneForZero") throw apiError("Invalid netting order direction.");
  const ttl = requireUnsignedInteger(body, "ttl");
  if (Number(ttl) < 60 || Number(ttl) > 900) throw apiError("ttl must be between 60 and 900 seconds.");
  const zeroForOne = direction === "zeroForOne";
  const tokenIn = zeroForOne ? SOEE.token0.address : SOEE.token1.address;
  const symbol = zeroForOne ? SOEE.token0.symbol : SOEE.token1.symbol;
  const decimals = zeroForOne ? SOEE.token0.decimals : SOEE.token1.decimals;
  const amountIn = parseUnits(requireDecimalAmount(body, "amountIn"), decimals);
  const minAmountOut = parseUnits(requireDecimalAmount(body, "minAmountOut"), zeroForOne ? SOEE.token1.decimals : SOEE.token0.decimals);
  const maxAmmInput = parseUnits(requireNonnegativeDecimal(body, "maxAmmInput"), decimals);
  if (maxAmmInput > amountIn) throw apiError("Maximum AMM input cannot exceed the signed input amount.");
  const client = createPublicClient({ chain: baseSepolia, transport: http(SOEE.rpc) });
  const [credential, balance, allowance] = await Promise.all([
    client.readContract({ address: SOEE.issuer, abi: CNF_ABI, functionName: "isValid", args: [user] }),
    client.readContract({ address: tokenIn, abi: ERC20_EXECUTION_ABI, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: tokenIn, abi: ERC20_EXECUTION_ABI, functionName: "allowance", args: [user, SOEE.router] }),
  ]);
  if (!credential) throw apiError("This wallet does not have a current SOEE institutional credential.", 409);
  if (balance < amountIn) throw apiError(`Insufficient ${symbol} balance for this signed order.`, 409);
  const order: NettingOrder = {
    user,
    poolId: SOEE.poolId,
    zeroForOne,
    amountIn,
    minAmountOut,
    maxAmmInput,
    deadline: BigInt(Math.floor(Date.now() / 1000) + Number(ttl)),
    nonce: `0x${randomBytes(32).toString("hex")}` as Hex,
  };
  const domain = {
    name: "ILAL Institutional Netting" as const,
    version: "1" as const,
    chainId: SOEE.chainId,
    verifyingContract: SOEE.hook,
  };
  const typedData = {
    domain,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" }, { name: "version", type: "string" },
        { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" },
      ],
      NettingOrder: NETTING_ORDER_COMPONENTS,
    },
    primaryType: "NettingOrder",
    message: {
      ...order,
      amountIn: order.amountIn.toString(), minAmountOut: order.minAmountOut.toString(),
      maxAmmInput: order.maxAmmInput.toString(), deadline: order.deadline.toString(),
    },
  };
  const approval = allowance < amountIn ? {
    to: tokenIn,
    data: encodeFunctionData({ abi: ERC20_EXECUTION_ABI, functionName: "approve", args: [SOEE.router, amountIn] }),
  } : null;
  return { order, domain, tokenIn, symbol, decimals, balance, allowance, typedData, approval };
}

async function browserWalletStatus(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const user = requireAddress(body, "user");
  const client = createPublicClient({ chain: baseSepolia, transport: http(SOEE.rpc) });
  const [credential, balance0, balance1, allowance0, allowance1, blockNumber] = await Promise.all([
    client.readContract({ address: SOEE.issuer, abi: CNF_ABI, functionName: "isValid", args: [user] }),
    client.readContract({ address: SOEE.token0.address, abi: ERC20_EXECUTION_ABI, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: SOEE.token1.address, abi: ERC20_EXECUTION_ABI, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: SOEE.token0.address, abi: ERC20_EXECUTION_ABI, functionName: "allowance", args: [user, SOEE.router] }),
    client.readContract({ address: SOEE.token1.address, abi: ERC20_EXECUTION_ABI, functionName: "allowance", args: [user, SOEE.router] }),
    client.getBlockNumber(),
  ]);
  return {
    user,
    credential,
    blockNumber: blockNumber.toString(),
    router: SOEE.router,
    tokens: [
      { ...SOEE.token0, balanceRaw: balance0.toString(), balance: formatUnits(balance0, SOEE.token0.decimals), allowanceRaw: allowance0.toString() },
      { ...SOEE.token1, balanceRaw: balance1.toString(), balance: formatUnits(balance1, SOEE.token1.decimals), allowanceRaw: allowance1.toString() },
    ],
  };
}

async function saveBrowserOrder(prepared: BrowserPreparedOrder, signature: unknown): Promise<Record<string, unknown>> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) throw apiError("A wallet signature is required.");
  const typedData = {
    domain: prepared.domain,
    types: { NettingOrder: NETTING_ORDER_COMPONENTS },
    primaryType: "NettingOrder" as const,
    message: prepared.order,
  };
  let validSignature = false;
  try {
    const recovered = await recoverTypedDataAddress({ ...typedData, signature: signature as Hex });
    validSignature = recovered.toLowerCase() === prepared.order.user.toLowerCase();
  } catch {
    // Contract wallets are validated below through ERC-1271.
  }
  if (!validSignature) {
    const client = createPublicClient({ chain: baseSepolia, transport: http(SOEE.rpc) });
    try {
      const magicValue = await client.readContract({
        address: prepared.order.user, abi: ERC1271_ABI, functionName: "isValidSignature",
        args: [hashTypedData(typedData), signature as Hex],
      });
      validSignature = magicValue.toLowerCase() === ERC1271_MAGIC_VALUE;
    } catch {
      validSignature = false;
    }
  }
  if (!validSignature) throw apiError("Netting order signature does not match the connected wallet.", 403);
  const name = `order-${Date.now()}-${randomBytes(4).toString("hex")}.json`;
  const file: SignedOrderFile = {
    format: "ilal-netting-order-v1",
    domain: prepared.domain,
    order: serializeOrder(prepared.order),
    signature: signature as Hex,
  };
  writeFileSync(join(consoleDataDir(), name), `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return { name, orderHash: orderHash(prepared.order), nonce: prepared.order.nonce, file };
}

function listOrders(): Array<Record<string, unknown>> {
  return readdirSync(consoleDataDir())
    .filter(name => /^order-[a-zA-Z0-9-]+\.json$/.test(name))
    .map(name => {
      const path = join(consoleDataDir(), name);
      const file = JSON.parse(readFileSync(path, "utf8")) as SignedOrderFile;
      return { name, createdAt: statSync(path).mtime.toISOString(), domain: file.domain, order: file.order };
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function orderPaths(names: unknown): string[] {
  if (!Array.isArray(names) || names.length < 2 || names.length > 16) throw apiError("Choose 2 to 16 local signed orders.");
  return names.map(value => {
    if (typeof value !== "string" || basename(value) !== value || !/^order-[a-zA-Z0-9-]+\.json$/.test(value)) {
      throw apiError("Invalid local order filename.");
    }
    const path = join(consoleDataDir(), value);
    if (!existsSync(path)) throw apiError(`Local order not found: ${value}`, 404);
    return path;
  });
}

function serializePreview(preview: NettingPreview): Record<string, string | number> {
  return {
    batchId: preview.batchId,
    orderCount: preview.orderCount,
    total0: preview.total0.toString(), total1: preview.total1.toString(),
    matchedEachSide: preview.matchedEachSide.toString(),
    residual0: preview.residual0.toString(), residual1: preview.residual1.toString(),
    exposureReduction: preview.exposureReduction.toString(),
  };
}

async function prepareBrowserBatch(names: unknown): Promise<Omit<BrowserPreparedBatch, "challengeId" | "expiresAt">> {
  const paths = orderPaths(names);
  const orderNames = paths.map(path => basename(path));
  const report = await runNettingPreflight({
    orders: paths,
    router: SOEE.router,
    hook: SOEE.hook,
    tokenA: SOEE.token0.address,
    tokenB: SOEE.token1.address,
    fee: String(SOEE.fee),
    tickSpacing: String(SOEE.tickSpacing),
    chain: String(SOEE.chainId),
    rpc: SOEE.rpc,
  }, false);
  if (report.status !== "executable") {
    const reason = report.decodedRevert?.message ?? report.checks.find(check => !check.ok)?.detail ?? report.status;
    throw apiError(`Netting batch preflight rejected: ${reason}`, 409);
  }
  const batch = loadBatch(paths);
  const poolKey = {
    currency0: SOEE.token0.address,
    currency1: SOEE.token1.address,
    fee: SOEE.fee,
    tickSpacing: SOEE.tickSpacing,
    hooks: SOEE.hook,
  };
  const data = encodeFunctionData({
    abi: NETTING_ROUTER_ABI,
    functionName: "executeBatch",
    args: [poolKey, batch.orders, batch.signatures],
  });
  return { orderNames, report, transaction: { to: SOEE.router, data } };
}

function requireUnsignedInteger(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw apiError(`${key} must be an unsigned integer string.`);
  return value;
}

async function signOrder(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!signerSummary().ready) throw apiError("Start the console with --keystore and --password-file, or --rpc-account, before signing.", 409);
  const direction = body["direction"];
  if (direction !== "zeroForOne" && direction !== "oneForZero") throw apiError("Invalid order direction.");
  const name = `order-${Date.now()}-${randomBytes(4).toString("hex")}.json`;
  const result = await nettingOrderSign({
    amountIn: requireUnsignedInteger(body, "amountIn"),
    minAmountOut: requireUnsignedInteger(body, "minAmountOut"),
    maxAmmInput: requireUnsignedInteger(body, "maxAmmInput"),
    ttl: requireUnsignedInteger(body, "ttl"),
    zeroForOne: direction === "zeroForOne",
    oneForZero: direction === "oneForZero",
    pool: SOEE.poolId,
    hook: SOEE.hook,
    chain: String(SOEE.chainId),
    rpc: SOEE.rpc,
    output: join(consoleDataDir(), name),
  });
  return { name, orderHash: result.orderHash, nonce: result.nonce, file: result.file };
}

function mimeType(path: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" } as Record<string, string>)[extname(path)] ?? "application/octet-stream";
}

function serveAsset(response: ServerResponse, assetsDir: string, requestPath: string): void {
  const assetName = requestPath === "/" ? "app.html" : basename(requestPath);
  if (!/^((app|console)\.(html|css|js)|favicon\.svg)$/.test(assetName)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const path = join(assetsDir, assetName);
  if (!existsSync(path)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const body = readFileSync(path);
  response.writeHead(200, {
    "Content-Type": mimeType(path),
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  response.end(body);
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

export async function startConsole(opts: ConsoleOptions): Promise<void> {
  configureFatalErrorHandling("throw");
  const port = Number(opts.port ?? "4173");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Console port must be between 1024 and 65535.");
  const assetsDir = findAssetsDir();
  const token = randomBytes(32).toString("hex");
  const allowedOrigin = `http://${LOOPBACK}:${port}`;
  const preparedSwaps = new Map<string, PreparedSwap>();
  const browserPreparedSwaps = new Map<string, BrowserPreparedSwap>();
  const browserPreparedOrders = new Map<string, BrowserPreparedOrder>();
  const browserPreparedBatches = new Map<string, BrowserPreparedBatch>();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", allowedOrigin);
      if (!url.pathname.startsWith("/api/")) {
        serveAsset(response, assetsDir, url.pathname);
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/session") {
        sendJson(response, 200, { token });
        return;
      }
      if (request.headers.origin && request.headers.origin !== allowedOrigin) throw apiError("Cross-origin request rejected.", 403);
      if (request.method !== "GET" && request.headers["x-ilal-console-token"] !== token) throw apiError("Invalid console session token.", 403);
      if (request.method === "GET" && url.pathname === "/api/status") {
        sendJson(response, 200, await liveStatus());
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/orders") {
        sendJson(response, 200, { orders: listOrders() });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/orders/sign") {
        sendJson(response, 201, await signOrder(await readJson(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-orders/prepare") {
        const prepared = await prepareBrowserOrder(await readJson(request));
        const challengeId = randomBytes(24).toString("hex");
        const expiresAt = Date.now() + SWAP_CHALLENGE_TTL_MS;
        const { typedData, approval, ...stored } = prepared;
        browserPreparedOrders.set(challengeId, { challengeId, expiresAt, ...stored });
        sendJson(response, 200, {
          challengeId, expiresAt: new Date(expiresAt).toISOString(), typedData, approval,
          preview: {
            signer: stored.order.user, tokenIn: stored.tokenIn, tokenSymbol: stored.symbol,
            tokenDecimals: stored.decimals, amountInRaw: stored.order.amountIn.toString(),
            minAmountOutRaw: stored.order.minAmountOut.toString(), maxAmmInputRaw: stored.order.maxAmmInput.toString(),
            approvalRequired: stored.allowance < stored.order.amountIn,
          },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-wallet/status") {
        sendJson(response, 200, await browserWalletStatus(await readJson(request)));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-orders/save") {
        const body = await readJson(request);
        const challengeId = body["challengeId"];
        if (typeof challengeId !== "string") throw apiError("A prepared netting order challenge is required.");
        const prepared = browserPreparedOrders.get(challengeId);
        if (!prepared) throw apiError("This netting order challenge is missing or already used.", 409);
        browserPreparedOrders.delete(challengeId);
        if (prepared.expiresAt <= Date.now()) throw apiError("This netting order challenge expired. Review the order again.", 409);
        sendJson(response, 201, await saveBrowserOrder(prepared, body["signature"]));
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/batches/preview") {
        const body = await readJson(request);
        sendJson(response, 200, { preview: serializePreview(previewNettingOrderFiles(orderPaths(body["orders"]))) });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-batches/prepare") {
        const body = await readJson(request);
        const prepared = await prepareBrowserBatch(body["orders"]);
        const challengeId = randomBytes(24).toString("hex");
        const expiresAt = Date.now() + SWAP_CHALLENGE_TTL_MS;
        browserPreparedBatches.set(challengeId, { challengeId, expiresAt, ...prepared });
        sendJson(response, 200, {
          challengeId, expiresAt: new Date(expiresAt).toISOString(), report: prepared.report,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-batches/build") {
        const body = await readJson(request);
        const challengeId = body["challengeId"];
        if (typeof challengeId !== "string") throw apiError("A prepared netting batch challenge is required.");
        const prepared = browserPreparedBatches.get(challengeId);
        if (!prepared) throw apiError("This netting batch challenge is missing or already used.", 409);
        browserPreparedBatches.delete(challengeId);
        if (prepared.expiresAt <= Date.now()) throw apiError("This netting batch challenge expired. Run preflight again.", 409);
        const refreshed = await prepareBrowserBatch(prepared.orderNames);
        sendJson(response, 200, { transaction: refreshed.transaction, report: refreshed.report });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/swaps/prepare") {
        const prepared = await preflightSwap(await readJson(request));
        const challengeId = randomBytes(24).toString("hex");
        const expiresAt = Date.now() + SWAP_CHALLENGE_TTL_MS;
        preparedSwaps.set(challengeId, { challengeId, expiresAt, ...prepared });
        for (const [id, value] of preparedSwaps) {
          if (value.expiresAt <= Date.now()) preparedSwaps.delete(id);
        }
        sendJson(response, 200, {
          challengeId,
          expiresAt: new Date(expiresAt).toISOString(),
          confirmation: SWAP_CONFIRMATION,
          preview: prepared.preview,
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/swaps/broadcast") {
        const body = await readJson(request);
        const challengeId = body["challengeId"];
        if (typeof challengeId !== "string") throw apiError("A prepared swap challenge is required.");
        if (body["confirmation"] !== SWAP_CONFIRMATION) throw apiError(`Type ${SWAP_CONFIRMATION} to confirm broadcast.`);
        const prepared = preparedSwaps.get(challengeId);
        if (!prepared) throw apiError("This swap challenge is missing or has already been used.", 409);
        preparedSwaps.delete(challengeId);
        if (prepared.expiresAt <= Date.now()) throw apiError("This swap challenge expired. Run preflight again.", 409);
        const result = await swap({
          amountIn: prepared.amountIn,
          minAmountOut: prepared.minAmountOut,
          tokenIn: prepared.tokenIn,
          ttl: prepared.ttl,
          simulate: false,
        });
        sendJson(response, 200, { result });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-swaps/prepare") {
        const prepared = await prepareBrowserSwap(await readJson(request));
        const challengeId = randomBytes(24).toString("hex");
        const expiresAt = Date.now() + SWAP_CHALLENGE_TTL_MS;
        const { typedData, ...stored } = prepared;
        browserPreparedSwaps.set(challengeId, { challengeId, expiresAt, ...stored });
        sendJson(response, 200, {
          challengeId, expiresAt: new Date(expiresAt).toISOString(), typedData,
          preview: {
            signer: stored.token.user, tokenIn: stored.tokenIn, tokenSymbol: stored.symbol,
            tokenDecimals: stored.decimals, amountInRaw: stored.amountIn.toString(),
            minAmountOutRaw: stored.minAmountOut.toString(), totalDebitRaw: stored.totalDebit.toString(),
            approvalRequired: stored.allowance < stored.totalDebit,
          },
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/browser-swaps/build") {
        const body = await readJson(request);
        const challengeId = body["challengeId"];
        if (typeof challengeId !== "string") throw apiError("A prepared browser swap challenge is required.");
        const prepared = browserPreparedSwaps.get(challengeId);
        if (!prepared) throw apiError("This browser swap challenge is missing or already used.", 409);
        browserPreparedSwaps.delete(challengeId);
        if (prepared.expiresAt <= Date.now()) throw apiError("This browser swap challenge expired. Run preflight again.", 409);
        sendJson(response, 200, await buildBrowserSwap(prepared, body["signature"]));
        return;
      }
      throw apiError("API route not found.", 404);
    } catch (error) {
      const api = error as ApiError;
      sendJson(response, api.statusCode ?? 500, { error: api.message || "Unexpected local console error." });
    }
  });

  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK, () => resolveReady());
  });
  const url = `${allowedOrigin}/app.html`;
  console.log(`\nILAL Local Institutional Console\n${url}`);
  console.log("Bound to 127.0.0.1 only. Press Ctrl+C to stop.\n");
  if (opts.open !== false) openBrowser(url);
  await new Promise<void>(() => undefined);
}
