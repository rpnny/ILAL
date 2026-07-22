# ILAL release handoff

## Current candidate

| Field | Value |
|---|---|
| Version | `v0.3.3-rc.3` |
| Software | Release candidate |
| Deployment | No active v0.3.3 deployment |
| Attestation | MockEAS planned for Base Sepolia demo |
| ZK | Experimental; disabled in public deployment |
| Production | Not production-ready |
| Audit | Unaudited |
| npm | RC is not published to `latest` or `next` |

The canonical machine-readable template is `releases/v0.3.3-rc.3.json`. It records the clean frozen `sourceCommit`. Because a commit cannot contain its own SHA, tracked `releaseCommit` remains `null`; the tag workflow resolves it to the signed tag commit in the published release asset. Neither value may be guessed or derived from a dirty tree. `v0.3.3-rc.1` remains an unpublished failed candidate after invalid Action and dependency references were exposed. `v0.3.3-rc.2` remains a published diagnostic candidate whose tag-level check exposed a detached-HEAD assumption. Neither signed tag is rewritten; RC3 supersedes both.

## Version compatibility

| Artifact | Meaning |
|---|---|
| Local `cli/` source `0.3.3-rc.3` | New signer abstraction, Safe proposal flow, deprecated preset removal, bounded execution |
| npm `@ilalv3/cli@0.3.2` | Published stable but deprecated because its default test stack is unsafe |
| npm `@ilalv3/cli@0.2.21` | Historical old Router ABI; incompatible with current source expectations |

No published CLI version should be described as pointing to an active ILAL deployment today.

## Verification

```bash
make verify
```

Required baselines:

- Foundry: at least 188 executed and passed, 0 failed, 0 skipped, fuzz runs at least 256.
- CLI: at least 19 executed and passed; signer/Safe additions raise the current total above the baseline.
- SDK and circuit constraint suites pass.
- deployment-derived CLI/site data is synchronized.
- package metadata, SPDX policy, release status, npm pack, and local secret scan pass.

## Release separation

`release-rc.yml` creates only a GitHub prerelease and has no npm OIDC permission. `publish-npm-stable.yml` accepts only a stable semver tag, uses the protected `npm-production` environment, and receives only `contents: read` and `id-token: write`. npm Trusted Publishing must be bound to `rpnny/ilal`, that workflow, the protected environment, and the npm publish action.

RC publication does not authorize deployment, npm publication, website activation, legacy-repository archival, or secret rotation through external systems. Those are separate gates in `docs/RELEASE_PROCESS.md`.

## Stable blockers

- A new Base Sepolia Safe is required; `admin` and `treasury` remain separate manifest fields even if the demo shares one address.
- Fresh encrypted deployer, verified role handoff, explorer verification, positive/negative swaps, and code hashes are required.
- Deployment evidence must be committed without changing frozen contract source or build inputs.
- npm Trusted Publisher and GitHub protected-environment configuration must be verified before revoking old automation credentials.
- Production remains blocked by independent audit, production ceremony/proving review, governance, monitoring, real attestation integration, incorporation/IP assignment, and customer/legal evidence.

The v0.3.2 Base Sepolia stack is recorded only as deprecated historical evidence in `deployments/base-sepolia/v0.3.2.json`.
