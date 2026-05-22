import {
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
import { fmt, log, header, die } from "../ui.js";

const CHAINS: Record<string, Chain> = {
  "8453": base,
  "84532": baseSepolia,
};

const ACTIONS: Record<string, number> = {
  swap: 1,
  addliquidity: 2,
  removeliquidity: 3,
};

const SESSION_TOKEN_TYPE = [
  { name: "user", type: "address" },
  { name: "authorizedCaller", type: "address" },
  { name: "cnfIssuer", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingHook", type: "address" },
  { name: "poolId", type: "bytes32" },
  { name: "action", type: "uint8" },
  { name: "deadline", type: "uint64" },
  { name: "nonce", type: "bytes32" },
] as const;

const HOOK_DATA_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, address cnfIssuer, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

export async function sessionSign(opts: {
  user?: string;
  pool: string;
  action: string;
  hook: string;
  issuer: string;
  caller?: string;
  chain: string;
  ttl: number;
  privateKey?: string;
}) {
  // Resolve private key
  const rawKey = opts.privateKey ?? process.env["PRIVATE_KEY"];
  if (!rawKey) die("Private key required. Use --private-key or set PRIVATE_KEY env var.");
  if (!isHex(rawKey) || rawKey.length !== 66) die("Invalid private key format (expected 0x + 32 bytes).");

  const account = privateKeyToAccount(rawKey as `0x${string}`);
  const user = (opts.user ?? account.address) as `0x${string}`;
  const authorizedCaller = (opts.caller ?? user) as `0x${string}`;

  if (!isAddress(user)) die(`Invalid user address: ${user}`);
  if (!isAddress(authorizedCaller)) die(`Invalid authorized caller address: ${authorizedCaller}`);
  if (!isAddress(opts.hook)) die(`Invalid hook address: ${opts.hook}`);
  if (!isAddress(opts.issuer)) die(`Invalid issuer address: ${opts.issuer}`);
  if (!isHex(opts.pool) || opts.pool.length !== 66) die("poolId must be a 32-byte hex string (0x + 64 chars).");

  const actionKey = opts.action.toLowerCase().replace(/[^a-z]/g, "");
  const actionCode = ACTIONS[actionKey];
  if (actionCode === undefined) die(`Unknown action "${opts.action}". Use: swap | addLiquidity | removeLiquidity`);

  const chain = CHAINS[opts.chain] ?? baseSepolia;
  const walletClient = createWalletClient({ account, chain, transport: http() });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + opts.ttl);
  const nonce = `0x${Buffer.from(
    crypto.getRandomValues(new Uint8Array(32))
  ).toString("hex")}` as `0x${string}`;

  const token = {
    user,
    authorizedCaller,
    cnfIssuer: opts.issuer as `0x${string}`,
    chainId: BigInt(chain.id),
    verifyingHook: opts.hook as `0x${string}`,
    poolId: opts.pool as `0x${string}`,
    action: actionCode,
    deadline,
    nonce: nonce as `0x${string}`,
  };

  header("Session Sign", chain.name);
  log.section("Session");
  log.kv("user", fmt.addr(user));
  log.kv("caller", fmt.addr(authorizedCaller));
  log.kv("chain", chain.name);
  log.kv("pool", fmt.hash(opts.pool));
  log.kv("action", opts.action);
  log.kv("hook", fmt.addr(opts.hook));
  log.kv("issuer", fmt.addr(opts.issuer));
  log.kv("deadline", new Date(Number(deadline) * 1000).toISOString());
  log.line();

  log.step("Signing EIP-712 session token locally…");
  log.step(fmt.gray("(no ILAL API call — pure local operation)"));

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: "ILAL ComplianceHook",
      version: "1",
      chainId: BigInt(chain.id),
      verifyingContract: opts.hook as `0x${string}`,
    },
    types: { SessionToken: SESSION_TOKEN_TYPE },
    primaryType: "SessionToken",
    message: token,
  });

  const hookData = encodeAbiParameters(HOOK_DATA_ABI, [token, signature]);

  log.result("Session signed", fmt.badge("local", "green"), "green");
  log.section("Output");
  log.kv("signature", fmt.hash(signature));
  log.kv("hookData", fmt.hash(hookData));
  log.line();

  console.log(`  ${fmt.bold("Full hookData")}`);
  console.log();
  console.log(`  ${fmt.cyan(hookData)}`);
  console.log();
  console.log(fmt.gray("  verifies: caller, deadline, chainId, hook, pool, action, sig, CNF"));
  console.log();
}
