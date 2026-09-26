# ILAL issuer stablecoin liquidity pilot

## Objective

ILAL is policy-controlled atomic execution and settlement infrastructure for permissioned digital asset liquidity. This pilot demonstrates controlled secondary liquidity between:

- **Asset A — Issuer Stablecoin.** The issuer defines eligibility for participation in this ILAL pool. The pilot does not claim to restrict possession or transfers outside ILAL.
- **Asset B — USDC-like Settlement Asset.** A separate sandbox operator controls the cash leg. It is not issued by the Asset A issuer and is not represented as real USDC.

The issuer, settlement-asset operator, LP, institutions A and B, executor and deployment account must be distinct addresses. The direct pilot CNF is a testnet eligibility source, not a KYC/KYB provider or regulatory determination.

## Acceptance invariants

> **Only the unmatched residual may reach public AMM liquidity. Internally matched flow must never be exposed to the AMM.**

At parity, institution A sells 100 Asset A and institution B sells 70 Asset B. Gross input is 170, matched input is 140, and actual AMM input must equal the 30 residual. The evidence validator rejects any other decomposition.

> **Policy enforcement must never trap LP principal. Eligibility controls new risk-taking actions, not withdrawal of existing assets.**

LP add requires a current grant. Exit and fee collection must remain available after the LP credential is revoked and the pool policy is disabled.

The TOCTOU gate obtains a valid quote under policy revision N, activates revision N+1, and attempts the same signed orders. Execution must revert atomically without consuming either nonce or changing either institution's balances. A later CNF revocation must also reject new execution-time authorization.

## Local evidence

```bash
make pilot-test
```

The command starts an isolated Anvil instance on port 8548, deploys from an empty chain, runs the full lifecycle, writes `artifacts/pilot/local-evidence.json`, validates it, and shuts down only the process it started. Deterministic local keys are public test fixtures and are rejected by every public-network workflow.

The evidence format is `ilal-issuer-pilot-evidence-v1`; its schema is in `docs/schemas/issuer-pilot-evidence.schema.json`. The operator configuration format is `ilal-issuer-pilot-config-v1` with an example in `docs/examples/issuer-pilot.config.json`.

## Base Sepolia candidate

Replace every placeholder role in the example with a separately controlled address. Build contracts and CLI, then prepare the exact deployment without broadcasting:

```bash
forge build --root contracts
npm run build --prefix cli
node scripts/pilot/prepare-base-sepolia.mjs \
  docs/examples/issuer-pilot.config.json \
  "$BASE_SEPOLIA_RPC" \
  artifacts/pilot/base-sepolia-plan.json
```

The plan deploys Asset A under the issuer, Asset B under the settlement-asset operator, and a direct CNF sandbox under the issuer before deploying the unified ILAL contracts. It pins the official Base Sepolia PoolManager, the reviewed development verifier adapter and live USD reference feeds. Both test assets are synthetic even though the reference feeds are public.

After reviewing the exact addresses, nonces, bytecode and roles, the deployer may broadcast with one explicit signer:

```bash
node scripts/pilot/broadcast-base-sepolia.mjs \
  artifacts/pilot/base-sepolia-plan.json \
  "$BASE_SEPOLIA_RPC" \
  deployments/base-sepolia/v1.0.0-issuer-pilot-testnet.1.json \
  --keystore "$DEPLOYER_KEYSTORE" \
  --password-file "$DEPLOYER_PASSWORD_FILE"
```

The resulting manifest deliberately records `operationalEvidence.status` as `not completed`. Deployment receipts do not prove credentials, grants, liquidity or execution. Each role must then use its own signer to issue and fund the assets, issue CNFs, activate grants, add liquidity, sign orders, execute, revoke eligibility and exit liquidity. Do not share keys or collapse roles for the public rehearsal.

Validate the resulting evidence statically and against the chain:

```bash
node scripts/pilot/verify-evidence.mjs artifacts/pilot/base-sepolia-evidence.json "$BASE_SEPOLIA_RPC"
```

Only after this command passes may the evidence be bound to the matching candidate manifest:

```bash
node scripts/pilot/record-evidence.mjs \
  deployments/base-sepolia/v1.0.0-issuer-pilot-testnet.1.json \
  artifacts/pilot/base-sepolia-evidence.json \
  "$BASE_SEPOLIA_RPC"
```

The recorder repeats the complete chain verification, checks every protocol address and pool ID, and stores the evidence SHA-256 digest before changing the manifest status to `completed`.

## Supported boundary

The pilot uses standard six-decimal test ERC-20 assets, a 5 bps pool, parity reference price, CNF_ONLY eligibility, two opposing orders and one owner-isolated LP position. It does not provide fiat issuance or redemption, custody, post-settlement reversal, sanctions screening, KYC/KYB, production governance, SLA, independent audit or a customer ROI claim. ZK remains an available protocol path but is outside this pilot.
