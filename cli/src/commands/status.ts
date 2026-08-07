/**
 * status.ts — `ilal status`
 *
 * Dashboard: credential validity, hook config, pool policy — all in one view.
 */

import { createPublicClient, formatUnits, http, isAddress, isHex, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, dieOnContract } from "../ui.js";
import { withConfig, type ILALConfig } from "../config.js";
import { readEligibilityPolicyV2 } from "./policyV2.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

const CNF_ABI = [
  { name: "isValid",      type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "credentialOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "wallet", type: "address" as const }], outputs: [{ name: "tokenId", type: "uint256" as const }] },
  { name: "getCredential", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "tokenId", type: "uint256" as const }], outputs: [{ type: "tuple" as const, components: [{ name: "holder", type: "address" as const }, { name: "issuer", type: "address" as const }, { name: "credentialType", type: "bytes32" as const }, { name: "issuedAt", type: "uint64" as const }, { name: "expiresAt", type: "uint64" as const }, { name: "revoked", type: "bool" as const }] }] },
  { name: "merkleRoot",   type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint256" as const }] },
  { name: "zkVerifier",   type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "eas",          type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
  { name: "issuerMetadata", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [
    { name: "name", type: "string" as const },
    { name: "jurisdiction", type: "string" as const },
    { name: "credentialStandard", type: "string" as const },
    { name: "uri", type: "string" as const },
  ] },
] as const;

const HOOK_ABI = [
  { name: "issuer", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

const REGISTRY_ABI = [
  { name: "getPolicy", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "poolId", type: "bytes32" as const }], outputs: [{ type: "tuple" as const, components: [{ name: "cnfIssuer", type: "address" as const }, { name: "requiredCredentialType", type: "bytes32" as const }, { name: "enabled", type: "bool" as const }] }] },
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const HOOK_V2_ABI = [
  { name: "authorizedRouter", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "address" as const }] },
] as const;

const GRANT_V2_ABI = [
  { name: "isPolicyGrantValid", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "poolId", type: "bytes32" as const }, { name: "user", type: "address" as const }], outputs: [{ type: "bool" as const }] },
  { name: "grants", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "poolId", type: "bytes32" as const }, { name: "user", type: "address" as const }], outputs: [{ name: "policyHash", type: "uint256" as const }, { name: "expiresAt", type: "uint64" as const }, { name: "policyRevision", type: "uint64" as const }] },
] as const;

const ERC20_STATUS_ABI = [
  { name: "symbol", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "string" as const }] },
  { name: "decimals", type: "function" as const, stateMutability: "view" as const, inputs: [], outputs: [{ type: "uint8" as const }] },
  { name: "balanceOf", type: "function" as const, stateMutability: "view" as const, inputs: [{ name: "owner", type: "address" as const }], outputs: [{ type: "uint256" as const }] },
] as const;

function daysUntil(unixSec: number): number {
  return Math.floor((unixSec * 1000 - Date.now()) / 86_400_000);
}

async function statusV2(
  cfg: ILALConfig & { wallet?: string },
  chain: Chain,
  client: ReturnType<typeof createPublicClient>,
  poolId?: string
) {
  const requiredAddresses = [
    ["hook", cfg.hook],
    ["registry", cfg.registry],
    ["grant manager", cfg.grantManager],
    ["router", cfg.router],
  ] as const;
  log.section("V2 Infrastructure");
  let infrastructureReady = true;
  for (const [label, address] of requiredAddresses) {
    if (!address || !isAddress(address)) {
      log.kv(label, fmt.badge("missing", "red"));
      infrastructureReady = false;
      continue;
    }
    const code = await client.getBytecode({ address: address as `0x${string}` });
    const ready = !!code && code !== "0x";
    log.kv(label, ready ? fmt.addr(address) : `${fmt.addr(address)} ${fmt.badge("no code", "red")}`);
    infrastructureReady &&= ready;
  }
  let routerBindingReady = false;
  if (cfg.hook && cfg.router && isAddress(cfg.hook) && isAddress(cfg.router)) {
    try {
      const authorizedRouter = await client.readContract({
        address: cfg.hook as `0x${string}`,
        abi: HOOK_V2_ABI,
        functionName: "authorizedRouter",
      });
      routerBindingReady = authorizedRouter.toLowerCase() === cfg.router.toLowerCase();
      log.kv("router binding", routerBindingReady
        ? `${fmt.badge("bound", "green")} ${fmt.addr(authorizedRouter)}`
        : `${fmt.badge("mismatch", "red")} ${fmt.addr(authorizedRouter)}`);
    } catch {
      log.kv("router binding", fmt.badge("unreadable", "red"));
    }
  }
  infrastructureReady &&= routerBindingReady;
  log.line();

  let policyReady = false;
  let policyRevision = 0n;
  let policyHash = 0n;
  if (cfg.registry && isAddress(cfg.registry) && poolId && isHex(poolId) && poolId.length === 66) {
    const policy = await readEligibilityPolicyV2(
      client,
      cfg.registry as `0x${string}`,
      poolId as `0x${string}`
    );
    policyReady = policy.enabled && policy.revision > 0n;
    policyRevision = policy.revision;
    policyHash = policy.policyHash;
    log.section("Eligibility Policy");
    log.kv("pool", fmt.hash(poolId));
    log.kv("status", policy.enabled ? fmt.badge("enabled", "green") : fmt.badge("disabled", "red"));
    log.kv("policy hash", policy.policyHash.toString());
    log.kv("revision", policy.revision.toString());
    log.kv("minimum KYC", policy.minKycLevel.toString());
    log.kv("max grant TTL", `${policy.maxGrantTTL.toString()}s`);
    log.kv("credential root", policy.credentialRoot.toString());
    log.kv("jurisdiction root", policy.jurisdictionRoot.toString());
    log.line();
  } else {
    log.section("Eligibility Policy");
    log.kv("status", fmt.badge("missing config", "red"));
    log.line();
  }

  const wallet = cfg.wallet;
  let grantReady = false;
  let balancesReady = false;
  if (wallet && isAddress(wallet) && cfg.grantManager && isAddress(cfg.grantManager) && poolId && isHex(poolId) && poolId.length === 66) {
    const [valid, grant] = await Promise.all([
      client.readContract({ address: cfg.grantManager as `0x${string}`, abi: GRANT_V2_ABI, functionName: "isPolicyGrantValid", args: [poolId as `0x${string}`, wallet as `0x${string}`] }),
      client.readContract({ address: cfg.grantManager as `0x${string}`, abi: GRANT_V2_ABI, functionName: "grants", args: [poolId as `0x${string}`, wallet as `0x${string}`] }),
    ]);
    grantReady = valid;
    log.section("Wallet Policy Grant");
    log.kv("wallet", fmt.addr(wallet));
    log.kv("status", valid ? fmt.badge("valid", "green") : fmt.badge("missing / stale", "red"));
    log.kv("policy hash", grant[0].toString());
    log.kv("revision", grant[2].toString());
    log.kv("expires", grant[1] === 0n ? "not activated" : new Date(Number(grant[1]) * 1000).toISOString());
    if (!valid) log.command("ilal policy proof generate --input <private-input.json>");
    if (!valid) log.command("ilal policy grant activate --proof <proof.json> --public <public.json>");
    log.line();

    const balances: boolean[] = [];
    log.section("Wallet Balances");
    for (const [label, token] of [["currency0", cfg.tokenA], ["currency1", cfg.tokenB]] as const) {
      if (!token || !isAddress(token)) {
        log.kv(label, fmt.badge("missing token config", "red"));
        balances.push(false);
        continue;
      }
      const [symbol, decimals, balance] = await Promise.all([
        client.readContract({ address: token as `0x${string}`, abi: ERC20_STATUS_ABI, functionName: "symbol" }),
        client.readContract({ address: token as `0x${string}`, abi: ERC20_STATUS_ABI, functionName: "decimals" }),
        client.readContract({ address: token as `0x${string}`, abi: ERC20_STATUS_ABI, functionName: "balanceOf", args: [wallet as `0x${string}`] }),
      ]);
      const funded = balance > 0n;
      balances.push(funded);
      log.kv(label, `${formatUnits(balance, decimals)} ${symbol} ${funded ? fmt.badge("funded", "green") : fmt.badge("empty", "red")}`);
    }
    balancesReady = balances.length === 2 && balances.every(Boolean);
    log.line();
  } else {
    log.info("Pass --wallet to include v2 policy-grant and balance readiness.");
    log.line();
  }

  const walletSelected = !!wallet && isAddress(wallet);
  const realTxReady = infrastructureReady && policyReady && (!walletSelected || (grantReady && balancesReady));
  log.section("Access Verdict");
  log.metrics([
    { label: "infra", value: infrastructureReady ? "ready" : "incomplete", tone: infrastructureReady ? "green" : "red" },
    { label: "policy", value: policyReady ? `rev ${policyRevision}` : "not ready", tone: policyReady ? "green" : "red" },
    { label: "grant", value: walletSelected ? (grantReady ? "valid" : "missing") : "not checked", tone: grantReady ? "green" : "yellow" },
    { label: "balances", value: walletSelected ? (balancesReady ? "funded" : "missing") : "not checked", tone: balancesReady ? "green" : "yellow" },
  ]);
  if (realTxReady) {
    log.callout("V2 flow ready", `policy ${policyHash.toString()} and wallet execution state are aligned`, "green");
  } else {
    log.callout("V2 flow not ready", "fix the failing infrastructure, policy, grant, or balance check above", "yellow");
  }
  console.log();
}

export async function status(opts: {
  wallet?:   string;
  issuer?:   string;
  hook?:     string;
  registry?: string;
  grantManager?: string;
  protocolVersion?: string;
  pool?:     string;
  chain?:    string;
  rpc?:      string;
}) {
  const cfg = withConfig(opts);
  const chain = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const transport = cfg.rpc ? http(cfg.rpc) : http();
  const client = createPublicClient({ chain, transport });
  const poolId = cfg.pool ?? cfg.poolId;

  header("ILAL Status", chain.name);
  if (cfg.protocolVersion === "2") {
    await statusV2(cfg, chain, client, poolId);
    return;
  }
  let credentialReady: boolean | undefined;
  let issuerReady: boolean | undefined;
  let policyReady: boolean | undefined;

  // ── Credential ──────────────────────────────────────────────────────────────
  if (cfg.wallet && cfg.issuer) {
    if (!isAddress(cfg.wallet)) { log.warn("Invalid wallet address"); }
    else if (!isAddress(cfg.issuer)) { log.warn("Invalid issuer address"); }
    else {
      const spin = new Spinner("Fetching credential…").start();
      try {
        const [valid, tokenId] = await Promise.all([
          client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "isValid", args: [cfg.wallet as `0x${string}`] }),
          client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "credentialOf", args: [cfg.wallet as `0x${string}`] }),
        ]) as [boolean, bigint];

        spin.stop();

        log.section("Credential");
        log.kv("wallet", fmt.cyan(cfg.wallet));
        log.kv("issuer", fmt.cyan(cfg.issuer));

        if (tokenId === 0n) {
          log.kv("status", fmt.badge("missing", "red"));
          log.command("ilal credential prove --wallet " + cfg.wallet);
          console.log(fmt.gray("If root mismatch occurs, ask the issuer to queue and activate the updated root via `ilal oracle`."));
          credentialReady = false;
        } else {
          const cred = await client.readContract({
            address: cfg.issuer as `0x${string}`, abi: CNF_ABI,
            functionName: "getCredential", args: [tokenId],
          }) as { holder: string; issuer: string; credentialType: string; issuedAt: bigint; expiresAt: bigint; revoked: boolean };

          const days = daysUntil(Number(cred.expiresAt));
          const expiryStr = new Date(Number(cred.expiresAt) * 1000).toISOString().split("T")[0]!;
          const daysLabel = days > 0
            ? fmt.gray(`(${days}d remaining)`)
            : fmt.red("(EXPIRED)");

          log.kv("token ID",  fmt.cyan(`#${tokenId}`));
          log.kv("issued",    fmt.gray(new Date(Number(cred.issuedAt) * 1000).toISOString().split("T")[0]!));
          log.kv("expires",   `${fmt.cyan(expiryStr)} ${daysLabel}`);
          log.kv("revoked",   cred.revoked ? fmt.badge("yes", "red") : fmt.badge("no", "gray"));
          log.kv("status",    valid ? fmt.badge("valid", "green") + " can trade" : fmt.badge("invalid", "red"));
          credentialReady = valid;
        }
      } catch (e) {
        spin.stop();
        dieOnContract(e);
      }
      log.line();
    }
  }

  // ── Issuer config ────────────────────────────────────────────────────────────
  if (cfg.issuer && isAddress(cfg.issuer)) {
    const spin = new Spinner("Fetching issuer config…").start();
    try {
      const [root, verifier, eas] = await Promise.all([
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "merkleRoot" }) as Promise<bigint>,
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "zkVerifier" }) as Promise<string>,
        client.readContract({ address: cfg.issuer as `0x${string}`, abi: CNF_ABI, functionName: "eas" }) as Promise<string>,
      ]);
      spin.stop();
      const hasEASPath = eas !== ZERO_ADDRESS;
      const hasZKPath = root !== 0n && verifier !== ZERO_ADDRESS;

      log.section("Issuer");
      log.kv("address",   fmt.cyan(cfg.issuer));
      try {
        const meta = await client.readContract({
          address: cfg.issuer as `0x${string}`,
          abi: CNF_ABI,
          functionName: "issuerMetadata",
        }) as readonly [string, string, string, string];
        if (meta[0]) log.kv("name", meta[0]);
        if (meta[1]) log.kv("jurisdiction", meta[1]);
        if (meta[2]) log.kv("standard", meta[2]);
        if (meta[3]) log.kv("uri", fmt.gray(meta[3]));
      } catch {
        log.kv("metadata", fmt.badge("legacy issuer", "yellow"));
      }
      log.kv("issuance", hasEASPath
        ? `${fmt.badge("EAS", "green")} ${fmt.addr(eas)}`
        : hasZKPath
          ? fmt.badge("ZK", "green")
          : fmt.badge("not ready", "red"));
      log.kv("zkVerifier", verifier === ZERO_ADDRESS
        ? fmt.badge(hasEASPath ? "not configured" : "not set", hasEASPath ? "yellow" : "red")
        : fmt.green(fmt.addr(verifier)));
      log.kv("merkleRoot", root === 0n
        ? fmt.badge(hasEASPath ? "not configured" : "not set", hasEASPath ? "yellow" : "red")
        : fmt.gray(root.toString().slice(0, 20) + "…"));
      if (hasEASPath && !hasZKPath) {
        log.info("This deployment uses EAS issuance. Run the local ZK proof flow only against a separate issuer with an active verifier and Merkle root.");
      }
      issuerReady = hasEASPath || hasZKPath;
    } catch (e) {
      spin.stop();
      log.warn(`Could not fetch issuer config: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
    log.line();
  }

  // ── Pool policy ──────────────────────────────────────────────────────────────
  if (cfg.registry && poolId && isAddress(cfg.registry)) {
    const spin = new Spinner("Fetching pool policy…").start();
    try {
      const policy = await client.readContract({
        address: cfg.registry as `0x${string}`, abi: REGISTRY_ABI,
        functionName: "getPolicy", args: [poolId as `0x${string}`],
      }) as { cnfIssuer: string; requiredCredentialType: string; enabled: boolean };

      spin.stop();
      const configured = policy.enabled && policy.cnfIssuer !== "0x0000000000000000000000000000000000000000";

      log.section("Pool Policy");
      log.kv("pool",     fmt.hash(poolId));
      log.kv("registry", fmt.cyan(cfg.registry));
      if (configured) {
        log.kv("issuer",  fmt.addr(policy.cnfIssuer));
        log.kv("schema",  fmt.hash(policy.requiredCredentialType));
        log.kv("status",  fmt.badge("configured", "green"));
      } else {
        log.kv("status", fmt.badge("missing", "red"));
        log.command("ilal pool policy set --pool " + poolId);
      }
      policyReady = configured;
    } catch (e) {
      spin.stop();
      log.warn(`Could not fetch policy: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
    log.line();
  }

  // ── Hint if nothing was shown ────────────────────────────────────────────────
  if (!cfg.wallet && !cfg.issuer && !cfg.registry) {
    log.info("Pass --wallet and --issuer to check credential status.");
    log.info(`Or run ${fmt.cyan("ilal init")} to save your config.`);
    console.log();
  } else {
    const checks = [credentialReady, issuerReady, policyReady].filter((v): v is boolean => v !== undefined);
    if (checks.length > 0) {
      const passed = checks.filter(Boolean).length;
      const readiness = Math.round((passed / checks.length) * 100);
      const tone = readiness >= 85 ? "green" : readiness >= 60 ? "yellow" : "red";
      log.section("Access Verdict");
      log.progress("readiness", readiness, tone);
      if (readiness >= 85) {
        log.callout("Wallet can use ILAL", "credential and pool policy are aligned for hook-gated execution", "green");
      } else {
        log.callout("Wallet is not ready", "fix the failing credential, issuer, or policy check above", tone);
      }
      console.log();
    }
  }
}
