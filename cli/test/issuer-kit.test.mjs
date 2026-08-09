import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import {
  buildIssuerWitness,
  computeIssuerPolicy,
  createIssuerTreeState,
  decryptIssuerTreeState,
  encryptIssuerTreeState,
  revokeIssuerCredential,
  upsertIssuerCredential,
} from "../dist/commands/issuerKit.js";

const cli = new URL("../dist/index.js", import.meta.url).pathname;
const repositoryRoot = resolve(new URL("../../", import.meta.url).pathname);
const walletA = "0x1111111111111111111111111111111111111111";
const walletB = "0x2222222222222222222222222222222222222222";

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.replace(/\x1b\[[0-9;]*m/g, "");
}

test("issuer tree roots are deterministic and revoked wallets cannot export witnesses", () => {
  const options = {
    issuer: "Institution Sandbox",
    schema: "institutional-kyc-v1",
    allowedCountries: [756, 826, 840],
    now: new Date("2026-08-09T00:00:00Z"),
  };
  const left = createIssuerTreeState(options);
  const right = createIssuerTreeState(options);
  const expiresAt = 2_000_000_000;
  upsertIssuerCredential(left, { wallet: walletA, kycLevel: 3, countryCode: 840, expiresAt });
  upsertIssuerCredential(left, { wallet: walletB, kycLevel: 2, countryCode: 826, expiresAt });
  upsertIssuerCredential(right, { wallet: walletB, kycLevel: 2, countryCode: 826, expiresAt });
  upsertIssuerCredential(right, { wallet: walletA, kycLevel: 3, countryCode: 840, expiresAt });

  assert.deepEqual(computeIssuerPolicy(left), computeIssuerPolicy(right));
  const witness = buildIssuerWitness(left, walletA, 1_900_000_000);
  assert.equal(witness.kycLevel, "3");
  assert.equal(witness.countryCode, "840");
  assert.equal(witness.credentialPathElements.length, 20);
  assert.equal(witness.jurisdictionPathElements.length, 8);

  revokeIssuerCredential(left, walletA, new Date("2026-08-10T00:00:00Z"));
  assert.throws(() => buildIssuerWitness(left, walletA, 1_900_000_000), /does not have an active issuer credential/);
  assert.notEqual(computeIssuerPolicy(left).credentialRoot, computeIssuerPolicy(right).credentialRoot);
});

test("issuer tree encryption rejects the wrong password and hides credential data", () => {
  const state = createIssuerTreeState({
    issuer: "Private Issuer",
    schema: "kyc-v1",
    allowedCountries: [840],
  });
  upsertIssuerCredential(state, {
    wallet: walletA,
    kycLevel: 3,
    countryCode: 840,
    expiresAt: 2_000_000_000,
    verificationId: "provider-secret-reference",
  });
  const envelope = encryptIssuerTreeState(state, "correct horse battery staple");
  const serialized = JSON.stringify(envelope);
  assert.doesNotMatch(serialized, /Private Issuer|provider-secret-reference|1111111111111111/);
  assert.equal(decryptIssuerTreeState(envelope, "correct horse battery staple").credentials[0].wallet, walletA);
  assert.throws(() => decryptIssuerTreeState(envelope, "wrong password"), /could not decrypt issuer store/);
});

test("CLI issuer kit imports CSV, exports a mode-600 witness, and produces a real v2 proof", { timeout: 30_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-issuer-kit-"));
  const password = join(dir, "issuer.password");
  const store = join(dir, "issuer.enc.json");
  const decisions = join(dir, "decisions.csv");
  const policy = join(dir, "policy.json");
  const witness = join(dir, "wallet-a-witness.json");
  const proofDir = join(dir, "proof");
  writeFileSync(password, "correct horse battery staple\n", { mode: 0o600 });
  chmodSync(password, 0o600);
  writeFileSync(decisions, [
    "wallet,kycLevel,countryCode,expiresAt,status,verificationId",
    `${walletA},3,840,2000000000,approved,provider-a`,
    `${walletB},2,826,2000000000,approved,provider-b`,
  ].join("\n"));

  try {
    let result = run(dir, [
      "issuer", "tree", "init",
      "--issuer", "Institution Sandbox",
      "--schema", "institutional-kyc-v1",
      "--allow-countries", "840,826,756",
      "--store", store,
      "--store-password-file", password,
    ]);
    assert.equal(result.status, 0, output(result));

    result = run(dir, ["issuer", "tree", "import", "--file", decisions, "--store", store, "--store-password-file", password]);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /approved\s+2/);

    result = run(dir, ["issuer", "tree", "root", "--out", policy, "--store", store, "--store-password-file", password]);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /ilal policy admin set/);

    result = run(dir, [
      "issuer", "tree", "export-witness",
      "--wallet", walletA,
      "--out", witness,
      "--store", store,
      "--store-password-file", password,
    ]);
    assert.equal(result.status, 0, output(result));
    assert.equal(statSync(store).mode & 0o777, 0o600);
    assert.equal(statSync(policy).mode & 0o777, 0o600);
    assert.equal(statSync(witness).mode & 0o777, 0o600);
    const privateInput = JSON.parse(readFileSync(witness, "utf8"));
    assert.equal(privateInput.kycLevel, "3");
    assert.equal(privateInput.countryCode, "840");

    result = run(repositoryRoot, [
      "policy", "proof", "generate",
      "--input", witness,
      "--circuit-dir", join(repositoryRoot, "circuits", "build-v2"),
      "--out-dir", proofDir,
    ]);
    assert.equal(result.status, 0, output(result));
    assert.match(output(result), /Proof generated and verified locally/);
    assert.equal(JSON.parse(readFileSync(join(proofDir, "public.json"), "utf8")).length, 9);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("issuer tree password files must not be group-readable", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-issuer-password-"));
  const password = join(dir, "issuer.password");
  writeFileSync(password, "not-secret-enough\n", { mode: 0o644 });
  chmodSync(password, 0o644);
  try {
    const result = run(dir, [
      "issuer", "tree", "init",
      "--issuer", "Issuer",
      "--schema", "schema-v1",
      "--allow-countries", "840",
      "--store-password-file", password,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(output(result), /permissions are too broad/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("issuer imports reject undocumented fields instead of accepting PII", () => {
  const dir = mkdtempSync(join(tmpdir(), "ilal-issuer-pii-"));
  const password = join(dir, "issuer.password");
  const decisions = join(dir, "decisions.json");
  writeFileSync(password, "correct horse battery staple\n", { mode: 0o600 });
  chmodSync(password, 0o600);
  writeFileSync(decisions, JSON.stringify({
    version: "1.0",
    credentials: [{
      wallet: walletA,
      kycLevel: 3,
      countryCode: 840,
      status: "approved",
      fullName: "Must Not Enter The Issuer Store",
    }],
  }));

  try {
    let result = run(dir, [
      "issuer", "tree", "init",
      "--issuer", "Issuer",
      "--schema", "schema-v1",
      "--allow-countries", "840",
      "--store-password-file", password,
    ]);
    assert.equal(result.status, 0, output(result));

    result = run(dir, [
      "issuer", "tree", "import",
      "--file", decisions,
      "--store-password-file", password,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(output(result), /unsupported credential fields: fullName/);
    assert.match(output(result), /Remove PII/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
