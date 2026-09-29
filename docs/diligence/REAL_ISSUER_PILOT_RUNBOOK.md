# Real Asset A issuer pilot runbook

## Entry criteria

The issuer is a real legal entity with an authorized signer. Asset A is issued and controlled by that entity on the selected test network or an approved production-like sandbox. The issuer owns the relationship with its identity/KYC/KYB provider and defines the eligibility policy represented by the credential and jurisdiction roots.

ILAL does not make the eligibility decision, issue legal or regulatory approval, custody participant assets, control Asset A outside the ILAL pool or provide fiat issuance and redemption.

## Required separation

Use distinct addresses for issuer representative, Asset A controller, policy administrator, LP, institution A, institution B and executor. The issuer entity must demonstrably control both Asset A issuance and the ILAL pool policy; separate issuer-owned Safes are allowed after their thresholds and owners are reviewed. The acceptance manifest binds evidence for both control relationships.

The settlement asset must be explicitly accepted by the issuer. Its operator, redemption model and test/production status must be recorded separately from Asset A.

## Lifecycle

1. Bind the independently generated verifier artifacts to a fresh deployment manifest.
2. Let the issuer publish the ZK policy fields and control the initial `ZK_ONLY` policy.
3. Generate private witnesses through the issuer-controlled eligibility process. ILAL receives only proofs and public signals.
4. Activate source-2 grants for the LP and both institutions.
5. Add issuer-approved Asset A/settlement-asset liquidity.
6. Quote and execute the same 100/70 scenario, deriving 170 gross, 140 internally matched and 30 AMM input from canonical events.
7. Quote a second pair of signed orders, then have the issuer retire the credential root.
8. Execute the unchanged signed orders and require an atomic `Ineligible()` revert with balances, pool state and nonces unchanged.
9. Require nonzero fee collection and full LP exit after root retirement.
10. Run the historical verifier from an independent read-only process and bind the evidence SHA-256 to the deployment manifest.

## Issuer sign-off

The issuer reviews the exact Asset A contract, settlement asset, policy roots, administrator addresses, transaction hashes, evidence digest and protocol boundaries. Acceptance uses `docs/data-room/templates/real-issuer-pilot-acceptance.template.json` and is complete only after every lifecycle result is true and the issuer attestation digest is present.

Private corporate, signer and provider documents remain outside Git. The public acceptance manifest contains their hashes, the issuer organization reference and on-chain evidence.

## Production blockers that remain

Successful completion establishes a real-issuer, independently verifiable pilot. Independent contract/circuit/infrastructure audit, production Safe/HSM governance, token and oracle review, monitoring, incident response, legal review and production service agreements remain separate gates.
