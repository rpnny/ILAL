import type { Address, Hex } from "viem";

export type Action = "swap" | "addLiquidity" | "removeLiquidity";

export const ACTION_CODES = {
  swap: 1,
  addLiquidity: 2,
  removeLiquidity: 3,
} as const satisfies Record<Action, number>;

export interface SessionToken {
  user: Address;
  authorizedCaller: Address;
  cnfIssuer: Address;
  chainId: bigint;
  verifyingHook: Address;
  poolId: Hex;
  action: number;
  deadline: bigint;
  nonce: Hex;
}

export interface SignedSession {
  token: SessionToken;
  signature: Hex;
}

export interface SessionTokenV2 {
  user: Address;
  authorizedCaller: Address;
  policyHash: bigint;
  policyRevision: bigint;
  chainId: bigint;
  verifyingHook: Address;
  poolId: Hex;
  action: number;
  deadline: bigint;
  nonce: Hex;
}

export interface SignedSessionV2 {
  token: SessionTokenV2;
  signature: Hex;
}

export interface CredentialStatus {
  exists: boolean;
  valid: boolean;
  tokenId: bigint;
  expiresAt: bigint;
  revoked: boolean;
}

export interface SignSessionParams {
  user: Address;
  /** v4 caller authorized to submit this session. For router flows, use the router address. */
  authorizedCaller?: Address;
  cnfIssuer: Address;
  poolId: Hex;
  action: Action;
  verifyingHook: Address;
  chainId: bigint;
  /** TTL in seconds — defaults to 600 (10 min) */
  expiresIn?: number;
}

export interface SignSessionV2Params {
  user: Address;
  /** v4 caller authorized to submit this session. For router flows, use the router address. */
  authorizedCaller?: Address;
  /** Current policy commitment read from EligibilityPolicyRegistryV2. */
  policyHash: bigint;
  /** Current policy revision read from EligibilityPolicyRegistryV2. */
  policyRevision: bigint;
  poolId: Hex;
  action: Action;
  verifyingHook: Address;
  chainId: bigint;
  /** TTL in seconds — defaults to 600 (10 min). */
  expiresIn?: number;
}
