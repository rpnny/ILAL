# Historical protocol records

ILAL now maintains one implementation: Mixed v1. It incorporates CNF/ZK eligibility, session-like grants, SOEE atomic netting and owner-isolated LP operations. Earlier standalone Session, V2 grant and SOEE execution stacks, CLI commands, SDK encoders and demo scripts have been removed from the current checkout.

The complete pre-consolidation source remains available at Git commit `bc0f2e0`:

```bash
git show bc0f2e0:README.md
git worktree add --detach ../ilal-history bc0f2e0
```

Use that checkout to reproduce old tests, benchmarks and demonstrations. Historical documents refer to paths and commands in that revision, not the current development interface.

## Evidence retained

- `deployments/` preserves the original manifests and deployment index. Its historical `active` pointer to v0.3.3 is not the current CLI default; the CLI requires an explicit unified-protocol manifest.
- `releases/` preserves published release metadata. It does not describe the current private development packages.
- `docs/hookathon/`, `docs/research/`, `docs/data-room/` and `audit/` preserve dated research and review evidence.
- `docs/history/proving-artifacts/` preserves the old proving package metadata and verification key; it is not used by the current proof workflow.
- The current implementation and candidate are selected by `protocol.json`. The candidate is not promoted to a stable deployment by this repository consolidation.

## Compatibility

Historical session signatures, orders, grants, nonces and LP positions cannot be replayed into the unified protocol. Existing users must exit through the original deployment, obtain a new grant, approve the new routers and sign new authorizations. See [the migration boundary](mixed/MIGRATION.md).

Solidity names, SDK `Mixed*` names, EIP-712 domains and artifact formats are intentionally retained. `V2` in the shared policy circuit/verifier names denotes circuit version, not a second supported execution protocol.
