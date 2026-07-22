import {
  createPublicClient,
  http,
  isAddress,
  isHex,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, die } from "../ui.js";
import { withConfig } from "../config.js";
import { protocolVersion, signSessionAuthorization } from "../sessionProtocol.js";
import { readEligibilityPolicyV2 } from "./policyV2.js";
import { createExecutionClients } from "../signer.js";

const CHAINS: Record<string, Chain> = {
  "8453": base,
  "84532": baseSepolia,
};

const ACTIONS: Record<string, number> = {
  swap: 1,
  addliquidity: 2,
  removeliquidity: 3,
};

export async function sessionSign(opts: {
  user?: string;
  pool?: string;
  action: string;
  hook?: string;
  issuer?: string;
  caller?: string;
  chain?: string;
  protocolVersion?: string;
  registry?: string;
  ttl: number;
  privateKey?: string;
}) {
  const cfg = withConfig({
    chain: opts.chain,
    hook: opts.hook,
    issuer: opts.issuer,
    registry: opts.registry,
    protocolVersion: opts.protocolVersion,
  });
  let version: "1" | "2";
  try {
    version = protocolVersion(cfg.protocolVersion);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  const chainId = opts.chain ?? cfg.chain ?? "84532";
  const chain = CHAINS[chainId] ?? baseSepolia;
  const { account, address, walletClient } = await createExecutionClients({
    chain,
    rpc: cfg.rpc,
    legacyPrivateKey: opts.privateKey,
  });
  const user = (opts.user ?? address) as `0x${string}`;
  const pool = opts.pool ?? cfg.poolId;
  const hook = opts.hook ?? cfg.hook;
  const issuer = opts.issuer ?? cfg.issuer;
  const authorizedCaller = (opts.caller ?? cfg.router ?? user) as `0x${string}`;

  if (!isAddress(user)) die(`Invalid user address: ${user}`);
  if (user.toLowerCase() !== address.toLowerCase()) {
    die("--user must match the configured signer. Supply external ERC-1271 hookData for contract wallets.");
  }
  if (!isAddress(authorizedCaller)) die(`Invalid authorized caller address: ${authorizedCaller}`);
  if (!hook || !isAddress(hook)) die(`Invalid hook address: ${hook ?? "<missing>"}. Use --hook or run ilal init.`);
  if (version === "1" && (!issuer || !isAddress(issuer))) die(`Invalid issuer address: ${issuer ?? "<missing>"}. Use --issuer or run ilal init.`);
  if (version === "2" && (!cfg.registry || !isAddress(cfg.registry))) die("EligibilityPolicyRegistryV2 address required for a v2 session");
  if (!pool || !isHex(pool) || pool.length !== 66) die("poolId must be a 32-byte hex string. Use --pool or run ilal init.");

  const actionKey = opts.action.toLowerCase().replace(/[^a-z]/g, "");
  const actionCode = ACTIONS[actionKey];
  if (actionCode === undefined) die(`Unknown action "${opts.action}". Use: swap | addLiquidity | removeLiquidity`);

  let policyHash: bigint | undefined;
  let policyRevision: bigint | undefined;
  if (version === "2") {
    const publicClient = createPublicClient({ chain, transport: http(cfg.rpc) });
    const policy = await readEligibilityPolicyV2(
      publicClient,
      cfg.registry as `0x${string}`,
      pool as `0x${string}`
    );
    if (!policy.enabled || policy.revision === 0n) die("The v2 eligibility policy is not enabled for this pool");
    policyHash = policy.policyHash;
    policyRevision = policy.revision;
  }

  const signed = await signSessionAuthorization({
    walletClient,
    account,
    version,
    authorizedCaller,
    issuer: issuer as `0x${string}` | undefined,
    policyHash,
    policyRevision,
    chainId: BigInt(chain.id),
    hook: hook as `0x${string}`,
    poolId: pool as `0x${string}`,
    action: actionCode,
    ttl: opts.ttl,
  });

  header("Session Sign", chain.name);
  log.section("Session");
  log.kv("user", fmt.addr(user));
  log.kv("caller", fmt.addr(authorizedCaller));
  log.kv("chain", `${chain.name} (${chain.id})`);
  log.kv("pool", fmt.hash(pool));
  log.kv("action", opts.action);
  log.kv("protocol", `v${version}`);
  log.kv("hook", fmt.addr(hook));
  if (version === "1") log.kv("issuer", fmt.addr(issuer!));
  else {
    log.kv("policy hash", policyHash!.toString());
    log.kv("policy revision", policyRevision!.toString());
  }
  log.kv("deadline", new Date(Number(signed.token.deadline) * 1000).toISOString());
  log.line();

  log.step("Signing EIP-712 session token locally…");
  log.step(fmt.gray("(no ILAL API call — pure local operation)"));

  log.result("Session signed", fmt.badge("local", "green"), "green");
  log.section("Output");
  log.kv("signature", fmt.hash(signed.signature));
  log.kv("hookData", fmt.hash(signed.hookData));
  log.line();

  console.log(`  ${fmt.bold("Full hookData")}`);
  console.log();
  console.log(`  ${fmt.cyan(signed.hookData)}`);
  console.log();
  console.log(fmt.gray(`  verifies: caller, deadline, chainId, hook, pool, action, sig, ${version === "2" ? "policy grant" : "CNF"}`));
  console.log(fmt.gray("  note: this hookData is a one-time authorization; nonce replay is blocked on-chain"));
  console.log();
}
