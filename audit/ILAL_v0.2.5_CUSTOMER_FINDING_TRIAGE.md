# ILAL v0.2.5 Customer Finding Triage

> Historical evidence notice (2026-07-22): addresses and “current deployment” statements below refer to a deprecated test stack. Use the versioned deployment index for the active v0.3.3 Base Sepolia demo.

Date: 2026-05-25  
Scope checked: `/Users/ronny/ilal/contracts/src` current v0.2.5 contracts  
Customer report scope: legacy/v3 or copied contracts referencing `SessionManager`, `Registry.setPlonkVerifier`, UUPS, `tx.origin`, router whitelists, and `_resolveUser()`.

## Summary

The customer report is useful as a legacy-risk checklist, but most findings do not apply to the current v0.2.5 architecture. The current codebase uses:

- `CNFIssuer.sol` for EAS/ZK credential issuance.
- `ComplianceHook.sol` for Uniswap v4 hook gating.
- `PolicyRegistry.sol` for pool policy.
- `ILALRouter.sol` for v4 unlock routing.
- No `tx.origin`.
- No UUPS or proxy upgrade path.
- No router whitelist identity forwarding mode.
- No standalone `SessionManager`.
- No `Registry.setPlonkVerifier` or instant root/verifier setters.

## Finding Triage

| ID | Customer Finding | v0.2.5 Status | Evidence / Current Behavior |
|---|---|---|---|
| C-1 | Whitelisted router can inject arbitrary user via `hookData[0:20]` | Not applicable | Current `ComplianceHook` decodes `(SessionToken, signature)` and requires the `token.user` signature. `ILALRouter._verifySessionBinding()` also requires `token.user == msg.sender` and `token.authorizedCaller == address(router)`. There is no `_resolveUser()` mode and no `isRouterApproved()` whitelist. |
| C-2 | Owner can instantly replace PLONK verifier | Fixed / not applicable | Current verifier lives in `CNFIssuer.zkVerifier`; updates require `proposeZKVerifier()` then `activateZKVerifier()` after `VERIFIER_DELAY = 72 hours`. No `Registry.setPlonkVerifier()` exists. |
| C-3 | Owner can instantly replace Merkle root | Fixed | Current root updates require `proposeMerkleRoot()` then `activateMerkleRoot()` after `ROOT_DELAY = 48 hours`. Constructor can initialize the first root during deployment. |
| H-1 | Single admin key | Open mainnet operational item | Current contracts are `Ownable`. This is acceptable for testnet; mainnet ownership must transfer to a multisig/timelock. Already listed as a mainnet blocker in audit readiness docs. |
| H-2 | `tx.origin` dependency | Not applicable | `rg "tx\\.origin" contracts/src` returns no matches. Current user identity comes from signed `SessionToken.user`, verified by ECDSA or ERC-1271. |
| H-3 | Session remains valid up to 7 days after revocation | Not applicable | Current session has no standalone on-chain active-session state. Every hook action checks live `CNFIssuer.isValid(token.user)` before nonce consumption, so revocation/expiry blocks the next swap/liquidity action immediately. |
| H-4 | UUPS upgrade can replace logic | Not applicable | Current contracts are immutable deployments and do not import `UUPSUpgradeable` or proxy contracts in `contracts/src`. |
| H-5 | EOA can bypass router whitelist and protocol fee | Fixed and redeployed | `ComplianceHook` stores immutable `authorizedRouter` and rejects any PoolManager sender that is not that router with `RouterNotAuthorized`. Sessions must still bind the same `authorizedCaller`, so compliance and protocol-fee routing now share one execution channel. The current Base Sepolia hook returns `authorizedRouter = 0xA571F7f41c8abC19F20ABAe648e26a75fbe1F434`. |
| M-1 | Nullifier storage can reset across UUPS upgrade | Not applicable | No UUPS/proxy storage. Nonce replay protection is stored directly in `ComplianceHook.nonceBitmap`. |
| M-2 | Public `verifySwapPermit` allows nonce DoS | Not applicable | No `EIP712Verifier.verifySwapPermit` contract/function exists in current `contracts/src`. Nonce consumption is internal to `ComplianceHook._useNonce()` after full session, policy, and credential verification. |
| M-3 | Emergency pause is single-point DoS | Not applicable | Current `PolicyRegistry` has per-pool `disablePolicy`, no global `emergencyPause`. Owner can disable a policy; mainnet owner should be multisig/timelock. |
| M-4 | `proofMaxAge` revocation window | Not applicable | No `proofMaxAge` in current contracts. ZK proof public input must include an unexpired `expiresAt`, and minted credential validity is checked live by the hook. |
| M-5 | `beforeRemoveLiquidity` does not check compliance | Intentional design | Removal still requires the correct user, router, pool, action, signature, and fresh nonce, but deliberately skips current policy/CNF validity so revoked users cannot have capital permanently trapped. This is an exit-only ownership path and must be disclosed to issuers. |

## Current Real Mainnet Risks

The report still highlights two real operational themes that remain relevant:

1. **Admin key risk**: `CNFIssuer` and `PolicyRegistry` ownership should move to a Gnosis Safe and/or timelock before mainnet.
2. **Mandatory fee capture policy**: fixed by requiring the hook sender to be the immutable `authorizedRouter`; the current Base Sepolia demo stack has been redeployed with this property.

## Commands Used For Triage

```bash
rg -n "tx\\.origin|_resolveUser|isRouterApproved|setPlonkVerifier|setMerkleRoot|UUPS|upgrade|MAX_SESSION_TTL|verifySwapPermit|emergencyPause|beforeRemoveLiquidity" contracts/src contracts/test cli/src README.md audit -S

rg --files contracts/src | sort

forge test --summary
```

Latest test result: 145 Solidity, 15 CLI security, and 15 SDK tests passed with 0 failures.
