# ILAL Circuit v2 Eligibility Policy Specification

Date: 2026-07-21  
Status: implemented as an isolated circuit candidate; not deployed

## Problem

The v1 circuit proves membership in an issuer-curated Merkle tree and keeps the
wallet's KYC tier and country private. It does not prove a pool-specific minimum
KYC tier or allowed jurisdiction. Its public `issuerHash` and `schemaHash` are
checked by `CNFIssuer`, but they are not constrained by the v1 circuit itself.
If two issuers use the same verifier and credential root, that weakens proof
domain separation.

## v2 Security Properties

The candidate in `circuits/v2/ilal_policy.circom` adds:

1. Issuer/schema-bound credential leaves.
2. A private KYC tier constrained against a public pool minimum.
3. A private country constrained by membership in a public jurisdiction root.
4. A circuit-constrained policy commitment over version, issuer, schema,
   credential root, minimum tier, and jurisdiction root.
5. An explicit circuit version public signal.

The wallet hash and expiry retain the v1 semantics. Expiry freshness remains an
on-chain check against `block.timestamp`; the circuit only requires a positive
timestamp.

## Privacy Boundary

The following values remain private witness data:

- wallet address preimage;
- exact KYC tier;
- exact country code;
- credential-tree path;
- jurisdiction-tree path.

The pool policy itself is public: minimum tier and the jurisdiction-set root.
An issuer may separately publish the allowed-country list for auditability, but
the proof does not reveal which member applies to a wallet.

## Required On-chain Migration

The v2 circuit is deliberately not wired into the current v1 contracts. A pool
policy cannot be safely enforced by the existing generic, one-per-wallet CNF:
the mint call has no target pool, and a wallet may need grants for multiple
policies. The correct integration is a per-wallet/per-pool policy grant.

The isolated reference implementation is:

- `contracts/src/v2/EligibilityPolicyRegistryV2.sol`
- `contracts/src/v2/PolicyGrantManagerV2.sol`
- `contracts/src/v2/Groth16VerifierAdapterV2.sol`

`activatePolicyGrant(poolId, proof, publicInputs)` verifies the nine-signal
proof once and stores a short-lived grant. A future v2 Hook reads that cached
grant on each action instead of repeating Groth16 verification. The activation
path checks all of the following before calling the verifier:

```text
walletHash == keccak256(msg.sender) >> 4
issuerHash == configured issuer hash
schemaHash == configured schema hash
credentialRoot == configured issuer root
policyHash == pool policy commitment
circuitVersion == 2
expiresAt > block.timestamp
```

The stored grant is capped by both source expiry and the pool's `maxGrantTTL`.
Policy updates increment a revision and invalidate every prior grant. A
wallet-specific revocation blocks reactivation under that same revision, while
a reviewed policy/root revision permits a fresh proof.

Do not upgrade the current six-signal adapter in place. The remaining work is a
versioned Hook integration, production verifier generation, independent review,
and a production Phase-2 ceremony before any pool migration.

## Verified Negative Cases

`npm run test:v2` compiles the circuit and verifies that witness generation
fails for:

- KYC tier below the pool minimum;
- country outside the jurisdiction set;
- cross-issuer domain mutation;
- policy commitment mutation.

These are constraint tests, not a cryptographic ceremony, Solidity audit, or
production deployment.

The isolated Solidity grant path adds 19 regression tests covering exact input
binding, source/TTL expiry caps, verifier failure, policy revision invalidation,
policy disablement, per-wallet revocation, reactivation blocking, and the fixed
nine-signal verifier adapter.
