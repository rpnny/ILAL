# ILAL release handoff

## Current npm previews

| Field | Value |
|---|---|
| CLI | `@ilalv3/cli@0.4.0-v2-poc.5` on npm `next` |
| SDK | `@ilalv3/sdk@0.3.0-next.1` on npm `next` |
| Netting | Base Sepolia Hookathon candidate with exact-match source verification |
| V2 | Base Sepolia policy-grant candidate `v0.4.0-v2-poc.1` |
| ZK | Groth16 V2 with an unsafe development ceremony |
| Production | Not production-ready |
| Audit | Unaudited |

The CLI preview adds atomic signed-order netting, residual-only Uniswap v4
routing, nonce cancellation and canonical batch previews alongside the V2
issuer kit. The SDK preview adds v2 policy-bound session signing and encoding.
Neither preview replaces npm `latest` or the active v0.3.3 demo preset.

## Current release

| Field | Value |
|---|---|
| Version | `v0.3.3` |
| Software | Stable |
| Deployment | Active Base Sepolia demo |
| Attestation | MockEAS |
| ZK | Experimental; disabled in public deployment |
| Production | Not production-ready |
| Audit | Unaudited |
| npm | `@ilalv3/cli@0.3.3` stable publication |

The canonical templates are `releases/v0.3.3.json` and `deployments/base-sepolia/v0.3.3.json`. Both record the clean frozen `sourceCommit`. Because a commit cannot contain its own SHA, tracked `releaseCommit` remains `null`; the tag workflow resolves it to the signed tag commit in published release assets. The signed RC tags remain immutable historical candidates.

## Version compatibility

| Artifact | Meaning |
|---|---|
| Local and npm `@ilalv3/cli@0.3.3` | Current signer abstraction, Safe proposal flow, active v0.3.3 preset, bounded execution |
| npm `@ilalv3/cli@next` | Current source preview: netting commands plus isolated V2 issuer/policy tooling |
| npm `@ilalv3/sdk@next` | v1 and v2 session signing and hookData encoding |
| npm `@ilalv3/cli@0.3.2` | Deprecated because its default test stack is unsafe |
| npm `@ilalv3/cli@0.2.21` | Historical old Router ABI; incompatible with current source expectations |

Only v0.3.3 should be described as pointing to the active Base Sepolia demo deployment.

## Verification

```bash
make verify
```

Required baselines:

- Foundry: 229 executed and passed, 0 failed, 0 skipped, fuzz runs at least 256.
- CLI: 53 executed and passed.
- Netting invariants: 6 properties × 256 calls, 0 reverts.
- SDK and circuit constraint suites pass.
- deployment-derived CLI/site data is synchronized.
- package metadata, SPDX policy, release status, npm pack, and local secret scan pass.

## Release separation

`release-rc.yml` creates GitHub prerelease assets and has no npm OIDC
permission. `publish-npm-stable.yml` publishes CLI and SDK stable tags to
`latest` and prerelease tags to `next`; it uses the protected `npm-production`
environment and receives only `contents: read` and `id-token: write`. npm
Trusted Publishing must be bound to `rpnny/ilal`, that workflow, the protected
environment, and the npm publish action.

Ordinary RC publication does not publish npm. A V2 PoC tag may publish only to
`next` when it references the recorded V2 candidate and, when bundled, the
exact-match netting candidate. SDK tags are independently versioned with the
`sdk-v` prefix.

## Remaining production blockers

- The Base Sepolia demo Safe is live; `admin` and `treasury` remain separate manifest fields even though this demo shares one address.
- Fresh encrypted deployment, role handoff, positive/negative swaps, code hashes, and Sourcify exact-match verification are recorded in the v0.3.3 manifest.
- Production use still requires independent audit, production attestation/proving, hardened governance and monitoring.
- npm Trusted Publisher and GitHub protected-environment configuration must be verified before revoking old automation credentials.
- Production remains blocked by independent audit, production ceremony/proving review, governance, monitoring, real attestation integration, incorporation/IP assignment, and customer/legal evidence.

The v0.3.2 Base Sepolia stack is recorded only as deprecated historical evidence in `deployments/base-sepolia/v0.3.2.json`.
