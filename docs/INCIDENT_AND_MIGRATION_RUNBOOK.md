# ILAL Incident and Pool Migration Runbook

This runbook covers the operational consequence of immutable Uniswap v4 Hook
bindings. A deployed pool cannot replace its Hook in place. A material Hook or
Router defect therefore requires a new deployment and, normally, a new pool.

## Production control model

- Registry and issuer ownership must be held by a reviewed Safe multisig, not a
  single EOA.
- Initial policy registration is immediate because it configures a previously
  unused pool ID. Issuer migrations, credential-type changes, and re-enablement
  use `proposePolicyUpdate` followed by `activatePolicyUpdate` after 48 hours.
- `disablePolicy` remains an immediate emergency stop for new swaps and adds.
  It also cancels any pending policy update. Signed removal remains available so
  users can recover principal after expiry, revocation, or shutdown.
- Operators must monitor `PolicyUpdateProposed`, `PolicyUpdateCancelled`,
  `PolicySet`, `PolicyDisabled`, verifier/root proposals, and ownership changes.

## Router and compliance evidence

`ILALRouter.SwapRouted` proves only that the call passed through the Router. It
is not standalone compliance evidence. An indexer must verify all of:

1. The emitted pool ID and Hook address.
2. The exact Router, Hook, Registry, and PoolManager addresses in a signed or
   otherwise authenticated deployment manifest.
3. The matching Hook event (`VerifiedFlowFeeApplied` for v1 or
   `VerifiedPolicyFlowFeeApplied` for v2) in the same transaction.
4. That the pool key actually binds the expected Hook.

## Emergency sequence

1. Record the incident block, affected deployment version, pools, and evidence.
2. Have the Safe call `disablePolicy(poolId)` for every affected pool.
3. Stop front-end and CLI routing to the deployment and mark it `deprecated` in
   the deployment manifest. Do not describe Router events as proof of compliance.
4. Deploy a reviewed Router/Hook/Registry set and create replacement pools.
5. Publish bytecode hashes, constructor arguments, Hook permission bits, policy
   configuration, and the activation time before directing traffic to it.
6. Publish LP withdrawal and migration instructions. Never disable the signed
   `removeLiquidity` escape path merely because credentials or policies changed.
7. Update front-end, CLI, indexers, and monitoring allowlists to the new manifest.
8. Keep the old deployment visible as deprecated until affected LP positions are
   withdrawn or explicitly accounted for.

## V2 policy hash preflight

The v2 circuit constrains `policyHash`, and the grant manager also compares every
public policy field, so a wrong administrator-supplied hash cannot forge a valid
grant. It can deny service by making all genuine proofs fail. The CLI recomputes
the Poseidon commitment and rejects mismatches before Safe proposal or signing;
direct contract callers must perform the same preflight.
