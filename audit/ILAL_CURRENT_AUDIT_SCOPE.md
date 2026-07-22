# ILAL Current Audit Scope

Date: 2026-07-22

This document supersedes the older `v0.2.5` filenames as the current reviewer entry point. Older reports and v0.3.2 chain transactions are retained as historical evidence, not as an active deployment or current production-readiness claim. This scope covers the local `v0.3.3-rc.3` candidate.

## Scope Summary

| Area | In scope | Current status |
|---|---|---|
| Hook enforcement | `contracts/src/ComplianceHook.sol` | In scope |
| CNF credential issuer | `contracts/src/CNFIssuer.sol` | In scope |
| Router / v4 settlement | `contracts/src/ILALRouter.sol` | In scope |
| Pool policy registry | `contracts/src/PolicyRegistry.sol` | In scope |
| Session signing library | `contracts/src/libraries/SessionLib.sol` | In scope |
| Groth16 adapter | `contracts/src/verifier/Groth16VerifierAdapter.sol` | In scope |
| Generated verifier | `contracts/src/verifier/ILALVerifier.sol` | Review as generated verifier artifact |
| CLI integration | `cli/src` | Integration / operational review |
| SDK integration | `sdk/src` | Integration review |
| Circuit | `circuits/ilal.circom` | Design review; production ceremony not complete |
| Policy circuit v2 | `circuits/v2/ilal_policy.circom` | Isolated source candidate; constraint-tested, not deployed |
| Policy grant v2 | `contracts/src/v2` | Isolated prototype; not connected to the current Hook |

## Current Release Linkage

See `../RELEASE.md` for the release matrix:

- CLI source: `@ilalv3/cli@0.3.3-rc.3` (not published to npm)
- npm stable: `@ilalv3/cli@0.3.2` (deprecated)
- npm legacy: `@ilalv3/cli@0.2.21` (old Router ABI)
- SDK: `@ilalv3/sdk@0.2.0`
- Circuits: `@ilal/circuits@0.1.0`
- Proving artifacts: `@ilalv3/proving-artifacts@0.1.0`
- Active deployment: none; next demo target is Base Sepolia

## Verified Local Results

Latest local verification:

```bash
make verify
```

Expected current results:

- Solidity tests: `188 passed, 0 failed, 0 skipped`; fuzz runs `256`
- CLI tests: baseline `19`; current candidate includes additional signer/Safe tests and must remain above baseline
- SDK tests: `15 passed, 0 failed`
- Oracle validation tests: `7 passed, 0 failed`
- Policy circuit v2: valid witness accepted; 4 adversarial witnesses rejected
- CLI build: pass
- CLI audit: `0 vulnerabilities`
- SDK tests: `15 passed, 0 failed`
- SDK audit: `0 vulnerabilities`
- Circuit production dependency audit: `0 vulnerabilities`
- Circuit full development toolchain: `21 advisories` (offline build scope)

## Security Properties To Review

| Property | Current defense |
|---|---|
| Unauthorized hook calls | `onlyPoolManager` on active hook methods |
| Router bypass | `authorizedRouter` immutable and session caller binding |
| Session forgery | EIP-712 digest, low-s ECDSA, ERC-1271 fallback |
| Session replay | Permit2-style nonce bitmap |
| Cross-chain replay | `chainId` in signed session token |
| Cross-pool replay | `poolId` in signed session token |
| Cross-action replay | `action` in signed session token |
| Stolen hookData use | Router requires `token.user == msg.sender` |
| Invalid credential | Hook checks `CNFIssuer.isValid(user)` |
| Wrong credential type | Hook checks `credentialType == policy.requiredCredentialType` |
| CNF transfer | ERC-721 approvals and transfers revert |
| Revocation bypass | Permanent ban blocks renewals |
| Verifier/root compromise | ZK verifier and Merkle root updates are timelocked |
| Slippage | Router `minAmountOut` guard |
| Protocol fee abuse | Protocol fee capped at `0.10%` |
| Cross-user LP position access | Router scopes every liquidity salt to the signed caller |
| Principal trapped after revocation | Remove-liquidity is an ownership-only exit path independent of mutable credential/policy state |

## Mainnet Open Items

These items block production capital and any production-readiness claim:

1. Formal third-party audit.
2. Safe ownership, independent admin/treasury configuration, complete role handoff, and operational runbooks.
3. Real KYC/KYB issuer or attester integration.
4. Production trusted setup or equivalent reviewed verifier artifact process.
5. Published artifact hashes for zkey, verification key, Solidity verifier, and deployed bytecode.
6. Monitoring for verifier/root proposals, policy changes, revocations, failed swaps, and pool price/liquidity health.
7. Expanded router settlement tests for non-standard ERC-20 behavior and edge cases.
8. Decide whether v2 policy grants enter the production scope. If they do,
   integrate them through a versioned Hook and audit the complete path.

## ZK Trusted Setup Status

The current v1 circuit is suitable for demo and controlled PoC review. The
isolated v2 policy circuit has constraint tests but no production proving key or
deployed verifier. The development compile script explicitly blocks a known
development beacon unless the unsafe local override is supplied.

Auditors should treat the current proving setup as:

```text
demo / PoC artifact: yes
production trusted setup: no
```

Production deployment must replace this with a reviewed ceremony, a published verifier artifact hash set, or another auditor-approved proving artifact process.

## Toolchain Dependency Status

The CLI, SDK, and circuit production dependency sets audit clean at the time of
this report. The full `circuits/` development build tree reports 21 advisories
through offline proving dependencies. That toolchain is not part of the runtime
protocol path, but it must be pinned, reviewed, isolated from signing keys, and
restricted from unnecessary network access before production artifact
distribution.
