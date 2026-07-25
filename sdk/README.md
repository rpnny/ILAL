# @ilalv3/sdk

**ILAL Protocol SDK** — session signing and hookData encoding for Uniswap v4 compliance pools.

ILAL gates swaps and liquidity operations behind on-chain compliance credentials (CNF tokens). This SDK handles the off-chain signing step: build a short-lived EIP-712 session token, sign it locally, and encode it into the `hookData` blob that `ComplianceHook` verifies on every action.

## Install

```bash
npm install @ilalv3/sdk viem
```

## Quick start

```ts
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { signSession, encodeHookData, getCredentialStatus } from "@ilalv3/sdk";

const account = privateKeyToAccount("0x...");
const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() });
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });

// 1. Check if the user has a valid compliance credential
const status = await getCredentialStatus(publicClient, CNF_ISSUER, account.address);
if (!status.valid) throw new Error("No valid CNF credential — mint or renew first");

// 2. Sign a 10-minute session token (zero gas, fully local)
const session = await signSession(walletClient, {
  user:             account.address,
  authorizedCaller: ILAL_ROUTER,   // only ILALRouter can submit this session
  cnfIssuer:        CNF_ISSUER,
  poolId:           POOL_ID,
  action:           "swap",
  verifyingHook:    COMPLIANCE_HOOK,
  chainId:          BigInt(baseSepolia.id),
});

// 3. Encode into hookData and pass to ILALRouter.swap()
const hookData = encodeHookData(session);
```

## API

### `signSession(walletClient, params)` → `Promise<SignedSession>`

Signs an EIP-712 `SessionToken` locally. No on-chain call.

| Param | Type | Description |
|---|---|---|
| `user` | `Address` | Wallet that will trade |
| `authorizedCaller` | `Address` | Contract allowed to submit the session (use `ILALRouter` address) |
| `cnfIssuer` | `Address` | The `CNFIssuer` contract for this pool |
| `poolId` | `Hex` | Uniswap v4 pool ID (`bytes32`) |
| `action` | `"swap" \| "addLiquidity" \| "removeLiquidity"` | Must match the on-chain action |
| `verifyingHook` | `Address` | `ComplianceHook` address |
| `chainId` | `bigint` | Chain ID |
| `expiresIn?` | `number` | TTL in seconds (default: 600) |

### `encodeHookData(session)` → `0x${string}`

ABI-encodes a `SignedSession` into the `bytes hookData` expected by `ComplianceHook`.

### `getCredentialStatus(publicClient, cnfIssuer, wallet)` → `Promise<CredentialStatus>`

Reads credential state from the `CNFIssuer` contract.

```ts
interface CredentialStatus {
  exists:    boolean;
  valid:     boolean;   // !revoked && expiresAt > now
  tokenId:   bigint;
  expiresAt: bigint;    // Unix timestamp
  revoked:   boolean;
}
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0x57d6faea0159C95e96D7a6Ed4e3D416701aA9aEF` |
| ComplianceHook | `0x9B894a6fD363CfBA6E8A5876256Fb7698659CA80` |
| ILALRouter | `0x2ccd398F6F60A1d926374a78F25e90E3Bef99A77` |

Pool ID: `0x1a05b49e39c3ed799c4f0f23bb61e647ff9d3c558136f718a2ab2fa87c82d1ad`

These values mirror `deployments/index.json` and the active versioned
manifest. Treat those files as the source of truth when a new deployment is
activated.

## License

Apache-2.0
