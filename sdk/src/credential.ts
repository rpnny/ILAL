import { type PublicClient, type Address } from "viem";
import type { CredentialStatus } from "./types.js";

const CNF_ISSUER_ABI = [
  {
    name: "isValid",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "credentialOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "getCredential",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "holder", type: "address" },
          { name: "issuer", type: "address" },
          { name: "credentialType", type: "bytes32" },
          { name: "issuedAt", type: "uint64" },
          { name: "expiresAt", type: "uint64" },
          { name: "revoked", type: "bool" },
        ],
      },
    ],
  },
] as const;

/**
 * Fetch a wallet's compliance credential status from CNFIssuer.
 * Use this to decide whether the user needs to mint/renew before trading.
 */
export async function getCredentialStatus(
  client: PublicClient,
  cnfIssuer: Address,
  wallet: Address
): Promise<CredentialStatus> {
  const [valid, tokenId] = await Promise.all([
    client.readContract({ address: cnfIssuer, abi: CNF_ISSUER_ABI, functionName: "isValid", args: [wallet] }),
    client.readContract({ address: cnfIssuer, abi: CNF_ISSUER_ABI, functionName: "credentialOf", args: [wallet] }),
  ]);

  if (tokenId === 0n) {
    return { exists: false, valid: false, tokenId: 0n, expiresAt: 0n, revoked: false };
  }

  const cred = await client.readContract({
    address: cnfIssuer,
    abi: CNF_ISSUER_ABI,
    functionName: "getCredential",
    args: [tokenId],
  });

  return {
    exists: true,
    valid,
    tokenId,
    expiresAt: cred.expiresAt,
    revoked: cred.revoked,
  };
}
