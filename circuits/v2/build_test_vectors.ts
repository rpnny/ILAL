import { execFileSync } from "child_process";
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon2, poseidon6 } from "poseidon-lite";

const CREDENTIAL_DEPTH = 20;
const JURISDICTION_DEPTH = 8;
const WALLET = process.env["ILAL_V2_WALLET"] ?? "0x0000000000000000000000000000000000000001";
const ISSUER_HASH = 11n;
const SCHEMA_HASH = 22n;
const EXPIRES_AT = 2_000_000_000n;
const COUNTRY = 840n;

function bitsLSB(value: bigint, width: number): string[] {
  return Array.from({ length: width }, (_, index) => ((value >> BigInt(index)) & 1n).toString());
}

function walletHash(wallet: string): bigint {
  const digest = execFileSync("cast", ["keccak", wallet], { encoding: "utf8" }).trim();
  return BigInt(digest) >> 4n;
}

function countryLeaf(country: bigint): bigint {
  return poseidon2([country, 2n]);
}

function createInput(options?: {
  kycLevel?: bigint;
  countryCode?: bigint;
  issuerHash?: bigint;
  policyHashDelta?: bigint;
}) {
  const walletField = BigInt(WALLET);
  const kycLevel = options?.kycLevel ?? 3n;
  const countryCode = options?.countryCode ?? COUNTRY;

  // The source credential tree is built under the real issuer domain. Tests
  // can then mutate the public domain without rebuilding the source tree.
  const credentialLeaf = poseidon6([
    walletField,
    kycLevel,
    countryCode,
    EXPIRES_AT,
    ISSUER_HASH,
    SCHEMA_HASH,
  ]);
  const credentialTree = new IncrementalMerkleTree(poseidon2, CREDENTIAL_DEPTH, 0n, 2);
  credentialTree.insert(credentialLeaf);
  const credentialProof = credentialTree.createProof(0);

  const jurisdictionTree = new IncrementalMerkleTree(poseidon2, JURISDICTION_DEPTH, 0n, 2);
  for (const allowed of [COUNTRY, 826n, 756n]) jurisdictionTree.insert(countryLeaf(allowed));
  const jurisdictionProof = jurisdictionTree.createProof(0);

  const publicIssuerHash = options?.issuerHash ?? ISSUER_HASH;
  const minKycLevel = 2n;
  const circuitVersion = 2n;
  const committedPolicyHash = poseidon6([
    circuitVersion,
    publicIssuerHash,
    SCHEMA_HASH,
    credentialTree.root,
    minKycLevel,
    jurisdictionTree.root,
  ]) + (options?.policyHashDelta ?? 0n);

  return {
    walletField: walletField.toString(),
    walletBits: bitsLSB(walletField, 160),
    kycLevel: kycLevel.toString(),
    countryCode: countryCode.toString(),
    credentialPathElements: credentialProof.siblings.map((siblings: bigint[]) => siblings[0]!.toString()),
    credentialPathIndices: credentialProof.pathIndices.map(String),
    jurisdictionPathElements: jurisdictionProof.siblings.map((siblings: bigint[]) => siblings[0]!.toString()),
    jurisdictionPathIndices: jurisdictionProof.pathIndices.map(String),
    walletHash: walletHash(WALLET).toString(),
    issuerHash: publicIssuerHash.toString(),
    schemaHash: SCHEMA_HASH.toString(),
    expiresAt: EXPIRES_AT.toString(),
    credentialRoot: credentialTree.root.toString(),
    minKycLevel: minKycLevel.toString(),
    jurisdictionRoot: jurisdictionTree.root.toString(),
    policyHash: committedPolicyHash.toString(),
    circuitVersion: circuitVersion.toString(),
  };
}

const output = resolve(process.argv[2] ?? "build-v2/test-vectors");
mkdirSync(output, { recursive: true });

const vectors = {
  valid: createInput(),
  low_tier: createInput({ kycLevel: 1n }),
  wrong_country: createInput({ countryCode: 392n }),
  wrong_issuer_domain: createInput({ issuerHash: 99n }),
  tampered_policy: createInput({ policyHashDelta: 1n }),
};

for (const [name, input] of Object.entries(vectors)) {
  writeFileSync(resolve(output, `${name}.json`), JSON.stringify(input, null, 2));
}

console.log(`Wrote ${Object.keys(vectors).length} v2 test vectors to ${output}`);
