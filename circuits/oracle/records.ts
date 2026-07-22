import { poseidon4 } from "poseidon-lite";

export const TREE_DEPTH = 20;
export const MAX_TREE_LEAVES = 2 ** TREE_DEPTH;

export interface AttestationRecord {
  wallet: string;
  kycLevel: number;
  countryCode: number;
  expiresAt: number;
}

export interface LeafRecord extends AttestationRecord {
  walletField: string;
  leaf: string;
  leafIndex: number;
}

export function normalizeAddress(value: unknown, field = "wallet"): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${field} must be a 20-byte 0x-prefixed Ethereum address`);
  }
  if (/^0x0{40}$/i.test(value)) throw new Error(`${field} cannot be the zero address`);
  return value.toLowerCase();
}

export function normalizeSchemaUID(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("schema must be a 32-byte 0x-prefixed UID");
  }
  return value.toLowerCase();
}

function integerInRange(value: unknown, min: number, max: number, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${field} must be an integer in [${min}, ${max}]`);
  }
  return value as number;
}

export function validateAttestations(raw: unknown, nowSeconds = Math.floor(Date.now() / 1000)): AttestationRecord[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("attestations must be a non-empty JSON array");
  }
  if (raw.length > MAX_TREE_LEAVES) {
    throw new Error(`attestations exceed the depth-${TREE_DEPTH} tree capacity`);
  }

  const wallets = new Set<string>();
  return raw.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`attestations[${index}] must be an object`);
    }
    const source = item as Record<string, unknown>;
    const wallet = normalizeAddress(source.wallet, `attestations[${index}].wallet`);
    if (wallets.has(wallet)) throw new Error(`duplicate wallet at attestations[${index}]: ${wallet}`);
    wallets.add(wallet);

    const kycLevel = integerInRange(source.kycLevel, 0, 3, `attestations[${index}].kycLevel`);
    const countryCode = integerInRange(source.countryCode, 1, 999, `attestations[${index}].countryCode`);
    const expiresAt = integerInRange(
      source.expiresAt,
      nowSeconds + 1,
      Number.MAX_SAFE_INTEGER,
      `attestations[${index}].expiresAt`,
    );

    return { wallet, kycLevel, countryCode, expiresAt };
  });
}

export function addressToField(address: string): bigint {
  return BigInt(normalizeAddress(address));
}

export function computeLeaf(record: AttestationRecord): bigint {
  return poseidon4([
    addressToField(record.wallet),
    BigInt(record.kycLevel),
    BigInt(record.countryCode),
    BigInt(record.expiresAt),
  ]);
}
