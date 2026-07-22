import { type WalletClient } from "viem";
import {
  type SignSessionParams,
  type SignSessionV2Params,
  type SignedSession,
  type SignedSessionV2,
  type SessionToken,
  type SessionTokenV2,
  ACTION_CODES,
} from "./types.js";

const SESSION_TOKEN_TYPE = [
  { name: "user", type: "address" },
  { name: "authorizedCaller", type: "address" },
  { name: "cnfIssuer", type: "address" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingHook", type: "address" },
  { name: "poolId", type: "bytes32" },
  { name: "action", type: "uint8" },
  { name: "deadline", type: "uint64" },
  { name: "nonce", type: "bytes32" },
] as const;

const SESSION_TOKEN_V2_TYPE = [
  { name: "user", type: "address" },
  { name: "authorizedCaller", type: "address" },
  { name: "policyHash", type: "uint256" },
  { name: "policyRevision", type: "uint64" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingHook", type: "address" },
  { name: "poolId", type: "bytes32" },
  { name: "action", type: "uint8" },
  { name: "deadline", type: "uint64" },
  { name: "nonce", type: "bytes32" },
] as const;

function randomNonce(): `0x${string}` {
  return `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

/**
 * Build and sign a 10-minute EIP-712 session token locally.
 * No ILAL API call required — the signature goes directly into hookData.
 */
export async function signSession(
  wallet: WalletClient,
  params: SignSessionParams
): Promise<SignedSession> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.expiresIn ?? 600));
  const nonce = randomNonce();

  const token: SessionToken = {
    user: params.user,
    authorizedCaller: params.authorizedCaller ?? params.user,
    cnfIssuer: params.cnfIssuer,
    chainId: params.chainId,
    verifyingHook: params.verifyingHook,
    poolId: params.poolId,
    action: ACTION_CODES[params.action],
    deadline,
    nonce,
  };

  const signature = await wallet.signTypedData({
    account: params.user,
    domain: {
      name: "ILAL ComplianceHook",
      version: "1",
      chainId: params.chainId,
      verifyingContract: params.verifyingHook,
    },
    types: { SessionToken: SESSION_TOKEN_TYPE },
    primaryType: "SessionToken",
    message: token,
  });

  return { token, signature };
}

/**
 * Build and sign a v2 policy-bound session token locally.
 * A policy revision change invalidates the session even before its deadline.
 */
export async function signSessionV2(
  wallet: WalletClient,
  params: SignSessionV2Params
): Promise<SignedSessionV2> {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.expiresIn ?? 600));
  const token: SessionTokenV2 = {
    user: params.user,
    authorizedCaller: params.authorizedCaller ?? params.user,
    policyHash: params.policyHash,
    policyRevision: params.policyRevision,
    chainId: params.chainId,
    verifyingHook: params.verifyingHook,
    poolId: params.poolId,
    action: ACTION_CODES[params.action],
    deadline,
    nonce: randomNonce(),
  };

  const signature = await wallet.signTypedData({
    account: params.user,
    domain: {
      name: "ILAL ComplianceHook",
      version: "2",
      chainId: params.chainId,
      verifyingContract: params.verifyingHook,
    },
    types: { SessionTokenV2: SESSION_TOKEN_V2_TYPE },
    primaryType: "SessionTokenV2",
    message: token,
  });

  return { token, signature };
}
