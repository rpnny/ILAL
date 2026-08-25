# ILAL Codebase Guide

This guide is the shortest path from a fresh checkout to the parts of ILAL
that matter for implementation and review. It describes current `main`; the
active public deployment remains `v0.3.3`, while netting and V2 are separately
recorded candidates. Deployment addresses and release status must be read from the manifests,
not copied from historical audit documents.

## Start Here

| Goal | Primary files |
|---|---|
| Understand the active protocol path | `contracts/src/ILALRouter.sol`, `contracts/src/ComplianceHook.sol`, `contracts/src/CNFIssuer.sol`, `contracts/src/PolicyRegistry.sol` |
| Understand atomic netting | `contracts/src/netting/InstitutionalNettingHook.sol`, `contracts/src/netting/InstitutionalBatchRouter.sol`, `contracts/src/oracle/ChainlinkStablecoinOracleGuard.sol`, `docs/HOOKATHON_NETTING.md` |
| Change session authorization | `contracts/src/libraries/SessionLib.sol`, `cli/src/sessionProtocol.ts`, `sdk/src/session.ts`, `sdk/src/encode.ts` |
| Change CLI behavior | `cli/src/index.ts`, then the matching file in `cli/src/commands/` |
| Change the SDK | `sdk/src/index.ts`, `sdk/src/session.ts`, `sdk/src/encode.ts`, `sdk/src/credential.ts` |
| Review ZK behavior | `circuits/ilal.circom`, `circuits/v2/ilal_policy.circom`, verifier adapters under `contracts/src/verifier/` |
| Review the v2 policy-grant design | `contracts/src/v2/`, `circuits/v2/`, `cli/src/commands/policyV2.ts` |
| Inspect active addresses and evidence | `deployments/index.json`, then the active manifest it references |
| Inspect release state | `releases/v0.4.0-v2-poc.7.json`, `releases/v0.3.3.json`, `RELEASE.md` |
| Run the complete local gate | `make verify` |

## Active v1 Execution Path

1. `CNFIssuer` issues one non-transferable credential per wallet from either a
   validated EAS attestation or a Groth16 proof.
2. `PolicyRegistry` maps a Uniswap v4 pool ID to the accepted issuer and
   credential type. Initial registration is immediate; issuer migrations,
   credential-type changes, and re-enablement use a 48-hour propose/activate flow.
3. The user signs a short-lived EIP-712 `SessionToken`. It binds the user,
   authorized router, issuer, chain, hook, pool, action, deadline, and nonce.
4. The user calls `ILALRouter.swap`, `addLiquidity`, or `removeLiquidity` with
   the encoded token and signature in `hookData`.
5. `ILALRouter` binds the session user to `msg.sender`, enters the Uniswap v4
   unlock callback, settles ERC-20 balances, and enforces swap or liquidity
   amount bounds.
6. `ComplianceHook` is called by `PoolManager`. It checks the authorized
   router, all signed bindings, EOA or ERC-1271 signature validity, and nonce
   replay protection.
7. Swap and add-liquidity actions also check the current pool policy and live
   credential. Remove-liquidity intentionally remains available after a policy
   change or credential revocation so principal is not trapped.

The router charges its immutable protocol fee on actual swap input consumed,
not the requested amount. Native ETH pools and exact-output swaps are outside
the current router scope. `SwapRouted` proves routing only, not compliance;
indexers must validate the Hook binding, deployment manifest, and matching Hook
verification event.

## Isolated v2 Path

The v2 source is implemented and constraint-tested, but is not the active
public deployment.

- `EligibilityPolicyRegistryV2` stores revisioned per-pool commitments for the
  issuer, schema, credential root, minimum KYC level, jurisdiction root, and
  maximum grant TTL.
- `ilal_policy.circom` proves wallet membership, sufficient private KYC tier,
  and private country membership while binding the proof to the public policy.
- `PolicyGrantManagerV2` verifies a proof once and caches a short-lived grant
  for a wallet and pool. Its expiry is capped by both the source credential and
  the policy TTL.
- `ComplianceHookV2` replaces live CNF lookup with the cached grant and binds
  sessions to the policy hash and revision.

Policy revision changes, policy disablement, grant expiry, and explicit grant
revocation invalidate existing access. A production ceremony, deployment, and
third-party review remain launch gates.

## Security Invariants

Changes to the protocol path should preserve these properties:

- Active hook callbacks accept calls only from the configured `PoolManager`.
- Sessions are usable only through the immutable authorized router.
- A session cannot move across users, chains, hooks, pools, or actions.
- Every nonce is consumed once through a per-user bitmap.
- EOA signatures remain canonical low-s ECDSA; contract wallets use ERC-1271.
- Router amount limits are checked on-chain, not only in the CLI.
- Every netting batch passes the immutable Chainlink guard and pool-tick guard
  before any nonce or balance mutation; guard rejection is atomic.
- Liquidity position salts remain scoped to the caller.
- Credential revocation is live and permanent in v1.
- ZK credentials are bound to the Merkle root under which they were minted or
  renewed, so an activated root rotation invalidates the prior-root credential.
- The hardened v1 circuit commits issuer and schema into each leaf and rejects
  legacy six-signal proofs through its circuit-version public input.
- ZK verifier, root, and domain changes retain their timelocks.
- Existing v1 policy changes retain their 48-hour propose/activate delay while
  emergency disablement remains immediate.
- Administrative ownership and the router treasury are treated as separate
  roles, even when a testnet demo intentionally assigns one Safe to both.

## Source-of-Truth Order

When documents disagree, use this order:

1. Contract and TypeScript source for behavior.
2. `deployments/index.json` and its active manifest for deployment status,
   addresses, transactions, roles, and bytecode hashes.
3. The release manifest matching the installed package for versions and verified test counts.
4. Root, CLI, SDK, circuit, and contract READMEs for usage guidance.
5. Dated files in `audit/` for historical review context.

Do not copy addresses from older audit one-pagers. The deployment sync and
release validators deliberately enforce the versioned manifests.

## Development Workflow

Run the narrow check while iterating, then the full gate before handoff:

```bash
make contracts-test
make cli-test
make sdk-test
make circuits-test
make verify
```

`make verify` also validates deployment/release metadata, package contents,
Git history, secret scanning, and dependency SBOM generation.

When changing a session struct, update Solidity, CLI, and SDK encoders together
and add a cross-version round-trip regression. When changing a deployed
address or release claim, update the deployment manifest first and regenerate
derived files with `scripts/sync-deployments.mjs`.
