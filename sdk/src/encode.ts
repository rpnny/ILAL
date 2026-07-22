import { encodeAbiParameters, parseAbiParameters } from "viem";
import type { SignedSession, SignedSessionV2 } from "./types.js";

const SESSION_TOKEN_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, address cnfIssuer, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

const SESSION_TOKEN_V2_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, uint256 policyHash, uint64 policyRevision, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

/**
 * ABI-encode a signed session into the hookData bytes expected by ComplianceHook.
 * Pass the result as `hookData` in your Uniswap v4 swap / modifyLiquidity call.
 */
export function encodeHookData(session: SignedSession): `0x${string}` {
  return encodeAbiParameters(SESSION_TOKEN_ABI, [session.token, session.signature]);
}

/** ABI-encode a v2 policy-bound session for ComplianceHookV2. */
export function encodeHookDataV2(session: SignedSessionV2): `0x${string}` {
  return encodeAbiParameters(SESSION_TOKEN_V2_ABI, [session.token, session.signature]);
}
