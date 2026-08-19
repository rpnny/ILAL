# ILAL Contracts

Solidity smart contracts for the ILAL Protocol — Uniswap v4 compliance hook.

## Contracts

| Contract | Description |
|----------|-------------|
| `netting/InstitutionalNettingHook.sol` | Hookathon core: verifies signed v1-CNF orders, nets stablecoin raw units 1:1 with `beforeSwap` deltas, and permits only residual flow to reach the AMM. Required flags: `0x0088`. |
| `netting/InstitutionalBatchRouter.sol` | Permissionless atomic batch executor. Canonicalizes order/signature pairs by ascending order hash, opens one PoolManager unlock, settles every signer directly, enforces total output, and closes only after Hook accounting cancels. |
| `netting/NettingTypes.sol` | Shared EIP-712 order, batch header, canonical preview and strictly ordered commitment logic. |
| `ILALRouter.sol` | Executes bounded swaps and liquidity changes through the Uniswap v4 unlock/settlement flow and charges the immutable protocol fee on actual swap input. |
| `CNFIssuer.sol` | Soulbound ERC-721 compliance credential. EAS credentials track their source attestation; ZK credentials are bound to the active Merkle root and the hardened seven-signal circuit revision. |
| `ComplianceHook.sol` | Uniswap v4 `IHooks` implementation. Gates `beforeSwap`, `beforeAddLiquidity`, `beforeRemoveLiquidity` behind EIP-712 session tokens. Supports EOA (ECDSA) and smart wallets (ERC-1271). Nonce bitmap prevents session replay. |
| `PolicyRegistry.sol` | Maps each pool ID to a compliance policy. Self-service operators are stored separately from CNFIssuer contracts and must remain the contract's current `owner()`. |
| `libraries/SessionLib.sol` | EIP-712 session token struct, digest, and signature recovery. |
| `libraries/HookMiner.sol` | CREATE2 salt mining — finds a salt such that the deployed hook address has the required LSB flags set (Uniswap v4 requirement). |
| `verifier/Groth16VerifierAdapter.sol` | Bridges the domain-bound snarkjs verifier (fixed-size `uint[7]` array) to `IGroth16Verifier` (dynamic `uint[]`). |
| `v2/EligibilityPolicyRegistryV2.sol` | Isolated v2 prototype: versioned per-pool private eligibility policy. Not part of the active deployment. |
| `v2/PolicyGrantManagerV2.sol` | Isolated v2 prototype: verifies once and caches a bounded per-wallet/per-pool grant. |
| `v2/ComplianceHookV2.sol` | Isolated v2 Hook: validates revision-bound sessions against cached policy grants. |
| `v2/Groth16VerifierAdapterV2.sol` | Fixed-nine-signal adapter for the isolated v2 policy circuit. |

## Tests

```bash
cd contracts
forge test --summary
```

```
╭────────────────────┬────────┬────────┬─────────╮
│ Test Suite         │ Passed │ Failed │ Skipped │
╞════════════════════╪════════╪════════╪═════════╡
│ CNFIssuerTest      │ 62     │ 0      │ 0       │
│ ComplianceHookTest │ 30     │ 0      │ 0       │
│ ComplianceHookV2   │ 21     │ 0      │ 0       │
│ FuzzCNFIssuer      │ 9      │ 0      │ 0       │
│ Groth16AdapterV2   │ 4      │ 0      │ 0       │
│ ILALRouterTest     │ 33     │ 0      │ 0       │
│ PolicyGrantV2      │ 15     │ 0      │ 0       │
│ PolicyRegistryTest │ 24     │ 0      │ 0       │
│ Netting integration│ 24     │ 0      │ 0       │
│ Netting invariants │ 6      │ 0      │ 0       │
│ MockEAS deployment │ 1      │ 0      │ 0       │
╰────────────────────┴────────┴────────┴─────────╯
```

Current total: `229 passed, 0 failed, 0 skipped`.

Each netting invariant runs 256 handler calls over 3–16 order batches and covers
cumulative accounting, one-sided residuals, closed batch context, replay
protection, zero Hook/Router inventory, and Token conservation. The integration
suite also compares `100/70` against a vanilla 30-token0 residual pool state;
the maximum 16-order case is gas-tested.

The checked-in v1 verifier is generated with the explicitly unsafe development
beacon for deterministic repository testing only. Before any deployment, run a
reviewed Phase-2 ceremony, regenerate `ILALVerifier.sol`, and publish the R1CS,
zkey, verifier, and artifact hashes. Legacy six-signal proving artifacts are
incompatible with `CNFIssuer` and are not downloaded by the CLI.

## Deployment

The Hookathon candidate uses the dedicated Base Sepolia script:

```bash
forge script script/DeployHookathonNetting.s.sol:DeployHookathonNetting \
  --rpc-url https://base-sepolia-rpc.publicnode.com --broadcast -vv
```

It uses the official PoolManager/PositionManager/Permit2 stack, mines the
Hook's exact `0x0088` address flags, onboards two independent CNFs, and seeds
liquidity through the standard PositionManager. See
[`../docs/HOOKATHON_NETTING.md`](../docs/HOOKATHON_NETTING.md).

The supported deployment path uses the CLI with an encrypted Web3 v3
keystore. A Base Sepolia MockEAS rehearsal looks like:

```bash
node cli/dist/index.js \
  --keystore ./fresh-deployer.json \
  --password-file ./deployer.password \
  deploy \
  --chain 84532 \
  --mock \
  --admin 0xAdminSafe \
  --treasury 0xTreasury \
  --wallet-to-seed 0xDemoTrader
```

Run this command from the repository root after building the CLI. See
[`../DEMO.md`](../DEMO.md) for the complete testnet flow and evidence
requirements.

For production ownership, emergency disablement, Router event interpretation,
and immutable-Hook pool migration, see
[`../docs/INCIDENT_AND_MIGRATION_RUNBOOK.md`](../docs/INCIDENT_AND_MIGRATION_RUNBOOK.md).

The repository is unaudited and not production-ready. Mainnet deployment is
outside the current supported scope.

## Hook address flags

The `ComplianceHook` must be deployed at an address where specific bits are set in the lower 20 bits (Uniswap v4 requirement):

```
beforeSwap            → bit 7  (0x0080)
beforeAddLiquidity    → bit 11 (0x0800)
beforeRemoveLiquidity → bit 9  (0x0200)
Required mask: 0x0A80
```

`HookMiner.find()` iterates CREATE2 salts until it finds one that produces an address satisfying this constraint.

The Hookathon `InstitutionalNettingHook` enables only:

```text
beforeSwap               → bit 7 (0x0080)
beforeSwap returns delta → bit 3 (0x0008)
Required mask: 0x0088
```
