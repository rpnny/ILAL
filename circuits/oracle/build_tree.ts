/**
 * build_tree.ts — ILAL attestation Merkle tree builder.
 *
 * Reads a list of attested wallet records, computes Poseidon leaves,
 * builds a depth-20 incremental Merkle tree, and writes:
 *   - outputs/tree.json   (full tree — merkleRoot + all leaves + paths)
 *   - outputs/root.txt    (root for `ilal oracle propose-root`, then activate after the timelock)
 *
 * Input format (attestations.json):
 *   [
 *     {
 *       "wallet":      "0xabc...",  // Ethereum address
 *       "kycLevel":    2,           // 0-3
 *       "countryCode": 840,         // ISO 3166-1 numeric
 *       "expiresAt":   1800000000   // unix timestamp
 *     },
 *     ...
 *   ]
 *
 * Usage:
 *   npx tsx oracle/build_tree.ts --input oracle/attestations.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon2 } from "poseidon-lite";
import {
  TREE_DEPTH,
  addressToField,
  computeLeaf,
  validateAttestations,
  type AttestationRecord,
  type LeafRecord,
} from "./records.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Config ───────────────────────────────────────────────────────────────────

const DEPTH = TREE_DEPTH; // supports 2^20 ≈ 1M wallets
const ZERO_VALUE = 0n; // empty leaf value

// ─── Types ────────────────────────────────────────────────────────────────────

interface TreeOutput {
  merkleRoot: string;   // BigInt string
  depth: number;
  leaves: LeafRecord[];
  leafCount: number;
  builtAt: string;      // ISO timestamp
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const inputFlag = args.indexOf("--input");
  const inputPath = inputFlag >= 0
    ? resolve(args[inputFlag + 1]!)
    : resolve(__dirname, "attestations.json");

  console.log(`Reading attestations from: ${inputPath}`);

  let attestations: AttestationRecord[];
  try {
    attestations = validateAttestations(JSON.parse(readFileSync(inputPath, "utf8")));
  } catch (e) {
    console.error(`Cannot build tree from ${inputPath}: ${e}`);
    process.exit(1);
  }

  console.log(`Found ${attestations.length} attestation(s)`);

  // Build Merkle tree
  const tree = new IncrementalMerkleTree(poseidon2, DEPTH, ZERO_VALUE, 2);

  const leafRecords: LeafRecord[] = [];

  for (const record of attestations) {
    const leaf = computeLeaf(record);
    const leafIndex = tree.leaves.length;
    tree.insert(leaf);

    leafRecords.push({
      ...record,
      walletField: addressToField(record.wallet).toString(),
      leaf: leaf.toString(),
      leafIndex,
    });
  }

  const merkleRoot = tree.root;

  const output: TreeOutput = {
    merkleRoot: merkleRoot.toString(),
    depth: DEPTH,
    leaves: leafRecords,
    leafCount: leafRecords.length,
    builtAt: new Date().toISOString(),
  };

  mkdirSync(resolve(ROOT, "outputs"), { recursive: true });
  writeFileSync(resolve(ROOT, "outputs/tree.json"), JSON.stringify(output, null, 2));
  writeFileSync(resolve(ROOT, "outputs/root.txt"), merkleRoot.toString());

  console.log(`\nMerkle root: ${merkleRoot}`);
  console.log(`\nQueue on-chain with the issuer owner key:`);
  console.log(`  PRIVATE_KEY=0x... ilal oracle propose-root --root ${merkleRoot} --issuer <CNFIssuer>`);
  console.log("  # After ROOT_DELAY (48 hours):");
  console.log("  PRIVATE_KEY=0x... ilal oracle activate-root --issuer <CNFIssuer>");
  console.log(`\nTree written to outputs/tree.json`);
}

main();
