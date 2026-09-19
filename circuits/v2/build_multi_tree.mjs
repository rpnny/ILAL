import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync, readFileSync } from "fs";
import { resolve } from "path";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon2, poseidon6 } from "poseidon-lite";

const CREDENTIAL_DEPTH = 20;
const JURISDICTION_DEPTH = 8;
const ISSUER_HASH = 11n;
const SCHEMA_HASH = 22n;
const EXPIRES_AT = 2_000_000_000n;
const COUNTRY = 840n;
const KYC = 3n;
const MIN_KYC = 2n;
const CIRCUIT_VERSION = 2n;

const wallets = JSON.parse(readFileSync(process.argv[2], "utf8")); // {A, B}
const outDir = process.argv[3];
mkdirSync(outDir, { recursive: true });

function bitsLSB(value, width) {
  return Array.from({ length: width }, (_, i) => ((value >> BigInt(i)) & 1n).toString());
}
function walletHash(wallet) {
  const digest = execFileSync("cast", ["keccak", wallet], { encoding: "utf8" }).trim();
  return BigInt(digest) >> 4n;
}
function countryLeaf(country) {
  return poseidon2([country, 2n]);
}
function credentialLeaf(wallet) {
  const walletField = BigInt(wallet);
  return poseidon6([walletField, KYC, COUNTRY, EXPIRES_AT, ISSUER_HASH, SCHEMA_HASH]);
}

const addresses = [wallets.A, wallets.B];
const credentialTree = new IncrementalMerkleTree(poseidon2, CREDENTIAL_DEPTH, 0n, 2);
const leaves = addresses.map((w) => credentialLeaf(w));
for (const leaf of leaves) credentialTree.insert(leaf);

const jurisdictionTree = new IncrementalMerkleTree(poseidon2, JURISDICTION_DEPTH, 0n, 2);
for (const allowed of [COUNTRY, 826n, 756n]) jurisdictionTree.insert(countryLeaf(allowed));

const policyHash = poseidon6([
  CIRCUIT_VERSION,
  ISSUER_HASH,
  SCHEMA_HASH,
  credentialTree.root,
  MIN_KYC,
  jurisdictionTree.root,
]);

const meta = {
  credentialRoot: credentialTree.root.toString(),
  jurisdictionRoot: jurisdictionTree.root.toString(),
  policyHash: policyHash.toString(),
  issuerHash: ISSUER_HASH.toString(),
  schemaHash: SCHEMA_HASH.toString(),
  minKycLevel: MIN_KYC.toString(),
  circuitVersion: CIRCUIT_VERSION.toString(),
  wallets: addresses,
};
writeFileSync(resolve(outDir, "policy-meta.json"), JSON.stringify(meta, null, 2));

for (let i = 0; i < addresses.length; i++) {
  const wallet = addresses[i];
  const walletField = BigInt(wallet);
  const proof = credentialTree.createProof(i);
  const jProof = jurisdictionTree.createProof(0);
  const input = {
    walletField: walletField.toString(),
    walletBits: bitsLSB(walletField, 160),
    kycLevel: KYC.toString(),
    countryCode: COUNTRY.toString(),
    credentialPathElements: proof.siblings.map((s) => s[0].toString()),
    credentialPathIndices: proof.pathIndices.map(String),
    jurisdictionPathElements: jProof.siblings.map((s) => s[0].toString()),
    jurisdictionPathIndices: jProof.pathIndices.map(String),
    walletHash: walletHash(wallet).toString(),
    issuerHash: ISSUER_HASH.toString(),
    schemaHash: SCHEMA_HASH.toString(),
    expiresAt: EXPIRES_AT.toString(),
    credentialRoot: credentialTree.root.toString(),
    minKycLevel: MIN_KYC.toString(),
    jurisdictionRoot: jurisdictionTree.root.toString(),
    policyHash: policyHash.toString(),
    circuitVersion: CIRCUIT_VERSION.toString(),
  };
  const role = i === 0 ? "A" : "B";
  writeFileSync(resolve(outDir, `policy-input-${role}.json`), JSON.stringify(input, null, 2));
  console.log("wrote", role, wallet);
}
console.log(JSON.stringify(meta, null, 2));
