import assert from "node:assert/strict";
import test from "node:test";
import { computeLeaf, normalizeAddress, normalizeSchemaUID, validateAttestations } from "./records.js";

const NOW = 1_800_000_000;
const WALLET = "0x1111111111111111111111111111111111111111";

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
  assert.equal(record!.wallet, WALLET);
  assert.equal(computeLeaf(record!).toString(), computeLeaf(record!).toString());
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
