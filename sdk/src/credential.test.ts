import { describe, it, expect, vi } from "vitest";
import { getCredentialStatus } from "./credential.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ISSUER  = "0x319c0F1cb46c85B42E051251c4db04BA6BD265a2" as const;
const WALLET  = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

interface MockCred {
  holder: string;
  issuer: string;
  credentialType: string;
  issuedAt: bigint;
  expiresAt: bigint;
  revoked: boolean;
}

const MOCK_CRED: MockCred = {
  holder:         WALLET,
  issuer:         ISSUER,
  credentialType: "0x0000000000000000000000000000000000000000000000000000000000001234",
  issuedAt:       BigInt(1_700_000_000),
  expiresAt:      BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 3600), // future
  revoked:        false,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function mockClient(opts: {
  isValid: boolean;
  tokenId: bigint;
  cred?: MockCred;
}) {
  return {
    readContract: vi.fn().mockImplementation(({ functionName }: { functionName: string }) => {
      if (functionName === "isValid")      return Promise.resolve(opts.isValid);
      if (functionName === "credentialOf") return Promise.resolve(opts.tokenId);
      if (functionName === "getCredential") return Promise.resolve(opts.cred ?? MOCK_CRED);
      throw new Error(`unexpected call: ${functionName}`);
    }),
  };
}

// ─── getCredentialStatus ─────────────────────────────────────────────────────

describe("getCredentialStatus", () => {
  it("returns exists=false when tokenId is 0", async () => {
    const client = mockClient({ isValid: false, tokenId: 0n });
    const result = await getCredentialStatus(client as any, ISSUER, WALLET);
    expect(result.exists).toBe(false);
    expect(result.valid).toBe(false);
    expect(result.tokenId).toBe(0n);
    expect(result.expiresAt).toBe(0n);
    expect(result.revoked).toBe(false);
    // Should not call getCredential when tokenId=0
    const calls = client.readContract.mock.calls.map((c: any) => c[0].functionName);
    expect(calls).not.toContain("getCredential");
  });

  it("returns exists=true with correct fields for a valid credential", async () => {
    const client = mockClient({ isValid: true, tokenId: 1n, cred: MOCK_CRED });
    const result = await getCredentialStatus(client as any, ISSUER, WALLET);
    expect(result.exists).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.tokenId).toBe(1n);
    expect(result.expiresAt).toBe(MOCK_CRED.expiresAt);
    expect(result.revoked).toBe(false);
  });

  it("reflects revoked=true from the on-chain credential", async () => {
    const revokedCred = { ...MOCK_CRED, revoked: true } as const;
    const client = mockClient({ isValid: false, tokenId: 2n, cred: revokedCred });
    const result = await getCredentialStatus(client as any, ISSUER, WALLET);
    expect(result.valid).toBe(false);
    expect(result.revoked).toBe(true);
    expect(result.exists).toBe(true);
  });

  it("reflects valid=false when credential is expired", async () => {
    const expiredCred = { ...MOCK_CRED, expiresAt: 1n }; // far in the past
    const client = mockClient({ isValid: false, tokenId: 3n, cred: expiredCred as any });
    const result = await getCredentialStatus(client as any, ISSUER, WALLET);
    expect(result.valid).toBe(false);
    expect(result.exists).toBe(true);
    expect(result.expiresAt).toBe(1n);
  });

  it("calls readContract with the correct contract address and args", async () => {
    const client = mockClient({ isValid: true, tokenId: 5n, cred: MOCK_CRED });
    await getCredentialStatus(client as any, ISSUER, WALLET);

    const calls = client.readContract.mock.calls;
    // Every call must target the issuer address
    for (const [{ address }] of calls) {
      expect(address.toLowerCase()).toBe(ISSUER.toLowerCase());
    }
    const fns = calls.map(([{ functionName }]: any) => functionName);
    expect(fns).toContain("isValid");
    expect(fns).toContain("credentialOf");
    expect(fns).toContain("getCredential");
  });
});
