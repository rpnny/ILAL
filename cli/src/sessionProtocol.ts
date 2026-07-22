import {
  decodeAbiParameters,
  encodeAbiParameters,
  hashTypedData,
  parseAbiParameters,
  recoverTypedDataAddress,
  type Address,
  type Account,
  type Hex,
  type WalletClient,
} from "viem";

export type ProtocolVersion = "1" | "2";

export const SESSION_TOKEN_V1_TYPE = [
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

export const SESSION_TOKEN_V2_TYPE = [
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

const HOOK_DATA_V1_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, address cnfIssuer, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

const HOOK_DATA_V2_ABI = parseAbiParameters([
  "(address user, address authorizedCaller, uint256 policyHash, uint64 policyRevision, uint256 chainId, address verifyingHook, bytes32 poolId, uint8 action, uint64 deadline, bytes32 nonce) token",
  "bytes signature",
]);

export type SessionTokenV1 = {
  user: Address;
  authorizedCaller: Address;
  cnfIssuer: Address;
  chainId: bigint;
  verifyingHook: Address;
  poolId: Hex;
  action: number;
  deadline: bigint;
  nonce: Hex;
};

export type SessionTokenV2 = {
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
};

export type SessionToken = SessionTokenV1 | SessionTokenV2;

export function encodeSessionAuthorization(token: SessionToken, signature: Hex, version: ProtocolVersion): Hex {
  return version === "1"
    ? encodeAbiParameters(HOOK_DATA_V1_ABI, [token as SessionTokenV1, signature])
    : encodeAbiParameters(HOOK_DATA_V2_ABI, [token as SessionTokenV2, signature]);
}

export function protocolVersion(value?: string): ProtocolVersion {
  if (value === undefined || value === "1") return "1";
  if (value === "2") return "2";
  throw new Error(`Unsupported protocol version: ${value}. Use 1 or 2.`);
}

function randomNonce(): Hex {
  return `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}`;
}

export async function signSessionAuthorization(params: {
  walletClient: WalletClient;
  account: Account;
  version: ProtocolVersion;
  authorizedCaller: Address;
  issuer?: Address;
  policyHash?: bigint;
  policyRevision?: bigint;
  chainId: bigint;
  hook: Address;
  poolId: Hex;
  action: number;
  ttl: number;
}): Promise<{ token: SessionToken; signature: Hex; hookData: Hex }> {
  const common = {
    user: params.account.address,
    authorizedCaller: params.authorizedCaller,
    chainId: params.chainId,
    verifyingHook: params.hook,
    poolId: params.poolId,
    action: params.action,
    deadline: BigInt(Math.floor(Date.now() / 1000) + params.ttl),
    nonce: randomNonce(),
  };

  if (params.version === "1") {
    if (!params.issuer) throw new Error("v1 session signing requires a CNFIssuer address");
    const token: SessionTokenV1 = { ...common, cnfIssuer: params.issuer };
    const signature = await params.walletClient.signTypedData({
      account: params.account,
      domain: {
        name: "ILAL ComplianceHook",
        version: "1",
        chainId: params.chainId,
        verifyingContract: params.hook,
      },
      types: { SessionToken: SESSION_TOKEN_V1_TYPE },
      primaryType: "SessionToken",
      message: token,
    });
    return {
      token,
      signature,
      hookData: encodeSessionAuthorization(token, signature, "1"),
    };
  }

  if (params.policyHash === undefined || params.policyRevision === undefined) {
    throw new Error("v2 session signing requires policyHash and policyRevision");
  }
  const token: SessionTokenV2 = {
    ...common,
    policyHash: params.policyHash,
    policyRevision: params.policyRevision,
  };
  const signature = await params.walletClient.signTypedData({
    account: params.account,
    domain: {
      name: "ILAL ComplianceHook",
      version: "2",
      chainId: params.chainId,
      verifyingContract: params.hook,
    },
    types: { SessionTokenV2: SESSION_TOKEN_V2_TYPE },
    primaryType: "SessionTokenV2",
    message: token,
  });
  return {
    token,
    signature,
    hookData: encodeSessionAuthorization(token, signature, "2"),
  };
}

export function decodeSessionAuthorization(hookData: Hex, version: ProtocolVersion): {
  token: SessionToken;
  signature: Hex;
} {
  if (version === "1") {
    const [token, signature] = decodeAbiParameters(HOOK_DATA_V1_ABI, hookData);
    return { token: token as SessionTokenV1, signature };
  }
  const [token, signature] = decodeAbiParameters(HOOK_DATA_V2_ABI, hookData);
  return { token: token as SessionTokenV2, signature };
}

export async function recoverSessionAuthorization(params: {
  token: SessionToken;
  signature: Hex;
  version: ProtocolVersion;
  hook: Address;
  chainId: bigint;
}): Promise<Address> {
  if (params.version === "1") {
    return recoverTypedDataAddress({
      domain: {
        name: "ILAL ComplianceHook",
        version: "1",
        chainId: params.chainId,
        verifyingContract: params.hook,
      },
      types: { SessionToken: SESSION_TOKEN_V1_TYPE },
      primaryType: "SessionToken",
      message: params.token as SessionTokenV1,
      signature: params.signature,
    });
  }
  return recoverTypedDataAddress({
    domain: {
      name: "ILAL ComplianceHook",
      version: "2",
      chainId: params.chainId,
      verifyingContract: params.hook,
    },
    types: { SessionTokenV2: SESSION_TOKEN_V2_TYPE },
    primaryType: "SessionTokenV2",
    message: params.token as SessionTokenV2,
    signature: params.signature,
  });
}

export function hashSessionAuthorization(params: {
  token: SessionToken;
  version: ProtocolVersion;
  hook: Address;
  chainId: bigint;
}): Hex {
  if (params.version === "1") {
    return hashTypedData({
      domain: {
        name: "ILAL ComplianceHook",
        version: "1",
        chainId: params.chainId,
        verifyingContract: params.hook,
      },
      types: { SessionToken: SESSION_TOKEN_V1_TYPE },
      primaryType: "SessionToken",
      message: params.token as SessionTokenV1,
    });
  }
  return hashTypedData({
    domain: {
      name: "ILAL ComplianceHook",
      version: "2",
      chainId: params.chainId,
      verifyingContract: params.hook,
    },
    types: { SessionTokenV2: SESSION_TOKEN_V2_TYPE },
    primaryType: "SessionTokenV2",
    message: params.token as SessionTokenV2,
  });
}
