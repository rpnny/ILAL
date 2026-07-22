/**
 * prove.ts — `ilal credential prove`
 *
 * Trader command: builds a local Merkle proof, generates a Groth16 ZK proof,
 * then mints or renews the CNF if the issuer's active root already includes it.
 *
 * Usage:
 *   ilal credential prove \
 *     --wallet  0x1b869... \
 *     --issuer  0x335413... \
 *     --chain   84532 \
 *     --action  mint          # or renew (default: auto-detect)
 *     --circuit-dir ./circuits/build
 *
 * Operator root changes live under `ilal oracle propose-root` and
 * `ilal oracle activate-root`.
 */

import { execSync } from "child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { homedir } from "os";
import { resolve, dirname } from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  isAddress,
  keccak256,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no bundled types for this package
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon2, poseidon4 } from "poseidon-lite";
import { fmt, log, header, Spinner, die, dieOnContract, requirePrivateKey } from "../ui.js";
import { withConfig } from "../config.js";
import { COINBASE_SCHEMA_UID } from "../constants.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAINS: Record<string, Chain> = { "8453": base, "84532": baseSepolia };
const DEPTH = 20;
const DEFAULT_ARTIFACT_URL = "https://unpkg.com/@ilalv3/proving-artifacts@0.1.0";
const DEFAULT_ARTIFACT_CACHE = resolve(homedir(), ".ilal/artifacts/ilal-v1");

const PROVING_ARTIFACTS = [
  { asset: "ilal.zkey", rel: "ilal.zkey", minBytes: 50_000_000 },
  { asset: "ilal_vkey.json", rel: "ilal_vkey.json", minBytes: 1_000 },
  { asset: "ilal_js/ilal.wasm", rel: "ilal_js/ilal.wasm", minBytes: 1_000_000 },
  { asset: "ilal_js/generate_witness.js", rel: "ilal_js/generate_witness.js", minBytes: 100 },
  { asset: "ilal_js/witness_calculator.js", rel: "ilal_js/witness_calculator.js", minBytes: 1_000 },
] as const;

// ─── ABI ──────────────────────────────────────────────────────────────────────

const CNF_ABI = [
  {
    name: "mintWithProof", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [{ name: "proof", type: "bytes" as const }, { name: "publicInputs", type: "uint256[]" as const }],
    outputs: [{ name: "tokenId", type: "uint256" as const }],
  },
  {
    name: "renewWithProof", type: "function" as const, stateMutability: "nonpayable" as const,
    inputs: [{ name: "proof", type: "bytes" as const }, { name: "publicInputs", type: "uint256[]" as const }],
    outputs: [],
  },
  {
    name: "isValid", type: "function" as const, stateMutability: "view" as const,
    inputs: [{ name: "wallet", type: "address" as const }],
    outputs: [{ type: "bool" as const }],
  },
  {
    name: "credentialOf", type: "function" as const, stateMutability: "view" as const,
    inputs: [{ name: "wallet", type: "address" as const }],
    outputs: [{ name: "tokenId", type: "uint256" as const }],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addressToField(addr: string): bigint {
  return BigInt(addr.toLowerCase());
}

function addressToBitsLSBFirst(addr: string): number[] {
  const field = addressToField(addr);
  const bits: number[] = [];
  for (let i = 0; i < 160; i++) bits.push(Number((field >> BigInt(i)) & 1n));
  return bits;
}

/** keccak256(wallet_20_bytes) >> 4  — matches the circuit constraint. */
function computeWalletHash(walletAddr: string): bigint {
  const checksummed = walletAddr as `0x${string}`;
  // viem's keccak256 takes hex bytes — the address as 20 raw bytes
  const hash = keccak256(checksummed);
  return BigInt(hash) >> 4n;
}

function poseidonField(value: bigint): bigint {
  return poseidon2([value, 0n]);
}

function schemaHash(schemaUID: string): bigint {
  const schemaHex = schemaUID.replace("0x", "").padStart(64, "0");
  const schemaLo = BigInt("0x" + schemaHex.slice(32));
  const schemaHi = BigInt("0x" + schemaHex.slice(0, 32));
  return poseidon2([schemaLo, schemaHi]);
}

function hasCircuitArtifacts(dir: string): boolean {
  return PROVING_ARTIFACTS.every((artifact) => {
    const file = resolve(dir, artifact.rel);
    try {
      return existsSync(file) && statSync(file).size >= artifact.minBytes;
    } catch {
      return false;
    }
  });
}

function requireCircuitArtifacts(dir: string): string {
  const resolved = resolve(dir);
  const missing = PROVING_ARTIFACTS.filter((artifact) => {
    const file = resolve(resolved, artifact.rel);
    try {
      return !existsSync(file) || statSync(file).size < artifact.minBytes;
    } catch {
      return true;
    }
  });
  if (missing.length > 0) {
    die(
      `Proving artifacts are incomplete in ${resolved}.\n` +
      `  Missing: ${missing.map((x) => x.rel).join(", ")}\n` +
      "  Pass --artifact-url <base-url> to download them, or use --circuit-dir <path>."
    );
  }
  return resolved;
}

async function downloadFile(url: string, target: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed ${res.status} ${res.statusText}: ${url}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(target));
}

async function ensureHostedArtifacts(opts: {
  artifactUrl?: string;
  artifactCache?: string;
  offline?: boolean;
}): Promise<string> {
  const cacheDir = resolve(opts.artifactCache ?? DEFAULT_ARTIFACT_CACHE);
  if (hasCircuitArtifacts(cacheDir)) return cacheDir;

  if (opts.offline) {
    die(
      "Hosted proving artifacts are not cached locally.\n" +
      `  Cache: ${cacheDir}\n` +
      "  Re-run without --offline, or pass --circuit-dir <path>."
    );
  }

  const baseUrl = (opts.artifactUrl ?? DEFAULT_ARTIFACT_URL).replace(/\/+$/, "");
  for (const artifact of PROVING_ARTIFACTS) {
    const target = resolve(cacheDir, artifact.rel);
    if (existsSync(target) && statSync(target).size >= artifact.minBytes) continue;
    await downloadFile(`${baseUrl}/${artifact.asset}`, target);
  }

  return requireCircuitArtifacts(cacheDir);
}

async function findCircuitDir(opts: {
  override?: string;
  artifactUrl?: string;
  artifactCache?: string;
  offline?: boolean;
}): Promise<{ dir: string; source: "local" | "cache" | "download" }> {
  if (opts.override) {
    return { dir: requireCircuitArtifacts(opts.override), source: "local" };
  }

  // Look relative to the CLI package root (cli/ → circuits/build)
  const candidates = [
    resolve(__dirname, "../../../../circuits/build"),   // dev: cli/src/commands → circuits/build
    resolve(__dirname, "../../../circuits/build"),
    resolve(process.cwd(), "circuits/build"),
    resolve(process.cwd(), "build"),
    resolve(opts.artifactCache ?? DEFAULT_ARTIFACT_CACHE),
  ];
  for (const p of candidates) {
    if (hasCircuitArtifacts(p)) {
      const source = resolve(p) === resolve(opts.artifactCache ?? DEFAULT_ARTIFACT_CACHE) ? "cache" : "local";
      return { dir: p, source };
    }
  }

  const dir = await ensureHostedArtifacts(opts);
  return { dir, source: "download" };
}

// ─── Core proof generation ─────────────────────────────────────────────────────

interface ProofFiles {
  proofJson:  object;
  publicJson: string[];
  merkleRoot: bigint;
}

function resolveExpiresAt(expiresAt?: string): bigint {
  if (!expiresAt) return BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 3600);
  const parsed = BigInt(expiresAt);
  if (parsed <= BigInt(Math.floor(Date.now() / 1000))) die("--expires-at must be a future Unix timestamp");
  return parsed;
}

function computeZKLeafAndRoot(walletAddr: string, expiresAt: bigint): { leaf: bigint; merkleRoot: bigint } {
  const walletField = addressToField(walletAddr);
  const leaf = poseidon4([walletField, 2n, 840n, expiresAt]);
  const tree = new IncrementalMerkleTree(poseidon2, DEPTH, 0n, 2);
  tree.insert(leaf);
  return { leaf, merkleRoot: tree.root };
}

function generateProof(opts: {
  walletAddr: string;
  issuerAddr: string;
  circuitDir: string;
  outDir: string;
  expiresAt?: string;
}): ProofFiles {
  const { walletAddr, issuerAddr, circuitDir, outDir } = opts;

  mkdirSync(outDir, { recursive: true });

  const walletField  = addressToField(walletAddr);
  const walletBits   = addressToBitsLSBFirst(walletAddr);
  const walletHash   = computeWalletHash(walletAddr);
  const issuerHash   = poseidonField(addressToField(issuerAddr));
  const schemaHashValue = schemaHash(COINBASE_SCHEMA_UID);
  const expiresAt    = resolveExpiresAt(opts.expiresAt);

  // Build single-leaf Poseidon Merkle tree
  const { leaf, merkleRoot } = computeZKLeafAndRoot(walletAddr, expiresAt);
  const tree = new IncrementalMerkleTree(poseidon2, DEPTH, 0n, 2);
  tree.insert(leaf);
  const merkleProof = tree.createProof(0);

  // Build input.json
  const input = {
    walletField:        walletField.toString(),
    walletBits:         walletBits.map(String),
    kycLevel:           "2",
    countryCode:        "840",
    merklePathElements: merkleProof.siblings.map((s: bigint[]) => s[0]!.toString()),
    merklePathIndices:  merkleProof.pathIndices.map(String),
    walletHash:         walletHash.toString(),
    issuerHash:         issuerHash.toString(),
    schemaHash:         schemaHashValue.toString(),
    expiresAt:          expiresAt.toString(),
    revealFlags:        "0",
    merkleRoot:         merkleRoot.toString(),
  };

  const inputPath  = resolve(outDir, "input.json");
  const wtnsPath   = resolve(outDir, "witness.wtns");
  const proofPath  = resolve(outDir, "proof.json");
  const publicPath = resolve(outDir, "public.json");
  const wasmPath   = resolve(circuitDir, "ilal_js/ilal.wasm");
  const witnessJs  = resolve(circuitDir, "ilal_js/generate_witness.js");
  const zkeyPath   = resolve(circuitDir, "ilal.zkey");

  writeFileSync(inputPath, JSON.stringify(input, null, 2));

  // Generate witness
  execSync(`node "${witnessJs}" "${wasmPath}" "${inputPath}" "${wtnsPath}"`, {
    stdio: "pipe",
    cwd: dirname(witnessJs),
  });

  // Generate proof
  execSync(`npx snarkjs groth16 prove "${zkeyPath}" "${wtnsPath}" "${proofPath}" "${publicPath}"`, {
    stdio: "pipe",
  });

  // Verify locally
  const vkeyPath = resolve(circuitDir, "ilal_vkey.json");
  execSync(`npx snarkjs groth16 verify "${vkeyPath}" "${publicPath}" "${proofPath}"`, {
    stdio: "pipe",
  });

  const publicJson = JSON.parse(readFileSync(publicPath, "utf8")) as string[];
  // Read merkleRoot from circuit output (public.json[5]) — guaranteed to match
  // what we'll pass to the contract, eliminating any JS/circuit hash discrepancy.
  const circuitMerkleRoot = BigInt(publicJson[5]!);

  return {
    proofJson:  JSON.parse(readFileSync(proofPath, "utf8")) as object,
    publicJson,
    merkleRoot: circuitMerkleRoot,
  };
}

// ─── ABI encode proof for on-chain call ───────────────────────────────────────

interface SnarkjsProof {
  pi_a: [string, string, string];
  pi_b: [[string, string], [string, string], [string, string]];
  pi_c: [string, string, string];
}

function encodeProof(proofJson: object, publicJson: string[]): {
  proofBytes: `0x${string}`;
  publicInputs: bigint[];
} {
  const p = proofJson as SnarkjsProof;
  const a: [bigint, bigint] = [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])];
  const b: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])],
    [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])],
  ];
  const c: [bigint, bigint] = [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])];

  const proofBytes = encodeAbiParameters(
    [{ type: "uint256[2]" }, { type: "uint256[2][2]" }, { type: "uint256[2]" }],
    [a, b, c]
  ) as `0x${string}`;

  return { proofBytes, publicInputs: publicJson.map((x) => BigInt(x)) };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function credentialProve(opts: {
  wallet?: string;
  issuer?: string;
  chain?: string;
  action?: string;
  circuitDir?: string;
  artifactUrl?: string;
  artifactCache?: string;
  offline?: boolean;
  outDir?: string;
  rpc?: string;
  privateKey?: string;
  expiresAt?: string;
}) {
  const cfg    = withConfig(opts);
  const rawKey = requirePrivateKey(cfg.privateKey ?? process.env["PRIVATE_KEY"]);
  if (!cfg.wallet)  die("Wallet address required. Use --wallet or set issuer in .ilal.json");
  if (!cfg.issuer)  die("Issuer address required. Use --issuer or run `ilal init`");
  if (!isAddress(cfg.wallet))  die(`Invalid wallet address: ${cfg.wallet}`);
  if (!isAddress(cfg.issuer))  die(`Invalid issuer address: ${cfg.issuer}`);

  const chain     = CHAINS[cfg.chain ?? "84532"] ?? baseSepolia;
  const account   = privateKeyToAccount(rawKey);
  const transport = cfg.rpc ? http(cfg.rpc) : http();
  const pubClient = createPublicClient({ chain, transport });
  const walClient = createWalletClient({ account, chain, transport });

  header("ILAL Credential ZK Prove", chain.name);
  log.kv("wallet",  fmt.cyan(cfg.wallet));
  log.kv("issuer",  fmt.cyan(cfg.issuer));
  log.line();

  // ── Auto-detect mint vs renew ──────────────────────────────────────────────
  let action = opts.action as "mint" | "renew" | undefined;
  if (!action) {
    const spin = new Spinner("Checking existing credential…").start();
    const tokenId = await pubClient.readContract({
      address: cfg.issuer as `0x${string}`,
      abi: CNF_ABI,
      functionName: "credentialOf",
      args: [cfg.wallet as `0x${string}`],
    }) as bigint;
    action = tokenId === 0n ? "mint" : "renew";
    spin.succeed(`Action: ${fmt.cyan(action)}${tokenId > 0n ? fmt.gray(` (token #${tokenId})`) : ""}`);
  }

  // ── Prepare hosted/local proving artifacts ────────────────────────────────
  const artifactSpin = new Spinner("Preparing proving artifacts…").start();
  let circuitDir: string;
  try {
    const artifacts = await findCircuitDir({
      override: cfg.circuitDir,
      artifactUrl: cfg.artifactUrl,
      artifactCache: cfg.artifactCache,
      offline: cfg.offline,
    });
    circuitDir = artifacts.dir;
    const sourceLabel =
      artifacts.source === "download" ? "downloaded to cache" :
      artifacts.source === "cache" ? "cache" :
      "local";
    artifactSpin.succeed(`Proving artifacts ready (${sourceLabel})`);
  } catch (e) {
    artifactSpin.fail("Proving artifacts unavailable");
    die(e instanceof Error ? e.message : String(e));
  }

  const outDir = cfg.outDir ? resolve(cfg.outDir) : resolve(process.cwd(), "outputs");
  log.kv("artifacts", fmt.gray(circuitDir));
  log.kv("proofOut", fmt.gray(outDir));

  log.line();

  // ── Generate proof ─────────────────────────────────────────────────────────
  const spin = new Spinner("Building Merkle tree & generating ZK proof…").start();

  let proofResult: ProofFiles & { merkleRoot: bigint };
  try {
    spin.update("Generating ZK witness…");
    proofResult = generateProof({
      walletAddr: cfg.wallet,
      issuerAddr: cfg.issuer,
      circuitDir,
      outDir,
      expiresAt: opts.expiresAt,
    }) as ProofFiles & { merkleRoot: bigint };
    spin.succeed(`Proof generated & verified locally`);
  } catch (e) {
    spin.fail("Proof generation failed");
    die(e instanceof Error ? e.message.split("\n")[0]! : String(e));
  }

  const proofExpiresAt = BigInt(proofResult.publicJson[3]!);
  log.kv("expiresAt",  fmt.cyan(new Date(Number(proofExpiresAt) * 1000).toISOString().split("T")[0]!));
  log.kv("merkleRoot", fmt.gray(proofResult.merkleRoot.toString().slice(0, 22) + "…"));
  log.line();

  // ── Send mint / renew tx ───────────────────────────────────────────────────
  const { proofBytes, publicInputs } = encodeProof(proofResult.proofJson, proofResult.publicJson);
  const fnName = action === "mint" ? "mintWithProof" : "renewWithProof";

  const txSpin = new Spinner(`Sending ${fnName}…`).start();
  let txHash: `0x${string}`;
  try {
    txHash = await walClient.writeContract({
      address: cfg.issuer as `0x${string}`,
      abi: CNF_ABI,
      functionName: fnName,
      args: [proofBytes, publicInputs],
    });
    txSpin.update(`Confirming ${fmt.gray(fmt.hash(txHash))}…`);
    const receipt = await pubClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      txSpin.fail("Transaction reverted");
      die(`Tx failed: ${txHash}`);
    }
    txSpin.succeed(fmt.bold(fmt.green(`CNF ${action === "mint" ? "minted" : "renewed"} via ZK proof`)));
  } catch (e) {
    txSpin.fail(`${fnName} failed`);
    dieOnContract(e);
  }

  log.line();
  log.kv("tx",    fmt.gray(txHash!));
  log.kv("block", fmt.gray((await pubClient.getTransactionReceipt({ hash: txHash! })).blockNumber.toString()));

  const valid = await pubClient.readContract({
    address: cfg.issuer as `0x${string}`,
    abi: CNF_ABI,
    functionName: "isValid",
    args: [cfg.wallet as `0x${string}`],
  });
  log.kv("isValid()", valid ? fmt.green("✓ true") : fmt.red("✗ false"));
  console.log();
}

export async function credentialRoot(opts: {
  wallet?: string;
  issuer?: string;
  expiresAt?: string;
}) {
  if (!opts.wallet) die("Wallet address required. Use --wallet <address>.");
  if (!isAddress(opts.wallet)) die(`Invalid wallet address: ${opts.wallet}`);
  const expiresAt = resolveExpiresAt(opts.expiresAt);
  const { leaf, merkleRoot } = computeZKLeafAndRoot(opts.wallet, expiresAt);

  header("ILAL ZK Root Preparation", "operator pre-deploy / pre-root");
  log.kv("wallet", fmt.cyan(opts.wallet));
  log.kv("kycLevel", "2");
  log.kv("countryCode", "840");
  log.kv("expiresAt", `${expiresAt.toString()} ${fmt.gray(new Date(Number(expiresAt) * 1000).toISOString())}`);
  log.kv("leaf", leaf.toString());
  log.kv("merkleRoot", fmt.cyan(merkleRoot.toString()));

  if (opts.issuer) {
    if (!isAddress(opts.issuer)) die(`Invalid issuer address: ${opts.issuer}`);
    log.kv("issuerHash", poseidonField(addressToField(opts.issuer)).toString());
    log.kv("schemaHash", schemaHash(COINBASE_SCHEMA_UID).toString());
  }

  log.line();
  log.command(`INITIAL_MERKLE_ROOT=${merkleRoot.toString()} forge script contracts/script/DeployDemo.s.sol ...`);
  log.command(`PRIVATE_KEY=0x... ilal credential prove --wallet ${opts.wallet} --expires-at ${expiresAt.toString()}`);
  console.log();
}
