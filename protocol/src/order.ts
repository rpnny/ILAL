import {
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  isAddress,
  keccak256,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import { NETTING_ORDER_COMPONENTS } from "./abis.js";

export const ORDER_DOMAIN_NAME = "ILAL Institutional Netting" as const;
export const ORDER_DOMAIN_VERSION = "1" as const;
export const ORDER_INTENT_FORMAT = "ilal-order-intent-v1" as const;
export const SIGNED_ORDER_FORMAT = "ilal-netting-order-v1" as const;

const UINT128_MAX = (1n << 128n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const ORDER_TYPEHASH = keccak256(new TextEncoder().encode(
  "NettingOrder(address user,bytes32 poolId,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint128 maxAmmInput,uint64 deadline,bytes32 nonce)",
));

export interface NettingOrder {
  user: Address;
  poolId: Hex;
  zeroForOne: boolean;
  amountIn: bigint;
  minAmountOut: bigint;
  maxAmmInput: bigint;
  deadline: bigint;
  nonce: Hex;
}

export interface OrderDomain {
  name: typeof ORDER_DOMAIN_NAME;
  version: typeof ORDER_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: Address;
}

export type SerializedNettingOrder = Record<keyof NettingOrder, string | boolean>;

export interface OrderIntentFile {
  format: typeof ORDER_INTENT_FORMAT;
  domain: OrderDomain;
  order: SerializedNettingOrder;
}

export interface SignedOrderFile {
  format: typeof SIGNED_ORDER_FORMAT;
  domain: OrderDomain;
  order: SerializedNettingOrder;
  signature: Hex;
}

export interface TypedDataSigner {
  signTypedData(args: {
    domain: OrderDomain;
    primaryType: "NettingOrder";
    types: { NettingOrder: typeof NETTING_ORDER_COMPONENTS };
    message: NettingOrder;
  }): Promise<Hex>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be a valid address.`);
  return getAddress(value);
}

function bytes32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be 32-byte hex.`);
  return value.toLowerCase() as Hex;
}

function uint(value: unknown, label: string, maximum: bigint): bigint {
  if ((typeof value !== "string" && typeof value !== "bigint" && typeof value !== "number") || !/^\d+$/.test(String(value))) {
    throw new Error(`${label} must be an unsigned decimal integer.`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`${label} exceeds its on-chain integer range.`);
  return parsed;
}

function domain(value: unknown): OrderDomain {
  const raw = record(value, "domain");
  const chainId = Number(raw["chainId"]);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("domain.chainId must be a positive safe integer.");
  if (raw["name"] !== ORDER_DOMAIN_NAME || raw["version"] !== ORDER_DOMAIN_VERSION) {
    throw new Error("Order must use the ILAL Institutional Netting v1 EIP-712 domain.");
  }
  return { name: ORDER_DOMAIN_NAME, version: ORDER_DOMAIN_VERSION, chainId, verifyingContract: address(raw["verifyingContract"], "domain.verifyingContract") };
}

export function parseNettingOrder(value: unknown): NettingOrder {
  const raw = record(value, "order");
  const order: NettingOrder = {
    user: address(raw["user"], "order.user"),
    poolId: bytes32(raw["poolId"], "order.poolId"),
    zeroForOne: raw["zeroForOne"] === true,
    amountIn: uint(raw["amountIn"], "order.amountIn", UINT128_MAX),
    minAmountOut: uint(raw["minAmountOut"], "order.minAmountOut", UINT128_MAX),
    maxAmmInput: uint(raw["maxAmmInput"], "order.maxAmmInput", UINT128_MAX),
    deadline: uint(raw["deadline"], "order.deadline", UINT64_MAX),
    nonce: bytes32(raw["nonce"], "order.nonce"),
  };
  if (typeof raw["zeroForOne"] !== "boolean") throw new Error("order.zeroForOne must be boolean.");
  if (order.amountIn === 0n) throw new Error("order.amountIn must be positive.");
  return order;
}

export function serializeOrder(order: NettingOrder): SerializedNettingOrder {
  return {
    user: getAddress(order.user),
    poolId: bytes32(order.poolId, "order.poolId"),
    zeroForOne: order.zeroForOne,
    amountIn: order.amountIn.toString(),
    minAmountOut: order.minAmountOut.toString(),
    maxAmmInput: order.maxAmmInput.toString(),
    deadline: order.deadline.toString(),
    nonce: bytes32(order.nonce, "order.nonce"),
  };
}

export function createOrderIntent(input: { domain: Omit<OrderDomain, "name" | "version">; order: NettingOrder }): OrderIntentFile {
  const normalizedDomain = domain({ name: ORDER_DOMAIN_NAME, version: ORDER_DOMAIN_VERSION, ...input.domain });
  const normalizedOrder = parseNettingOrder(serializeOrder(input.order));
  return { format: ORDER_INTENT_FORMAT, domain: normalizedDomain, order: serializeOrder(normalizedOrder) };
}

export function parseOrderIntent(value: unknown): OrderIntentFile {
  const raw = record(value, "order intent");
  if (raw["format"] !== ORDER_INTENT_FORMAT) throw new Error(`Expected ${ORDER_INTENT_FORMAT}.`);
  const parsedDomain = domain(raw["domain"]);
  return { format: ORDER_INTENT_FORMAT, domain: parsedDomain, order: serializeOrder(parseNettingOrder(raw["order"])) };
}

export function parseSignedOrder(value: unknown): SignedOrderFile {
  const raw = record(value, "signed order");
  if (raw["format"] !== SIGNED_ORDER_FORMAT) throw new Error(`Expected ${SIGNED_ORDER_FORMAT}.`);
  // EOA signatures are normally 65 bytes, but ERC-1271 deliberately permits
  // wallet-defined byte payloads (including an empty payload). Signature
  // validity therefore belongs to the Hook's on-chain validation path.
  if (typeof raw["signature"] !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(raw["signature"])) {
    throw new Error("signature must be even-length hex bytes.");
  }
  return {
    format: SIGNED_ORDER_FORMAT,
    domain: domain(raw["domain"]),
    order: serializeOrder(parseNettingOrder(raw["order"])),
    signature: raw["signature"].toLowerCase() as Hex,
  };
}

export async function signOrder(intentValue: OrderIntentFile, signer: TypedDataSigner): Promise<SignedOrderFile> {
  const intent = parseOrderIntent(intentValue);
  const message = parseNettingOrder(intent.order);
  const signature = await signer.signTypedData({
    domain: intent.domain,
    primaryType: "NettingOrder",
    types: { NettingOrder: NETTING_ORDER_COMPONENTS },
    message,
  });
  return parseSignedOrder({ format: SIGNED_ORDER_FORMAT, domain: intent.domain, order: intent.order, signature });
}

export function hashOrder(order: NettingOrder): Hex {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,address,bytes32,bool,uint128,uint128,uint128,uint64,bytes32"),
    [ORDER_TYPEHASH, order.user, order.poolId, order.zeroForOne, order.amountIn, order.minAmountOut, order.maxAmmInput, order.deadline, order.nonce],
  ));
}

export function orderDigest(fileValue: SignedOrderFile | OrderIntentFile): Hex {
  const file = fileValue.format === SIGNED_ORDER_FORMAT ? parseSignedOrder(fileValue) : parseOrderIntent(fileValue);
  return hashTypedData({ domain: file.domain, primaryType: "NettingOrder", types: { NettingOrder: NETTING_ORDER_COMPONENTS }, message: parseNettingOrder(file.order) });
}
