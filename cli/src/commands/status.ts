/**
 * status.ts — `ilal status`
 *
 * Dashboard: credential validity, hook config, pool policy — all in one view.
 */

import { createPublicClient, http, isAddress, type Chain } from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";

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

function daysUntil(unixSec: number): number {
  return Math.floor((unixSec * 1000 - Date.now()) / 86_400_000);
}

export async function status(opts: {
  wallet?:   string;
  issuer?:   string;
  hook?:     string;
  registry?: string;
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
