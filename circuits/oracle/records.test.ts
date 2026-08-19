import assert from "node:assert/strict";
import test from "node:test";
import {
  buildZKDomain,
  computeLeaf,
  normalizeAddress,
  normalizeSchemaUID,
  validateAttestations,
} from "./records.js";

const NOW = 1_800_000_000;
const WALLET = "0x1111111111111111111111111111111111111111";
const ISSUER_A = "0x2222222222222222222222222222222222222222";
const ISSUER_B = "0x3333333333333333333333333333333333333333";
const SCHEMA_A = `0x${"a".repeat(64)}`;
const SCHEMA_B = `0x${"b".repeat(64)}`;

function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    wallet: WALLET,
    kycLevel: 2,
    countryCode: 840,
    expiresAt: NOW + 3600,
    ...overrides,
  };
}

test("normalizes valid records and computes a deterministic leaf", () => {
  const [record] = validateAttestations([validRecord({ wallet: WALLET.toUpperCase().replace("0X", "0x") })], NOW);
  const domain = buildZKDomain(ISSUER_A, SCHEMA_A);
  assert.equal(record!.wallet, WALLET);
  assert.equal(
    computeLeaf(record!, BigInt(domain.issuerHash), BigInt(domain.schemaHash)).toString(),
    computeLeaf(record!, BigInt(domain.issuerHash), BigInt(domain.schemaHash)).toString(),
  );
});

test("domain-separates leaves by issuer and schema", () => {
  const [record] = validateAttestations([validRecord()], NOW);
  const domainA = buildZKDomain(ISSUER_A, SCHEMA_A);
  const issuerB = buildZKDomain(ISSUER_B, SCHEMA_A);
  const schemaB = buildZKDomain(ISSUER_A, SCHEMA_B);

  const leaf = computeLeaf(record!, BigInt(domainA.issuerHash), BigInt(domainA.schemaHash));
  assert.notEqual(leaf, computeLeaf(record!, BigInt(issuerB.issuerHash), BigInt(issuerB.schemaHash)));
  assert.notEqual(leaf, computeLeaf(record!, BigInt(schemaB.issuerHash), BigInt(schemaB.schemaHash)));
});

test("rejects empty input", () => {
  assert.throws(() => validateAttestations([], NOW), /non-empty JSON array/);
});

test("rejects malformed and zero addresses", () => {
  assert.throws(() => normalizeAddress("0x1234"), /20-byte/);
  assert.throws(() => normalizeAddress(`0x${"0".repeat(40)}`), /zero address/);
});

test("rejects duplicate wallets case-insensitively", () => {
  assert.throws(
    () => validateAttestations([validRecord(), validRecord({ wallet: WALLET.toUpperCase().replace("0X", "0x") })], NOW),
    /duplicate wallet/,
  );
});

test("rejects unsupported tiers and country codes", () => {
  assert.throws(() => validateAttestations([validRecord({ kycLevel: 4 })], NOW), /kycLevel/);
  assert.throws(() => validateAttestations([validRecord({ countryCode: 0 })], NOW), /countryCode/);
  assert.throws(() => validateAttestations([validRecord({ countryCode: 1000 })], NOW), /countryCode/);
});

test("rejects expired credentials and non-integer timestamps", () => {
  assert.throws(() => validateAttestations([validRecord({ expiresAt: NOW })], NOW), /expiresAt/);
  assert.throws(() => validateAttestations([validRecord({ expiresAt: NOW + 0.5 })], NOW), /expiresAt/);
});

test("validates schema UIDs", () => {
  assert.equal(normalizeSchemaUID(`0x${"a".repeat(64)}`), `0x${"a".repeat(64)}`);
  assert.throws(() => normalizeSchemaUID(`0x${"a".repeat(63)}`), /32-byte/);
});
