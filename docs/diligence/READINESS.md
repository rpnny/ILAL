# From public sandbox to diligence-ready issuer pilot

ILAL has proved the ZK lifecycle on Base Sepolia with synthetic assets and an unsafe development ceremony. The next milestone freezes the circuit and changes the trust inputs: an independently conducted ceremony and an Asset A controlled by a real issuer.

No new circuit is part of this milestone. `ILALEligibilityPolicyV2` is frozen by `docs/data-room/CIRCUIT_V2_FREEZE.json`. Any source, constraint, tree-depth, public-signal-order or verifier-interface change requires a new circuit version and a new ceremony.

## Completion gates

| Gate | Evidence | Current state |
|---|---|---|
| Circuit freeze | Reproducible source-set digest and fixed public interface | Complete |
| Independent ceremony | Chained contributions, public beacon, artifact hashes, coordinator and independent-verifier attestations | External participants required |
| Real issuer | Legal-identity and signer evidence held in the private data room | Issuer required |
| Issuer-controlled Asset A | On-chain controller and policy administrator are the issuer role | Issuer required |
| Replayed `.3` lifecycle | ZK grants, 170/140/30, root retirement rollback, nonzero fee collection, full exit and zero transient inventory | Requires ceremony and issuer |
| Independent historical verification | Fixed-block verification of receipts, calldata, proofs, signatures, balances and nonces | Tooling complete; new evidence required |
| Security and legal review | Independent protocol/circuit/infrastructure audit and applicable legal review | Outstanding |

`scripts/diligence/verify-package.mjs` verifies the public, non-secret portion of this package. It rejects a changed circuit source set, incomplete contribution chains, reused ceremony entities, artifact hash mismatches, synthetic Asset A, issuer/policy role mismatches and missing lifecycle acceptance results.

```sh
node scripts/diligence/verify-package.mjs docs/data-room/CIRCUIT_V2_FREEZE.json

node scripts/diligence/verify-package.mjs \
  docs/data-room/CIRCUIT_V2_FREEZE.json \
  /path/to/ceremony-manifest.json \
  /path/to/issuer-pilot-acceptance.json \
  --require-complete
```

Private legal documents, signatures, participant contact details, KYC/KYB data, witness files and ceremony entropy remain outside Git. Public manifests contain hashes and organization references only.

The resulting claim is limited to an independently reproducible issuer pilot. It does not by itself establish production readiness, regulatory approval, an audit opinion, custody capability or a fiat redemption service.
