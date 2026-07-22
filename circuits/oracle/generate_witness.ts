/**
 * generate_witness.ts — Builds a snarkjs-compatible input.json for the ILAL circuit,
 * then runs snarkjs to produce proof.json + public.json.
 *
 * Prerequisites (run once):
 *   bash scripts/compile.sh       # compiles circuit + generates zkey
 *   npx tsx oracle/build_tree.ts  # builds attestation Merkle tree
 *
 * Usage:
 *   npx tsx oracle/generate_witness.ts \
 *     --wallet  0xYourWallet \
 *     --issuer  0xCNFIssuerAddress \
 *     --schema  0xSchemaUID
 *
 * Outputs:
 *   outputs/input.json   — witness inputs for the circuit
 *   outputs/proof.json   — Groth16 proof (pass to `ilal proof mint`)
 *   outputs/public.json  — public signals  (pass to `ilal proof mint`)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon2 } from "poseidon-lite";
import { normalizeAddress, normalizeSchemaUID } from "./records.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Config ───────────────────────────────────────────────────────────────────

const DEPTH = 20;
const ZERO_VALUE = 0n;

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeafRecord {
  wallet: string;
  kycLevel: number;
  countryCode: number;
  expiresAt: number;
  walletField: string;
  leaf: string;
  leafIndex: number;
}

interface TreeData {
  merkleRoot: string;
  depth: number;
  leaves: LeafRecord[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addressToField(addr: string): bigint {
  return BigInt(normalizeAddress(addr));
}

function addressToBitsLSBFirst(addr: string): number[] {
  const field = addressToField(addr);
  const bits: number[] = [];
  for (let i = 0; i < 160; i++) {
    bits.push(Number((field >> BigInt(i)) & 1n)); // bit i, LSB-first
  }
  return bits;
}

function poseidonField(value: bigint): bigint {
  // Single-element Poseidon: Poseidon([value])
  // poseidon-lite exports poseidon1 for arity 1
  // Use poseidon2 with 0 padding as a workaround if poseidon1 unavailable
  return poseidon2([value, 0n]);
}

/**
 * Compute walletHash = keccak256(wallet_as_20_bytes) >> 4.
 * The circuit verifies this in-circuit so we must supply the real value.
 * Uses `cast keccak` (Foundry) which hashes raw bytes of the hex input.
 */
function computeWalletHash(walletAddr: string): bigint {
  const hex = walletAddr.replace(/^0x/i, "").toLowerCase().padStart(40, "0");
  const keccakHex = execFileSync("cast", ["keccak", `0x${hex}`], { encoding: "utf8" }).trim();
  return BigInt(keccakHex) >> 4n;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    if (i < 0) { console.error(`Missing ${flag}`); process.exit(1); }
    return args[i + 1]!;
  };

  let walletAddr: string;
  let issuerAddr: string;
  let schemaUID: string;
  try {
    walletAddr = normalizeAddress(get("--wallet"), "wallet");
    issuerAddr = normalizeAddress(get("--issuer"), "issuer");
    schemaUID = normalizeSchemaUID(get("--schema"));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // ── Load tree ──────────────────────────────────────────────────────────────
  const treePath = resolve(ROOT, "outputs/tree.json");
  let treeData: TreeData;
  try {
    treeData = JSON.parse(readFileSync(treePath, "utf8")) as TreeData;
  } catch {
    console.error(`Tree not found at ${treePath}. Run: npx tsx oracle/build_tree.ts`);
    process.exit(1);
  }

  // ── Find this wallet in the tree ───────────────────────────────────────────
  const record = treeData.leaves.find(
    (l) => l.wallet.toLowerCase() === walletAddr
  );
  if (!record) {
    console.error(`Wallet ${walletAddr} not found in attestation tree.`);
    console.error(`Add it to oracle/attestations.json and rebuild the tree.`);
    process.exit(1);
  }

  // ── Rebuild tree to get Merkle path ───────────────────────────────────────
  const tree = new IncrementalMerkleTree(poseidon2, DEPTH, ZERO_VALUE, 2);
  for (const leaf of treeData.leaves) {
    tree.insert(BigInt(leaf.leaf));
  }
  const proof = tree.createProof(record.leafIndex);

  // ── Compute public constants ───────────────────────────────────────────────
  const walletField  = addressToField(walletAddr);
  const walletBits   = addressToBitsLSBFirst(walletAddr);
  const walletHash   = computeWalletHash(walletAddr);
  const issuerField  = addressToField(issuerAddr);
  const issuerHash   = poseidonField(issuerField);

  // schemaUID is a bytes32 — split into two 128-bit halves for Poseidon
  const schemaHex = schemaUID.replace("0x", "").padStart(64, "0");
  const schemaLo  = BigInt("0x" + schemaHex.slice(32)); // lower 128 bits
  const schemaHi  = BigInt("0x" + schemaHex.slice(0, 32)); // upper 128 bits
  const schemaHash = poseidon2([schemaLo, schemaHi]);

  const merkleRoot = BigInt(treeData.merkleRoot);

  // ── Build snarkjs input ───────────────────────────────────────────────────
  const input = {
    // Private
    walletField:        walletField.toString(),
    walletBits:         walletBits.map(String),
    kycLevel:           record.kycLevel.toString(),
    countryCode:        record.countryCode.toString(),
    merklePathElements: proof.siblings.map((s: bigint[]) => s[0]!.toString()),
    merklePathIndices:  proof.pathIndices.map(String),

    // Public
    walletHash:   walletHash.toString(),
    issuerHash:   issuerHash.toString(),
    schemaHash:   schemaHash.toString(),
    expiresAt:    record.expiresAt.toString(),
    revealFlags:  "0",
    merkleRoot:   merkleRoot.toString(),
  };

  const inputPath = resolve(ROOT, "outputs/input.json");
  writeFileSync(inputPath, JSON.stringify(input, null, 2));
  console.log(`Witness input written to outputs/input.json`);

  // ── Run snarkjs to generate proof ─────────────────────────────────────────
  const wtnsPath  = resolve(ROOT, "outputs/witness.wtns");
  const wasmPath  = resolve(ROOT, "build/ilal_js/ilal.wasm");
  const zkeyPath  = resolve(ROOT, "build/ilal.zkey");
  const proofPath = resolve(ROOT, "outputs/proof.json");
  const pubPath   = resolve(ROOT, "outputs/public.json");

  console.log("Generating witness…");
  execSync(
    `node ${resolve(ROOT, "build/ilal_js/generate_witness.js")} ${wasmPath} ${inputPath} ${wtnsPath}`,
    { stdio: "inherit" }
  );

  console.log("Generating proof…");
  execSync(
    `npx snarkjs groth16 prove ${zkeyPath} ${wtnsPath} ${proofPath} ${pubPath}`,
    { cwd: ROOT, stdio: "inherit" }
  );

  console.log(`\nProof ready:`);
  console.log(`  proof.json  → ${proofPath}`);
  console.log(`  public.json → ${pubPath}`);
  console.log(`\nMint your credential:`);
  console.log(`  ilal proof mint --proof outputs/proof.json --public outputs/public.json --issuer <CNFIssuer>`);
}

main();
