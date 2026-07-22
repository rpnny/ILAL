/**
 * oracle.ts — `ilal oracle`
 *
 * Operator-only commands for managing the CNFIssuer Merkle root,
 * ZK verifier, and ZK public-input domain via timelock mechanisms.
 *
 * Every trust change uses a 2-step propose → activate flow. Root changes wait
 * 48 hours; verifier and public-input domain changes wait 72 hours. Only the
 * contract owner can call these functions.
 *
 * Usage:
 *   # Step 1 — queue a new root (requires owner key, executes immediately)
 *   ilal --keystore issuer.json oracle propose-root \
 *     --root 0xDEADBEEF... \
 *     --issuer 0x335413...
 *
 *   # Step 2 — after ROOT_DELAY (48 h) has elapsed, activate it
 *   ilal --keystore issuer.json oracle activate-root \
 *     --issuer 0x335413...
 *
 *   # Same pattern for the ZK verifier (VERIFIER_DELAY = 72 h)
 *   ilal --keystore issuer.json oracle propose-verifier --verifier 0x... --issuer 0x...
 *   ilal --keystore issuer.json oracle activate-verifier --issuer 0x...
 *
 *   # Bind ZK proofs to one issuer/schema domain (ZK_DOMAIN_DELAY = 72 h)
 *   ilal --keystore issuer.json oracle propose-domain \
 *     --issuer-hash <uint256> --schema-hash <uint256> --issuer 0x...
 *   ilal --keystore issuer.json oracle activate-domain --issuer 0x...
 */

import {
  isAddress,
  type Chain,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { fmt, log, header, Spinner, die, dieOnContract } from "../ui.js";
import { withConfig } from "../config.js";
import { createExecutionClients } from "../signer.js";

const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };

const ORACLE_ABI = [
  {
    name: "proposeMerkleRoot", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [{ name: "_root", type: "uint256" as const }], outputs: [],
  },
  {
    name: "activateMerkleRoot", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [], outputs: [],
  },
  {
    name: "proposeZKVerifier", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [{ name: "_verifier", type: "address" as const }], outputs: [],
  },
  {
    name: "activateZKVerifier", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [], outputs: [],
  },
  {
    name: "proposeZKPublicInputHashes", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [
      { name: "_issuerHash", type: "uint256" as const },
      { name: "_schemaHash", type: "uint256" as const },
    ], outputs: [],
  },
  {
    name: "activateZKPublicInputHashes", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [], outputs: [],
  },
  {
    name: "pendingRoot", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "pendingRootActivatesAt", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "pendingZKVerifier", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "address" as const }],
  },
  {
    name: "pendingVerifierActivatesAt", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "pendingZKIssuerHash", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "pendingZKSchemaHash", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "pendingZKDomainActivatesAt", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "ROOT_DELAY", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "VERIFIER_DELAY", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "ZK_DOMAIN_DELAY", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "merkleRoot", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "zkIssuerHash", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
  {
    name: "zkSchemaHash", type: "function" as const, stateMutability: "view" as const,
    inputs: [], outputs: [{ type: "uint256" as const }],
  },
] as const;

function txUrl(chain: Chain, hash: `0x${string}`): string | undefined {
  const baseUrl = chain.blockExplorers?.default?.url;
  return baseUrl ? `${baseUrl}/tx/${hash}` : undefined;
}

async function makeClients(cfg: ReturnType<typeof withConfig>, opts: { rpc?: string; chain?: string; privateKey?: string }) {
  const chain     = CHAINS[opts.chain ?? "84532"] ?? baseSepolia;
  const clients = await createExecutionClients({ chain, rpc: opts.rpc, legacyPrivateKey: opts.privateKey });
  return {
    chain,
    account: clients.account,
    pubClient: clients.publicClient,
    walClient: clients.walletClient,
  };
}

// ─── propose-root ─────────────────────────────────────────────────────────────

export async function oracleProposeRoot(opts: {
  root?: string;
  issuer?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);
  if (!opts.root) die("--root <uint256> required");

  const root = BigInt(opts.root!);
  const { chain, account, pubClient, walClient } = await makeClients(cfg, opts);

  header("ILAL Oracle — Propose Merkle Root", chain.name);
  log.kv("issuer", fmt.cyan(cfg.issuer!));
  log.kv("new root", fmt.gray(root.toString().slice(0, 22) + "…"));

  // Show current root and delay
  const [currentRoot, delay] = await Promise.all([
    pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "merkleRoot" }) as Promise<bigint>,
    pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "ROOT_DELAY" }) as Promise<bigint>,
  ]);
  log.kv("current root", fmt.gray(currentRoot.toString().slice(0, 22) + "…"));
  log.kv("timelock delay", `${Number(delay) / 3600} hours`);
  log.line();

  const spin = new Spinner("Proposing new Merkle root…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      account,
      address: cfg.issuer as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "proposeMerkleRoot",
      args: [root],
    });
    await pubClient.waitForTransactionReceipt({ hash: txHash });
    spin.succeed(`Merkle root proposed ${fmt.gray(fmt.hash(txHash))}`);
  } catch (e) {
    spin.fail("proposeMerkleRoot failed");
    dieOnContract(e);
    return;
  }

  const activatesAt = new Date((Date.now() + Number(delay) * 1000));
  log.line();
  log.callout(
    "Root queued",
    `Activate after ${activatesAt.toISOString()}\n  Run: ilal oracle activate-root --issuer ${cfg.issuer}`,
    "cyan"
  );
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}

// ─── activate-root ────────────────────────────────────────────────────────────

export async function oracleActivateRoot(opts: {
  issuer?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);

  const { chain, account, pubClient, walClient } = await makeClients(cfg, opts);

  header("ILAL Oracle — Activate Merkle Root", chain.name);
  log.kv("issuer", fmt.cyan(cfg.issuer!));

  const [pendingRoot, activatesAt] = await Promise.all([
    pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "pendingRoot" }) as Promise<bigint>,
    pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "pendingRootActivatesAt" }) as Promise<bigint>,
  ]);

  if (pendingRoot === 0n) die("No pending root — run `ilal oracle propose-root` first");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (activatesAt > now) {
    const remaining = Number(activatesAt - now);
    die(`Timelock not elapsed. Activate in ${Math.ceil(remaining / 3600)} hour(s) (${new Date(Number(activatesAt) * 1000).toISOString()})`);
  }

  log.kv("pending root", fmt.cyan(pendingRoot.toString().slice(0, 22) + "…"));
  log.line();

  const spin = new Spinner("Activating Merkle root…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      account,
      address: cfg.issuer as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "activateMerkleRoot",
      args: [],
    });
    await pubClient.waitForTransactionReceipt({ hash: txHash });
    spin.succeed(`Merkle root activated ${fmt.gray(fmt.hash(txHash))}`);
  } catch (e) {
    spin.fail("activateMerkleRoot failed");
    dieOnContract(e);
    return;
  }

  log.line();
  log.callout("Root live", "New Merkle root is now enforced on all ZK proof verifications", "green");
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}

// ─── propose-verifier ─────────────────────────────────────────────────────────

export async function oracleProposeVerifier(opts: {
  verifier?: string;
  issuer?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);
  if (!opts.verifier || !isAddress(opts.verifier)) die("--verifier <address> required");

  const { chain, account, pubClient, walClient } = await makeClients(cfg, opts);

  header("ILAL Oracle — Propose ZK Verifier", chain.name);
  log.kv("issuer",       fmt.cyan(cfg.issuer!));
  log.kv("new verifier", fmt.cyan(opts.verifier));

  const delay = await pubClient.readContract({
    address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "VERIFIER_DELAY",
  }) as bigint;
  log.kv("timelock delay", `${Number(delay) / 3600} hours`);
  log.line();

  const spin = new Spinner("Proposing new ZK verifier…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      account,
      address: cfg.issuer as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "proposeZKVerifier",
      args: [opts.verifier as `0x${string}`],
    });
    await pubClient.waitForTransactionReceipt({ hash: txHash });
    spin.succeed(`ZK verifier proposed ${fmt.gray(fmt.hash(txHash))}`);
  } catch (e) {
    spin.fail("proposeZKVerifier failed");
    dieOnContract(e);
    return;
  }

  const activatesAt = new Date((Date.now() + Number(delay) * 1000));
  log.line();
  log.callout(
    "Verifier queued",
    `Activate after ${activatesAt.toISOString()}\n  Run: ilal oracle activate-verifier --issuer ${cfg.issuer}`,
    "cyan"
  );
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}

// ─── activate-verifier ────────────────────────────────────────────────────────

export async function oracleActivateVerifier(opts: {
  issuer?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);

  const { chain, account, pubClient, walClient } = await makeClients(cfg, opts);

  header("ILAL Oracle — Activate ZK Verifier", chain.name);

  const [pending, activatesAt] = await Promise.all([
    pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "pendingZKVerifier" }) as Promise<string>,
    pubClient.readContract({ address: cfg.issuer as `0x${string}`, abi: ORACLE_ABI, functionName: "pendingVerifierActivatesAt" }) as Promise<bigint>,
  ]);

  if (pending === "0x0000000000000000000000000000000000000000") die("No pending verifier — run `ilal oracle propose-verifier` first");
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (activatesAt > now) {
    const remaining = Number(activatesAt - now);
    die(`Timelock not elapsed. Activate in ${Math.ceil(remaining / 3600)} hour(s)`);
  }

  log.kv("pending verifier", fmt.cyan(pending));
  log.line();

  const spin = new Spinner("Activating ZK verifier…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      account,
      address: cfg.issuer as `0x${string}`,
      abi: ORACLE_ABI,
      functionName: "activateZKVerifier",
      args: [],
    });
    await pubClient.waitForTransactionReceipt({ hash: txHash });
    spin.succeed(`ZK verifier activated ${fmt.gray(fmt.hash(txHash))}`);
  } catch (e) {
    spin.fail("activateZKVerifier failed");
    dieOnContract(e);
    return;
  }

  log.line();
  log.callout("Verifier live", "New ZK verifier is now active for all proof verifications", "green");
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}

// ─── propose-domain ──────────────────────────────────────────────────────────

export async function oracleProposeDomain(opts: {
  issuerHash?: string;
  schemaHash?: string;
  issuer?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);
  if (!opts.issuerHash) die("--issuer-hash <uint256> required");
  if (!opts.schemaHash) die("--schema-hash <uint256> required");

  const issuerHash = BigInt(opts.issuerHash);
  const schemaHash = BigInt(opts.schemaHash);
  if (issuerHash === 0n || schemaHash === 0n) die("Issuer and schema hashes must both be nonzero");

  const { chain, account, pubClient, walClient } = await makeClients(cfg, opts);
  const issuerAddress = cfg.issuer as `0x${string}`;

  header("ILAL Oracle — Propose ZK Domain", chain.name);
  log.kv("issuer", fmt.cyan(issuerAddress));
  log.kv("new issuer hash", fmt.gray(issuerHash.toString()));
  log.kv("new schema hash", fmt.gray(schemaHash.toString()));

  const [currentIssuerHash, currentSchemaHash, delay] = await Promise.all([
    pubClient.readContract({ address: issuerAddress, abi: ORACLE_ABI, functionName: "zkIssuerHash" }) as Promise<bigint>,
    pubClient.readContract({ address: issuerAddress, abi: ORACLE_ABI, functionName: "zkSchemaHash" }) as Promise<bigint>,
    pubClient.readContract({ address: issuerAddress, abi: ORACLE_ABI, functionName: "ZK_DOMAIN_DELAY" }) as Promise<bigint>,
  ]);
  log.kv("current issuer hash", fmt.gray(currentIssuerHash.toString()));
  log.kv("current schema hash", fmt.gray(currentSchemaHash.toString()));
  log.kv("timelock delay", `${Number(delay) / 3600} hours`);
  log.line();

  const spin = new Spinner("Proposing ZK public-input domain…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      account,
      address: issuerAddress,
      abi: ORACLE_ABI,
      functionName: "proposeZKPublicInputHashes",
      args: [issuerHash, schemaHash],
    });
    await pubClient.waitForTransactionReceipt({ hash: txHash });
    spin.succeed(`ZK domain proposed ${fmt.gray(fmt.hash(txHash))}`);
  } catch (e) {
    spin.fail("proposeZKPublicInputHashes failed");
    dieOnContract(e);
    return;
  }

  const activatesAt = new Date(Date.now() + Number(delay) * 1000);
  log.line();
  log.callout(
    "ZK domain queued",
    `Activate after ${activatesAt.toISOString()}\n  Run: ilal oracle activate-domain --issuer ${issuerAddress}`,
    "cyan"
  );
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}

// ─── activate-domain ─────────────────────────────────────────────────────────

export async function oracleActivateDomain(opts: {
  issuer?: string;
  chain?: string;
  rpc?: string;
  privateKey?: string;
}) {
  const cfg = withConfig(opts);
  if (!cfg.issuer) die("CNFIssuer address required. Use --issuer or set in .ilal.json");
  if (!isAddress(cfg.issuer!)) die(`Invalid issuer address: ${cfg.issuer}`);

  const { chain, account, pubClient, walClient } = await makeClients(cfg, opts);
  const issuerAddress = cfg.issuer as `0x${string}`;

  header("ILAL Oracle — Activate ZK Domain", chain.name);
  log.kv("issuer", fmt.cyan(issuerAddress));

  const [pendingIssuerHash, pendingSchemaHash, activatesAt] = await Promise.all([
    pubClient.readContract({ address: issuerAddress, abi: ORACLE_ABI, functionName: "pendingZKIssuerHash" }) as Promise<bigint>,
    pubClient.readContract({ address: issuerAddress, abi: ORACLE_ABI, functionName: "pendingZKSchemaHash" }) as Promise<bigint>,
    pubClient.readContract({ address: issuerAddress, abi: ORACLE_ABI, functionName: "pendingZKDomainActivatesAt" }) as Promise<bigint>,
  ]);

  if (pendingIssuerHash === 0n || pendingSchemaHash === 0n || activatesAt === 0n) {
    die("No pending ZK domain — run `ilal oracle propose-domain` first");
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (activatesAt > now) {
    const remaining = Number(activatesAt - now);
    die(`Timelock not elapsed. Activate in ${Math.ceil(remaining / 3600)} hour(s) (${new Date(Number(activatesAt) * 1000).toISOString()})`);
  }

  log.kv("pending issuer hash", fmt.cyan(pendingIssuerHash.toString()));
  log.kv("pending schema hash", fmt.cyan(pendingSchemaHash.toString()));
  log.line();

  const spin = new Spinner("Activating ZK public-input domain…").start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      account,
      address: issuerAddress,
      abi: ORACLE_ABI,
      functionName: "activateZKPublicInputHashes",
      args: [],
    });
    await pubClient.waitForTransactionReceipt({ hash: txHash });
    spin.succeed(`ZK domain activated ${fmt.gray(fmt.hash(txHash))}`);
  } catch (e) {
    spin.fail("activateZKPublicInputHashes failed");
    dieOnContract(e);
    return;
  }

  log.line();
  log.callout("ZK domain live", "Proofs must now match this issuer and schema exactly", "green");
  const explorer = txUrl(chain, txHash!);
  if (explorer) log.kv("explorer", fmt.cyan(explorer));
  console.log();
}
