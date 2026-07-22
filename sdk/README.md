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
| CNFIssuer | `0xB13AE2498Df62A85768a4b783109C05fCf5A264a` |
| ComplianceHook | `0x6C57b50Ef9286b132066012B19b291FB120ACa80` |
| ILALRouter | `0xd0aF4D1EFF36CB2a1E88017eA398dCaDe1Ac0040` |

Pool ID: `0x16b3e7a5c52216925f705673b3ab25db5e6025da530cf53b3bcb5affeb18d95f`

## License

MIT
