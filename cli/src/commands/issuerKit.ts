import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { parse as parseCsv } from "csv-parse/sync";
import { poseidon2, poseidon6 } from "poseidon-lite";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
  getAddress,
  isAddress,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { fmt, header, log, die } from "../ui.js";

const CREDENTIAL_DEPTH = 20;
const JURISDICTION_DEPTH = 8;
const CIRCUIT_VERSION = 2n;
const SNARK_SCALAR_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const STORE_AAD = Buffer.from("ILAL_ISSUER_TREE_V1", "utf8");
const DEFAULT_STORE = ".ilal-issuer-v2.enc.json";
const JSON_DECISION_FIELDS = new Set([
  "wallet",
  "kycLevel",
  "countryCode",
  "expiresAt",
  "expiresInDays",
  "status",
  "verificationId",
]);
const CSV_DECISION_FIELDS = new Set([
  ...JSON_DECISION_FIELDS,
  "kyc_level",
  "country_code",
  "expires_at",
  "expires_in_days",
  "verification_id",
]);

export type IssuerCredentialStatus = "active" | "revoked";

export type IssuerCredentialRecord = {
  wallet: Address;
  kycLevel: number;
  countryCode: number;
  expiresAt: number;
  status: IssuerCredentialStatus;
  sourceRefHash?: Hex;
  addedAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export type IssuerTreeState = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  issuer: {
    name: string;
    schema: string;
    issuerHash: string;
    schemaHash: string;
  };
  policy: {
    minKycLevel: number;
    allowedCountries: number[];
    maxGrantTTL: number;
  };
  credentials: IssuerCredentialRecord[];
};

export type IssuerPolicyArtifacts = {
  issuerHash: string;
  schemaHash: string;
  credentialRoot: string;
  jurisdictionRoot: string;
  policyHash: string;
  minKycLevel: string;
  maxGrantTTL: string;
  circuitVersion: string;
  activeCredentials: number;
  allowedCountries: number[];
};

export type IssuerCredentialInput = {
  wallet: string;
  kycLevel: number | string;
  countryCode: number | string;
  expiresAt?: number | string;
  expiresInDays?: number | string;
  status?: string;
  verificationId?: string;
};

type EncryptedIssuerStore = {
  version: 1;
  cipher: "aes-256-gcm";
  kdf: "scrypt";
  salt: string;
  iv: string;
  authTag: string;
  ciphertext: string;
};

function fieldHash(domain: string, value: string): bigint {
  const digest = BigInt(keccak256(stringToBytes(`${domain}:${value.trim()}`)));
  return 1n + (digest % (SNARK_SCALAR_FIELD - 1n));
}

function parseInteger(raw: number | string, label: string, min: number, max: number): number {
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function parseCountryList(raw: string | number[]): number[] {
  const values = Array.isArray(raw) ? raw : raw.split(",").map((value) => value.trim()).filter(Boolean).map(Number);
  const countries = values.map((value) => parseInteger(value, "country code", 1, 999));
  const unique = [...new Set(countries)].sort((a, b) => a - b);
  if (unique.length === 0) throw new Error("at least one ISO 3166-1 numeric country code is required");
  return unique;
}

function parseExpiry(input: IssuerCredentialInput, fallbackDays = 365): number {
  if (input.expiresAt !== undefined && String(input.expiresAt).trim() !== "") {
    const raw = String(input.expiresAt).trim();
    const numeric = Number(raw);
    const parsed = Number.isSafeInteger(numeric) ? numeric : Math.floor(Date.parse(raw) / 1000);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("expiresAt must be a Unix timestamp or ISO-8601 date");
    return parsed;
  }
  const days = parseInteger(input.expiresInDays ?? fallbackDays, "expiresInDays", 1, 3650);
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}

function sourceRefHash(value?: string): Hex | undefined {
  const normalized = value?.trim();
  return normalized ? keccak256(stringToBytes(`ILAL_SOURCE_REF_V1:${normalized}`)) : undefined;
}

function assertDecisionFields(record: unknown, allowed: Set<string>, source: string): asserts record is Record<string, unknown> {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error(`${source} credential decision must be an object`);
  }
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`${source} contains unsupported credential fields: ${unexpected.join(", ")}. Remove PII and use only the documented schema.`);
  }
}

function normalizeWallet(wallet: string): Address {
  if (!isAddress(wallet)) throw new Error(`invalid wallet address: ${wallet}`);
  return getAddress(wallet);
}

function credentialLeaf(state: IssuerTreeState, credential: IssuerCredentialRecord): bigint {
  return poseidon6([
    BigInt(credential.wallet),
    BigInt(credential.kycLevel),
    BigInt(credential.countryCode),
    BigInt(credential.expiresAt),
    BigInt(state.issuer.issuerHash),
    BigInt(state.issuer.schemaHash),
  ]);
}

function jurisdictionLeaf(countryCode: number): bigint {
  return poseidon2([BigInt(countryCode), 2n]);
}

function activeCredentials(state: IssuerTreeState): IssuerCredentialRecord[] {
  return state.credentials
    .filter((credential) => credential.status === "active")
    .sort((left, right) => left.wallet.toLowerCase().localeCompare(right.wallet.toLowerCase()));
}

function buildCredentialTree(state: IssuerTreeState): {
  tree: IncrementalMerkleTree;
  credentials: IssuerCredentialRecord[];
} {
  const credentials = activeCredentials(state);
  const tree = new IncrementalMerkleTree(poseidon2, CREDENTIAL_DEPTH, 0n, 2);
  for (const credential of credentials) tree.insert(credentialLeaf(state, credential));
  return { tree, credentials };
}

function buildJurisdictionTree(state: IssuerTreeState): IncrementalMerkleTree {
  const tree = new IncrementalMerkleTree(poseidon2, JURISDICTION_DEPTH, 0n, 2);
  for (const country of state.policy.allowedCountries) tree.insert(jurisdictionLeaf(country));
  return tree;
}

function walletBits(wallet: Address): string[] {
  const value = BigInt(wallet);
  return Array.from({ length: 160 }, (_, index) => ((value >> BigInt(index)) & 1n).toString());
}

function walletHash(wallet: Address): bigint {
  return BigInt(keccak256(wallet as Hex)) >> 4n;
}

function firstSibling(proof: ReturnType<IncrementalMerkleTree["createProof"]>): string[] {
  return proof.siblings.map((siblings) => {
    const first = siblings[0];
    if (first === undefined) throw new Error("invalid binary Merkle proof");
    return first.toString();
  });
}

export function createIssuerTreeState(options: {
  issuer: string;
  schema: string;
  minKycLevel?: number | string;
  allowedCountries: string | number[];
  maxGrantTTL?: number | string;
  now?: Date;
}): IssuerTreeState {
  const issuer = options.issuer.trim();
  const schema = options.schema.trim();
  if (!issuer) throw new Error("issuer name is required");
  if (!schema) throw new Error("schema name is required");
  const timestamp = (options.now ?? new Date()).toISOString();
  return {
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    issuer: {
      name: issuer,
      schema,
      issuerHash: fieldHash("ILAL_ISSUER_V2", issuer).toString(),
      schemaHash: fieldHash("ILAL_SCHEMA_V2", schema).toString(),
    },
    policy: {
      minKycLevel: parseInteger(options.minKycLevel ?? 2, "minimum KYC level", 1, 3),
      allowedCountries: parseCountryList(options.allowedCountries),
      maxGrantTTL: parseInteger(options.maxGrantTTL ?? 86400, "maximum grant TTL", 1, 604800),
    },
    credentials: [],
  };
}

export function upsertIssuerCredential(
  state: IssuerTreeState,
  input: IssuerCredentialInput,
  options: { defaultExpiresInDays?: number; now?: Date; index?: Map<string, IssuerCredentialRecord> } = {}
): IssuerCredentialRecord {
  const wallet = normalizeWallet(input.wallet);
  const kycLevel = parseInteger(input.kycLevel, "KYC level", 0, 3);
  const countryCode = parseInteger(input.countryCode, "country code", 1, 999);
  const expiresAt = parseExpiry({ ...input, expiresInDays: input.expiresInDays ?? options.defaultExpiresInDays });
  const timestamp = (options.now ?? new Date()).toISOString();
  const walletKey = wallet.toLowerCase();
  const existing = options.index?.get(walletKey)
    ?? state.credentials.find((credential) => credential.wallet.toLowerCase() === walletKey);
  const record: IssuerCredentialRecord = {
    wallet,
    kycLevel,
    countryCode,
    expiresAt,
    status: "active",
    sourceRefHash: sourceRefHash(input.verificationId) ?? existing?.sourceRefHash,
    addedAt: existing?.addedAt ?? timestamp,
    updatedAt: timestamp,
  };
  if (existing) Object.assign(existing, record, { revokedAt: undefined });
  else state.credentials.push(record);
  options.index?.set(walletKey, existing ?? record);
  state.updatedAt = timestamp;
  return existing ?? record;
}

export function revokeIssuerCredential(
  state: IssuerTreeState,
  walletInput: string,
  now = new Date(),
  index?: Map<string, IssuerCredentialRecord>,
): IssuerCredentialRecord {
  const wallet = normalizeWallet(walletInput);
  const walletKey = wallet.toLowerCase();
  const credential = index?.get(walletKey)
    ?? state.credentials.find((item) => item.wallet.toLowerCase() === walletKey);
  if (!credential) throw new Error(`wallet is not present in the issuer tree: ${wallet}`);
  const timestamp = now.toISOString();
  credential.status = "revoked";
  credential.updatedAt = timestamp;
  credential.revokedAt = timestamp;
  state.updatedAt = timestamp;
  return credential;
}

export function computeIssuerPolicy(state: IssuerTreeState): IssuerPolicyArtifacts {
  const credential = buildCredentialTree(state);
  return computeIssuerPolicyFromRoot(state, credential.tree.root, credential.credentials.length);
}

function computeIssuerPolicyFromRoot(
  state: IssuerTreeState,
  credentialRoot: bigint,
  activeCredentialCount: number,
): IssuerPolicyArtifacts {
  const jurisdiction = buildJurisdictionTree(state);
  const policyHash = poseidon6([
    CIRCUIT_VERSION,
    BigInt(state.issuer.issuerHash),
    BigInt(state.issuer.schemaHash),
    credentialRoot,
    BigInt(state.policy.minKycLevel),
    jurisdiction.root,
  ]);
  return {
    issuerHash: state.issuer.issuerHash,
    schemaHash: state.issuer.schemaHash,
    credentialRoot: credentialRoot.toString(),
    jurisdictionRoot: jurisdiction.root.toString(),
    policyHash: policyHash.toString(),
    minKycLevel: state.policy.minKycLevel.toString(),
    maxGrantTTL: state.policy.maxGrantTTL.toString(),
    circuitVersion: CIRCUIT_VERSION.toString(),
    activeCredentials: activeCredentialCount,
    allowedCountries: [...state.policy.allowedCountries],
  };
}

export function buildIssuerWitness(state: IssuerTreeState, walletInput: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const wallet = normalizeWallet(walletInput);
  const { tree: credentialTree, credentials } = buildCredentialTree(state);
  const credentialIndex = credentials.findIndex((credential) => credential.wallet.toLowerCase() === wallet.toLowerCase());
  if (credentialIndex < 0) throw new Error(`wallet does not have an active issuer credential: ${wallet}`);
  const credential = credentials[credentialIndex]!;
  if (credential.expiresAt <= nowSeconds) throw new Error(`credential expired at ${new Date(credential.expiresAt * 1000).toISOString()}`);
  if (credential.kycLevel < state.policy.minKycLevel) {
    throw new Error(`credential KYC level ${credential.kycLevel} is below policy minimum ${state.policy.minKycLevel}`);
  }
  const countryIndex = state.policy.allowedCountries.indexOf(credential.countryCode);
  if (countryIndex < 0) throw new Error(`country ${credential.countryCode} is not allowed by the current policy`);

  const jurisdictionTree = buildJurisdictionTree(state);
  const credentialProof = credentialTree.createProof(credentialIndex);
  const jurisdictionProof = jurisdictionTree.createProof(countryIndex);
  const policy = computeIssuerPolicyFromRoot(state, credentialTree.root, credentials.length);
  return {
    walletField: BigInt(wallet).toString(),
    walletBits: walletBits(wallet),
    kycLevel: credential.kycLevel.toString(),
    countryCode: credential.countryCode.toString(),
    credentialPathElements: firstSibling(credentialProof),
    credentialPathIndices: credentialProof.pathIndices.map(String),
    jurisdictionPathElements: firstSibling(jurisdictionProof),
    jurisdictionPathIndices: jurisdictionProof.pathIndices.map(String),
    walletHash: walletHash(wallet).toString(),
    issuerHash: policy.issuerHash,
    schemaHash: policy.schemaHash,
    expiresAt: credential.expiresAt.toString(),
    credentialRoot: policy.credentialRoot,
    minKycLevel: policy.minKycLevel,
    jurisdictionRoot: policy.jurisdictionRoot,
    policyHash: policy.policyHash,
    circuitVersion: policy.circuitVersion,
  };
}

export function encryptIssuerTreeState(state: IssuerTreeState, password: string): EncryptedIssuerStore {
  if (password.length < 16) throw new Error("issuer store password must contain at least 16 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(STORE_AAD);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return {
    version: 1,
    cipher: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

export function decryptIssuerTreeState(envelope: EncryptedIssuerStore, password: string): IssuerTreeState {
  if (envelope.version !== 1 || envelope.cipher !== "aes-256-gcm" || envelope.kdf !== "scrypt") {
    throw new Error("unsupported issuer store format");
  }
  try {
    const salt = Buffer.from(envelope.salt, "base64");
    const iv = Buffer.from(envelope.iv, "base64");
    const authTag = Buffer.from(envelope.authTag, "base64");
    const ciphertext = Buffer.from(envelope.ciphertext, "base64");
    const key = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(STORE_AAD);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const state = JSON.parse(plaintext) as IssuerTreeState;
    if (state.version !== 1 || !state.issuer || !state.policy || !Array.isArray(state.credentials)) {
      throw new Error("invalid decrypted state");
    }
    return state;
  } catch (error) {
    throw new Error(`could not decrypt issuer store: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readPasswordFile(pathInput: string): string {
  const path = resolve(pathInput);
  const stats = statSync(path);
  if ((stats.mode & 0o077) !== 0) throw new Error(`password file permissions are too broad: ${path}. Use chmod 600.`);
  const password = readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
  if (password.length < 16) throw new Error("issuer store password must contain at least 16 characters");
  return password;
}

function storePath(pathInput?: string): string {
  return resolve(pathInput ?? DEFAULT_STORE);
}

function writeEncryptedStore(path: string, state: IssuerTreeState, password: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(encryptIssuerTreeState(state, password), null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function readEncryptedStore(path: string, password: string): IssuerTreeState {
  let envelope: EncryptedIssuerStore;
  try {
    envelope = JSON.parse(readFileSync(path, "utf8")) as EncryptedIssuerStore;
  } catch (error) {
    throw new Error(`could not read issuer store ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return decryptIssuerTreeState(envelope, password);
}

function loadCredentialInputs(pathInput: string, defaultExpiresInDays: number): IssuerCredentialInput[] {
  const path = resolve(pathInput);
  const contents = readFileSync(path, "utf8");
  if (path.toLowerCase().endsWith(".csv")) {
    const records = parseCsv(contents, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    if (records.length === 0) throw new Error("CSV import must contain at least one credential decision");
    return records.map((record) => {
      assertDecisionFields(record, CSV_DECISION_FIELDS, "CSV import");
      return {
        wallet: record["wallet"] ?? "",
        kycLevel: record["kycLevel"] ?? record["kyc_level"] ?? "",
        countryCode: record["countryCode"] ?? record["country_code"] ?? "",
        expiresAt: (record["expiresAt"] ?? record["expires_at"]) || undefined,
        expiresInDays: record["expiresInDays"] ?? record["expires_in_days"] ?? defaultExpiresInDays,
        status: record["status"],
        verificationId: record["verificationId"] ?? record["verification_id"],
      };
    });
  }
  const parsed = JSON.parse(contents) as unknown;
  if (!Array.isArray(parsed)) {
    if (!parsed || typeof parsed !== "object") throw new Error("JSON import must be an array or an object with a credentials array");
    const unexpected = Object.keys(parsed).filter((key) => !["version", "provider", "credentials"].includes(key));
    if (unexpected.length > 0) throw new Error(`JSON import contains unsupported top-level fields: ${unexpected.join(", ")}`);
    const version = (parsed as Record<string, unknown>)["version"];
    if (version !== undefined && version !== "1.0") throw new Error(`unsupported JSON decision schema version: ${String(version)}`);
  }
  const records = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>)["credentials"];
  if (!Array.isArray(records)) throw new Error("JSON import must be an array or an object with a credentials array");
  if (records.length === 0) throw new Error("JSON import must contain at least one credential decision");
  return records.map((record, index) => {
    assertDecisionFields(record, JSON_DECISION_FIELDS, `JSON import credential ${index + 1}`);
    const input = record as unknown as IssuerCredentialInput;
    return { ...input, expiresInDays: input.expiresInDays ?? defaultExpiresInDays };
  });
}

function importCredentials(state: IssuerTreeState, records: IssuerCredentialInput[], defaultExpiresInDays: number) {
  let approved = 0;
  let revoked = 0;
  let skipped = 0;
  const index = new Map(state.credentials.map((credential) => [credential.wallet.toLowerCase(), credential]));
  const seen = new Set<string>();
  for (const record of records) {
    const normalized = normalizeWallet(record.wallet);
    const walletKey = normalized.toLowerCase();
    if (seen.has(walletKey)) throw new Error(`duplicate wallet in credential import: ${normalized}`);
    seen.add(walletKey);
    const status = (record.status ?? "approved").trim().toLowerCase();
    if (["approved", "active", "pass", "passed"].includes(status)) {
      upsertIssuerCredential(state, record, { defaultExpiresInDays, index });
      approved += 1;
      continue;
    }
    if (["rejected", "revoked", "denied", "failed"].includes(status)) {
      const wallet = normalized;
      const existing = index.get(walletKey);
      if (existing) {
        revokeIssuerCredential(state, wallet, new Date(), index);
        revoked += 1;
      } else skipped += 1;
      continue;
    }
    throw new Error(`unsupported credential status for ${record.wallet}: ${record.status}`);
  }
  return { approved, revoked, skipped };
}

function showPolicy(state: IssuerTreeState, policy: IssuerPolicyArtifacts): void {
  log.kv("issuer", state.issuer.name);
  log.kv("schema", state.issuer.schema);
  log.kv("issuer hash", policy.issuerHash);
  log.kv("schema hash", policy.schemaHash);
  log.kv("credential root", policy.credentialRoot);
  log.kv("jurisdiction root", policy.jurisdictionRoot);
  log.kv("policy hash", policy.policyHash);
  log.kv("minimum KYC", policy.minKycLevel);
  log.kv("grant TTL", `${policy.maxGrantTTL}s`);
  log.kv("active wallets", policy.activeCredentials.toString());
  log.kv("countries", policy.allowedCountries.join(", "));
}

function commandError(error: unknown): never {
  die(error instanceof Error ? error.message : String(error));
}

export async function issuerTreeInit(opts: {
  issuer: string;
  schema: string;
  allowCountries: string;
  minKycLevel?: string;
  maxGrantTtl?: string;
  store?: string;
  storePasswordFile: string;
  force?: boolean;
}) {
  try {
    const path = storePath(opts.store);
    if (existsSync(path) && !opts.force) throw new Error(`issuer store already exists: ${path}. Pass --force to replace it.`);
    const password = readPasswordFile(opts.storePasswordFile);
    const state = createIssuerTreeState({
      issuer: opts.issuer,
      schema: opts.schema,
      allowedCountries: opts.allowCountries,
      minKycLevel: opts.minKycLevel,
      maxGrantTTL: opts.maxGrantTtl,
    });
    writeEncryptedStore(path, state, password);
    header("Issuer Tree Initialized", "encrypted local store");
    showPolicy(state, computeIssuerPolicy(state));
    log.kv("store", fmt.gray(path));
    log.info("The store contains no PII fields and is encrypted with AES-256-GCM.");
    console.log();
  } catch (error) {
    commandError(error);
  }
}

export async function issuerTreeAdd(opts: {
  wallet: string;
  kycLevel: string;
  country: string;
  expiresAt?: string;
  expiresInDays?: string;
  verificationId?: string;
  store?: string;
  storePasswordFile: string;
}) {
  try {
    const path = storePath(opts.store);
    const password = readPasswordFile(opts.storePasswordFile);
    const state = readEncryptedStore(path, password);
    const credential = upsertIssuerCredential(state, {
      wallet: opts.wallet,
      kycLevel: opts.kycLevel,
      countryCode: opts.country,
      expiresAt: opts.expiresAt,
      expiresInDays: opts.expiresInDays,
      verificationId: opts.verificationId,
    });
    writeEncryptedStore(path, state, password);
    header("Issuer Credential Added");
    log.kv("wallet", fmt.addr(credential.wallet));
    log.kv("KYC level", credential.kycLevel.toString());
    log.kv("country", credential.countryCode.toString());
    log.kv("expires", new Date(credential.expiresAt * 1000).toISOString());
    log.kv("credential root", computeIssuerPolicy(state).credentialRoot);
    console.log();
  } catch (error) {
    commandError(error);
  }
}

export async function issuerTreeImport(opts: {
  file: string;
  defaultExpiresInDays?: string;
  store?: string;
  storePasswordFile: string;
}) {
  try {
    const defaultDays = parseInteger(opts.defaultExpiresInDays ?? 365, "default expiry days", 1, 3650);
    const path = storePath(opts.store);
    const password = readPasswordFile(opts.storePasswordFile);
    const state = readEncryptedStore(path, password);
    const result = importCredentials(state, loadCredentialInputs(opts.file, defaultDays), defaultDays);
    writeEncryptedStore(path, state, password);
    header("Issuer Credentials Imported");
    log.kv("approved", result.approved.toString());
    log.kv("revoked", result.revoked.toString());
    log.kv("skipped", result.skipped.toString());
    log.info("Run `ilal issuer tree root` to compute and export the updated commitment.");
    console.log();
  } catch (error) {
    commandError(error);
  }
}

export async function issuerTreeRevoke(opts: { wallet: string; store?: string; storePasswordFile: string }) {
  try {
    const path = storePath(opts.store);
    const password = readPasswordFile(opts.storePasswordFile);
    const state = readEncryptedStore(path, password);
    const credential = revokeIssuerCredential(state, opts.wallet);
    writeEncryptedStore(path, state, password);
    header("Issuer Credential Revoked");
    log.kv("wallet", fmt.addr(credential.wallet));
    log.kv("credential root", computeIssuerPolicy(state).credentialRoot);
    log.warn("Publish the new root through `ilal policy admin set` before relying on the revocation on-chain.");
    console.log();
  } catch (error) {
    commandError(error);
  }
}

export async function issuerTreeRoot(opts: { out?: string; store?: string; storePasswordFile: string }) {
  try {
    const path = storePath(opts.store);
    const password = readPasswordFile(opts.storePasswordFile);
    const state = readEncryptedStore(path, password);
    const policy = computeIssuerPolicy(state);
    if (opts.out) {
      const output = resolve(opts.out);
      mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      writeFileSync(output, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
      chmodSync(output, 0o600);
    }
    header("Issuer Policy Commitment");
    showPolicy(state, policy);
    if (opts.out) log.kv("policy file", fmt.gray(resolve(opts.out)));
    log.line();
    log.command(`ilal policy admin set --issuer-hash ${policy.issuerHash} --schema-hash ${policy.schemaHash} --credential-root ${policy.credentialRoot} --min-kyc-level ${policy.minKycLevel} --jurisdiction-root ${policy.jurisdictionRoot} --policy-hash ${policy.policyHash} --max-grant-ttl ${policy.maxGrantTTL}`);
    console.log();
  } catch (error) {
    commandError(error);
  }
}

export async function issuerTreeExportWitness(opts: {
  wallet: string;
  out: string;
  store?: string;
  storePasswordFile: string;
}) {
  try {
    const path = storePath(opts.store);
    const password = readPasswordFile(opts.storePasswordFile);
    const state = readEncryptedStore(path, password);
    const witness = buildIssuerWitness(state, opts.wallet);
    const output = resolve(opts.out);
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
    writeFileSync(output, `${JSON.stringify(witness, null, 2)}\n`, { mode: 0o600 });
    chmodSync(output, 0o600);
    header("Wallet-Bound Policy Witness", "private file");
    log.kv("wallet", fmt.addr(normalizeWallet(opts.wallet)));
    log.kv("output", fmt.gray(output));
    log.kv("mode", "600");
    log.warn("Deliver this file only to the wallet owner over an authenticated encrypted channel.");
    log.command(`ilal policy proof generate --input ${output} --circuit-dir circuits/build-v2 --out-dir artifacts/v2-proof`);
    console.log();
  } catch (error) {
    commandError(error);
  }
}
