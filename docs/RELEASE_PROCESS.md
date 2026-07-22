# Release process

## History and repository gate

The legacy CLI repository is backed up outside this repository as a complete Git bundle, working-tree archive, binary-safe tracked patch, and checksum file. CLI `main` history was imported into `cli/` without squash and legacy tags were namespaced `cli-v*`.

Do not remove `cli/.git` or archive the legacy repository until all of these are true:

1. Bundle and working-tree restore checks pass.
2. The monorepo can reach the old CLI HEAD and historical tags.
3. Public monorepo CI is green.
4. `v0.3.3-rc.1` is public and reproducibly cloneable.
5. npm repository metadata has been verified against the monorepo.

An ignored in-repository directory is never the sole backup.

## RC

1. Run `make verify` from a clean tree.
2. Confirm no active deployment is selected and v0.3.2 is marked deprecated.
3. Freeze the RC source commit and populate the release manifest honestly.
4. Tag `v0.3.3-rc.1` at the reviewed release commit.
5. Let `release-rc.yml` create a GitHub prerelease with checksums, SBOM, test evidence, release/deployment status, and proving provenance.
6. Do not publish npm `latest` or `next` from the RC workflow.

## Stable source/deployment/release commits

1. Freeze a clean `sourceCommit`.
2. Build and deploy from only that commit using a fresh encrypted keystore deployer and a supplied Base Sepolia Safe.
3. Record transactions, blocks, constructor arguments, Pool ID, hashes, role calls, and results.
4. Transfer every applicable privilege. Verify the deployer retains no undeclared role.
5. Commit only evidence and manifests, producing `releaseCommit`.
6. Reject the release if `sourceCommit..releaseCommit` changes `contracts/src`, `contracts/script`, `contracts/foundry.toml`, dependency pins, or lock/build inputs.
7. Sign `v0.3.3` at `releaseCommit`.
8. Build npm, GitHub Release, and website from that same commit.

Git commit identifiers are hashes of their tree and metadata, so a tracked file cannot contain the SHA of the very commit that contains it. Tracked release/deployment templates therefore keep `releaseCommit: null`; the tag workflow deterministically resolves that field to `GITHUB_SHA` in the signed release asset. The tag SHA and published asset are the authoritative linkage. CI rejects a pre-filled or mismatched tracked value.

`admin` and `treasury` are independent fields. A testnet demo may use one Safe for both only when `adminTreasuryShared: true` is explicit.

## npm Trusted Publishing

- Bind the Trusted Publisher to organization `rpnny`, repository `ilal`, workflow `publish-npm-stable.yml`, protected environment `npm-production`, and the allowed npm publish action.
- Stable publication accepts stable `vX.Y.Z` tags only and has `contents: read` plus `id-token: write`.
- PRs, branches, prerelease tags, and the RC workflow cannot publish.
- Tag, CLI package version, release manifest, and active deployment manifest must match.
- Revoke old npm automation tokens only after OIDC publication and provenance are verified.

## Required release labels

Every release states software, deployment, attestation, ZK, production-readiness, and audit status separately. “Stable” describes the software artifact; it does not mean audited or production-ready.
