import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon2 } from "poseidon-lite";
import {
  addressToField,
  buildZKDomain,
  computeLeaf,
  type AttestationRecord,
} from "./records.js";

const outDir = resolve(process.argv[2] ?? "build/v1-test-vectors");
mkdirSync(outDir, { recursive: true });

const record: AttestationRecord = {
  wallet: "0x1111111111111111111111111111111111111111",
  kycLevel: 2,
  countryCode: 840,
  expiresAt: 2_000_000_000,
};
const domain = buildZKDomain(
  "0x2222222222222222222222222222222222222222",
  `0x${"a".repeat(64)}`,
);
const otherIssuer = buildZKDomain(
  "0x3333333333333333333333333333333333333333",
  domain.schema,
);
const otherSchema = buildZKDomain(domain.issuer, `0x${"b".repeat(64)}`);

const walletField = addressToField(record.wallet);
const walletBits = Array.from({ length: 160 }, (_, index) =>
  ((walletField >> BigInt(index)) & 1n).toString()
);
const walletHash = BigInt(execFileSync("cast", ["keccak", record.wallet], { encoding: "utf8" }).trim()) >> 4n;
const leaf = computeLeaf(record, BigInt(domain.issuerHash), BigInt(domain.schemaHash));
const tree = new IncrementalMerkleTree(poseidon2, 20, 0n, 2);
tree.insert(leaf);
const proof = tree.createProof(0);

const valid = {
  walletField: walletField.toString(),
  walletBits,
  kycLevel: record.kycLevel.toString(),
  countryCode: record.countryCode.toString(),
  merklePathElements: proof.siblings.map((siblings: bigint[]) => siblings[0]!.toString()),
  merklePathIndices: proof.pathIndices.map(String),
  walletHash: walletHash.toString(),
  issuerHash: domain.issuerHash,
  schemaHash: domain.schemaHash,
  expiresAt: record.expiresAt.toString(),
  revealFlags: "0",
  merkleRoot: tree.root.toString(),
  circuitVersion: "2",
};

writeFileSync(resolve(outDir, "valid.json"), JSON.stringify(valid, null, 2));
writeFileSync(
  resolve(outDir, "wrong_issuer_domain.json"),
  JSON.stringify({ ...valid, issuerHash: otherIssuer.issuerHash }, null, 2),
);
writeFileSync(
  resolve(outDir, "wrong_schema_domain.json"),
  JSON.stringify({ ...valid, schemaHash: otherSchema.schemaHash }, null, 2),
);
writeFileSync(
  resolve(outDir, "legacy_version.json"),
  JSON.stringify({ ...valid, circuitVersion: "1" }, null, 2),
);
