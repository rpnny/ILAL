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
import { fmt, log, header, die, requirePrivateKey } from "../ui.js";
import { withConfig } from "../config.js";

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
  pool?: string;
  action: string;
  hook?: string;
  issuer?: string;
  caller?: string;
  chain?: string;
  ttl: number;
  privateKey?: string;
}) {
  const cfg = withConfig({ chain: opts.chain, hook: opts.hook, issuer: opts.issuer });

  // Resolve private key
  const rawKey = requirePrivateKey(opts.privateKey ?? process.env["PRIVATE_KEY"]);

  const account = privateKeyToAccount(rawKey);
  const user = (opts.user ?? account.address) as `0x${string}`;
  const pool = opts.pool ?? cfg.poolId;
  const hook = opts.hook ?? cfg.hook;
  const issuer = opts.issuer ?? cfg.issuer;
  const authorizedCaller = (opts.caller ?? cfg.router ?? user) as `0x${string}`;
  const chainId = opts.chain ?? cfg.chain ?? "84532";

  if (!isAddress(user)) die(`Invalid user address: ${user}`);
  if (!isAddress(authorizedCaller)) die(`Invalid authorized caller address: ${authorizedCaller}`);
  if (!hook || !isAddress(hook)) die(`Invalid hook address: ${hook ?? "<missing>"}. Use --hook or run ilal init.`);
  if (!issuer || !isAddress(issuer)) die(`Invalid issuer address: ${issuer ?? "<missing>"}. Use --issuer or run ilal init.`);
  if (!pool || !isHex(pool) || pool.length !== 66) die("poolId must be a 32-byte hex string. Use --pool or run ilal init.");

  const actionKey = opts.action.toLowerCase().replace(/[^a-z]/g, "");
  const actionCode = ACTIONS[actionKey];
  if (actionCode === undefined) die(`Unknown action "${opts.action}". Use: swap | addLiquidity | removeLiquidity`);

  const chain = CHAINS[chainId] ?? baseSepolia;
  const walletClient = createWalletClient({ account, chain, transport: http() });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + opts.ttl);
  const nonce = `0x${Buffer.from(
    crypto.getRandomValues(new Uint8Array(32))
  ).toString("hex")}` as `0x${string}`;

  const token = {
    user,
    authorizedCaller,
    cnfIssuer: issuer as `0x${string}`,
    chainId: BigInt(chain.id),
    verifyingHook: hook as `0x${string}`,
    poolId: pool as `0x${string}`,
    action: actionCode,
    deadline,
    nonce: nonce as `0x${string}`,
  };

  header("Session Sign", chain.name);
  log.section("Session");
  log.kv("user", fmt.addr(user));
  log.kv("caller", fmt.addr(authorizedCaller));
  log.kv("chain", `${chain.name} (${chain.id})`);
  log.kv("pool", fmt.hash(pool));
  log.kv("action", opts.action);
  log.kv("hook", fmt.addr(hook));
  log.kv("issuer", fmt.addr(issuer));
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
      verifyingContract: hook as `0x${string}`,
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
  console.log(fmt.gray("  note: this hookData is a one-time authorization; nonce replay is blocked on-chain"));
  console.log();
}
