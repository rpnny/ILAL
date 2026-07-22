import { describe, it, expect, vi, beforeEach } from "vitest";
import { signSession, signSessionV2 } from "./session.js";
import { encodeHookData, encodeHookDataV2 } from "./encode.js";
import { ACTION_CODES } from "./types.js";
import type { SignedSession, SignedSessionV2 } from "./types.js";
import { decodeAbiParameters, parseAbiParameters } from "viem";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER       = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const CALLER     = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const ISSUER     = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const;
const HOOK       = "0x90F79bf6EB2c4f870365E785982E1f101E93b906" as const;
const POOL_ID    = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const;
const CHAIN_ID   = 84532n;
const FAKE_SIG   = `0x${"ab".repeat(65)}` as const; // 65 bytes, valid-length

// ─── Mock WalletClient ────────────────────────────────────────────────────────

function makeMockWallet(sig = FAKE_SIG) {
  return {
    signTypedData: vi.fn().mockResolvedValue(sig),
  };
}

// ─── signSession ─────────────────────────────────────────────────────────────

describe("signSession", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("returns a SignedSession with correct token fields", async () => {
    const wallet = makeMockWallet();
    const result = await signSession(wallet as any, {
      user:             USER,
      authorizedCaller: CALLER,
      cnfIssuer:        ISSUER,
      poolId:           POOL_ID,
      action:           "swap",
      verifyingHook:    HOOK,
      chainId:          CHAIN_ID,
    });

    expect(result.token.user).toBe(USER);
    expect(result.token.authorizedCaller).toBe(CALLER);
    expect(result.token.cnfIssuer).toBe(ISSUER);
    expect(result.token.chainId).toBe(CHAIN_ID);
    expect(result.token.verifyingHook).toBe(HOOK);
    expect(result.token.poolId).toBe(POOL_ID);
    expect(result.token.action).toBe(ACTION_CODES.swap);
    expect(result.signature).toBe(FAKE_SIG);
  });

  it("sets deadline to now + expiresIn", async () => {
    const now = Math.floor(Date.now() / 1000);
    const wallet = makeMockWallet();
    const result = await signSession(wallet as any, {
      user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
      poolId: POOL_ID, action: "swap", verifyingHook: HOOK, chainId: CHAIN_ID,
      expiresIn: 300,
    });
    expect(result.token.deadline).toBe(BigInt(now + 300));
  });

  it("defaults expiresIn to 600 seconds", async () => {
    const now = Math.floor(Date.now() / 1000);
    const wallet = makeMockWallet();
    const result = await signSession(wallet as any, {
      user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
      poolId: POOL_ID, action: "swap", verifyingHook: HOOK, chainId: CHAIN_ID,
    });
    expect(result.token.deadline).toBe(BigInt(now + 600));
  });

  it("defaults authorizedCaller to user when omitted", async () => {
    const wallet = makeMockWallet();
    const result = await signSession(wallet as any, {
      user: USER, cnfIssuer: ISSUER,
      poolId: POOL_ID, action: "swap", verifyingHook: HOOK, chainId: CHAIN_ID,
    });
    expect(result.token.authorizedCaller).toBe(USER);
  });

  it("generates a unique nonce each call", async () => {
    const wallet = makeMockWallet();
    const params = {
      user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
      poolId: POOL_ID, action: "swap" as const, verifyingHook: HOOK, chainId: CHAIN_ID,
    };
    const [r1, r2] = await Promise.all([
      signSession(wallet as any, params),
      signSession(wallet as any, params),
    ]);
    expect(r1.token.nonce).not.toBe(r2.token.nonce);
  });

  it("maps action strings to the correct uint8 codes", async () => {
    const wallet = makeMockWallet();
    const base = {
      user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
      poolId: POOL_ID, verifyingHook: HOOK, chainId: CHAIN_ID,
    };
    const s  = await signSession(wallet as any, { ...base, action: "swap" });
    const al = await signSession(wallet as any, { ...base, action: "addLiquidity" });
    const rl = await signSession(wallet as any, { ...base, action: "removeLiquidity" });
    expect(s.token.action).toBe(1);
    expect(al.token.action).toBe(2);
    expect(rl.token.action).toBe(3);
  });

  it("calls signTypedData with the correct EIP-712 domain", async () => {
    const wallet = makeMockWallet();
    await signSession(wallet as any, {
      user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
      poolId: POOL_ID, action: "swap", verifyingHook: HOOK, chainId: CHAIN_ID,
    });

    expect(wallet.signTypedData).toHaveBeenCalledOnce();
    const call = wallet.signTypedData.mock.calls[0]![0];
    expect(call.domain.name).toBe("ILAL ComplianceHook");
    expect(call.domain.version).toBe("1");
    expect(call.domain.chainId).toBe(CHAIN_ID);
    expect(call.domain.verifyingContract).toBe(HOOK);
    expect(call.primaryType).toBe("SessionToken");
  });
});

// ─── encodeHookData ───────────────────────────────────────────────────────────

const SESSION_TOKEN_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, address cnfIssuer, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

describe("encodeHookData", () => {
  it("produces non-empty bytes", () => {
    const session: SignedSession = {
      token: {
        user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
        chainId: CHAIN_ID, verifyingHook: HOOK, poolId: POOL_ID,
        action: 1, deadline: 9999999999n, nonce: `0x${"00".repeat(32)}`,
      },
      signature: FAKE_SIG,
    };
    const encoded = encodeHookData(session);
    expect(encoded.startsWith("0x")).toBe(true);
    expect(encoded.length).toBeGreaterThan(2);
  });

  it("round-trips through ABI decode", () => {
    const token = {
      user:             USER       as `0x${string}`,
      authorizedCaller: CALLER     as `0x${string}`,
      cnfIssuer:        ISSUER     as `0x${string}`,
      chainId:          CHAIN_ID,
      verifyingHook:    HOOK       as `0x${string}`,
      poolId:           POOL_ID    as `0x${string}`,
      action:           1,
      deadline:         9999999999n,
      nonce:            `0x${"0a".repeat(32)}` as `0x${string}`,
    };
    const session: SignedSession = { token, signature: FAKE_SIG };
    const encoded = encodeHookData(session);

    const [decodedToken, decodedSig] = decodeAbiParameters(SESSION_TOKEN_ABI, encoded);
    expect(decodedToken.user.toLowerCase()).toBe(USER.toLowerCase());
    expect(decodedToken.authorizedCaller.toLowerCase()).toBe(CALLER.toLowerCase());
    expect(decodedToken.cnfIssuer.toLowerCase()).toBe(ISSUER.toLowerCase());
    expect(decodedToken.chainId).toBe(CHAIN_ID);
    expect(decodedToken.action).toBe(1);
    expect(decodedToken.deadline).toBe(9999999999n);
    expect(decodedSig.toLowerCase()).toBe(FAKE_SIG.toLowerCase());
  });

  it("different sessions produce different bytes", () => {
    const mkSession = (action: number): SignedSession => ({
      token: {
        user: USER, authorizedCaller: CALLER, cnfIssuer: ISSUER,
        chainId: CHAIN_ID, verifyingHook: HOOK, poolId: POOL_ID,
        action, deadline: 9999999999n, nonce: `0x${"00".repeat(32)}`,
      },
      signature: FAKE_SIG,
    });
    expect(encodeHookData(mkSession(1))).not.toBe(encodeHookData(mkSession(2)));
  });
});

const SESSION_TOKEN_V2_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, uint256 policyHash, uint64 policyRevision, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

describe("signSessionV2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  it("binds the current policy commitment and revision", async () => {
    const wallet = makeMockWallet();
    const result = await signSessionV2(wallet as any, {
      user: USER,
      authorizedCaller: CALLER,
      policyHash: 123456n,
      policyRevision: 7n,
      poolId: POOL_ID,
      action: "swap",
      verifyingHook: HOOK,
      chainId: CHAIN_ID,
    });

    expect(result.token.policyHash).toBe(123456n);
    expect(result.token.policyRevision).toBe(7n);
    expect(result.token.action).toBe(ACTION_CODES.swap);
    const call = wallet.signTypedData.mock.calls[0]![0];
    expect(call.domain.version).toBe("2");
    expect(call.primaryType).toBe("SessionTokenV2");
  });

  it("encodes a v2 hookData payload with the stable user/caller prefix", async () => {
    const wallet = makeMockWallet();
    const session = await signSessionV2(wallet as any, {
      user: USER,
      authorizedCaller: CALLER,
      policyHash: 99n,
      policyRevision: 3n,
      poolId: POOL_ID,
      action: "addLiquidity",
      verifyingHook: HOOK,
      chainId: CHAIN_ID,
    });

    const encoded = encodeHookDataV2(session);
    const [token, signature] = decodeAbiParameters(SESSION_TOKEN_V2_ABI, encoded);
    expect(token.user.toLowerCase()).toBe(USER.toLowerCase());
    expect(token.authorizedCaller.toLowerCase()).toBe(CALLER.toLowerCase());
    expect(token.policyHash).toBe(99n);
    expect(token.policyRevision).toBe(3n);
    expect(token.action).toBe(ACTION_CODES.addLiquidity);
    expect(signature).toBe(FAKE_SIG);
  });

  it("produces distinct nonces for distinct authorizations", async () => {
    const wallet = makeMockWallet();
    const params = {
      user: USER,
      authorizedCaller: CALLER,
      policyHash: 1n,
      policyRevision: 1n,
      poolId: POOL_ID,
      action: "swap" as const,
      verifyingHook: HOOK,
      chainId: CHAIN_ID,
    };
    const first: SignedSessionV2 = await signSessionV2(wallet as any, params);
    const second: SignedSessionV2 = await signSessionV2(wallet as any, params);
    expect(first.token.nonce).not.toBe(second.token.nonce);
  });
});
