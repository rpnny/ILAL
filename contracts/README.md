# ILAL Contracts

Solidity smart contracts for the ILAL Protocol — Uniswap v4 compliance hook.

## Contracts

| Contract | Description |
|----------|-------------|
| `CNFIssuer.sol` | Soulbound ERC-721 compliance credential. Two mint paths: Coinbase EAS attestation (MVP A) and Groth16 ZK proof (MVP B). |
| `ComplianceHook.sol` | Uniswap v4 `IHooks` implementation. Gates `beforeSwap`, `beforeAddLiquidity`, `beforeRemoveLiquidity` behind EIP-712 session tokens. Supports EOA (ECDSA) and smart wallets (ERC-1271). Nonce bitmap prevents session replay. |
| `PolicyRegistry.sol` | Maps each pool ID to a compliance policy (issuer contract + required credential type). Pool operators set their own policy. |
| `libraries/SessionLib.sol` | EIP-712 session token struct, digest, and signature recovery. |
| `libraries/HookMiner.sol` | CREATE2 salt mining — finds a salt such that the deployed hook address has the required LSB flags set (Uniswap v4 requirement). |
| `verifier/Groth16VerifierAdapter.sol` | Bridges the snarkjs-generated verifier (fixed-size `uint[6]` array) to `IGroth16Verifier` (dynamic `uint[]`). |
| `v2/EligibilityPolicyRegistryV2.sol` | Isolated v2 prototype: versioned per-pool private eligibility policy. Not connected to the current Hook. |
| `v2/PolicyGrantManagerV2.sol` | Isolated v2 prototype: verifies once and caches a bounded per-wallet/per-pool grant. |
| `v2/Groth16VerifierAdapterV2.sol` | Fixed-nine-signal adapter for the isolated v2 policy circuit. |

## Tests

```bash
forge test --summary
```

```
╭────────────────────┬────────┬────────┬─────────╮
│ Test Suite         │ Passed │ Failed │ Skipped │
╞════════════════════╪════════╪════════╪═════════╡
│ CNFIssuerTest      │ 59     │ 0      │ 0       │
│ ComplianceHookTest │ 29     │ 0      │ 0       │
│ FuzzCNFIssuer      │ 9      │ 0      │ 0       │
│ Groth16AdapterV2   │ 4      │ 0      │ 0       │
│ ILALRouterTest     │ 28     │ 0      │ 0       │
│ PolicyGrantV2      │ 15     │ 0      │ 0       │
│ PolicyRegistryTest │ 20     │ 0      │ 0       │
╰────────────────────┴────────┴────────┴─────────╯
```

## Deploy

**Testnet (Base Sepolia, MockEAS):**
```bash
POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 \
WALLET_TO_SEED=0xYourWallet \
PRIVATE_KEY=0x... \
forge script script/DeployMock.s.sol \
  --rpc-url https://sepolia.base.org \
  --broadcast --slow
```

**Mainnet (Base, Coinbase EAS):**
```bash
EAS_ADDRESS=0x4200000000000000000000000000000000000021 \
SCHEMA_UID=0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9 \
TRUSTED_ATTESTER=0x357458739F90461b99789350868CD7CF330Dd7EE \
POOL_MANAGER=0x498581ff718922c3f8e6a244956af099b2652b2b \
ADMIN=0xYourSafe \
PRIVATE_KEY=0x... \
forge script script/Deploy.s.sol \
  --rpc-url https://mainnet.base.org \
  --broadcast --verify --slow
```

`ADMIN` is optional for development but required operationally for production.
When provided, the script transfers both `CNFIssuer` and `PolicyRegistry`
ownership to that Safe before the deployment broadcast completes.

## Hook address flags

The `ComplianceHook` must be deployed at an address where specific bits are set in the lower 20 bits (Uniswap v4 requirement):

```
beforeSwap            → bit 7  (0x0080)
beforeAddLiquidity    → bit 11 (0x0800)
beforeRemoveLiquidity → bit 9  (0x0200)
Required mask: 0x0A80
```

`HookMiner.find()` iterates CREATE2 salts until it finds one that produces an address satisfying this constraint.
