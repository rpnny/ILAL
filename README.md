# ILAL — Policy-controlled atomic execution and settlement

**Policy-controlled atomic execution and settlement infrastructure for permissioned digital asset liquidity.**

ILAL lets an asset issuer define who may enter a liquidity pool, lets eligible institutions authorize bounded orders, matches opposing flow atomically, and sends only the unmatched residual to Uniswap v4.

## Issuer pilot

The first pilot models one issuer stablecoin against a separate settlement asset:

- **Asset A — Issuer Stablecoin:** the issuer controls eligibility for the ILAL pool involving its asset.
- **Asset B — USDC-like Settlement Asset:** an independently controlled sandbox cash leg.
- **Participants:** issuer, settlement-asset operator, liquidity provider, institutions A and B, and a permissionless executor are separate roles.

The canonical case has 100 units of Asset A offered against 70 units of Asset B at parity:

| Measure | Amount |
| --- | ---: |
| Gross institutional flow | 170 |
| Internally matched flow | 140 |
| Public AMM exposure | 30 |

> **Only the unmatched residual may reach public AMM liquidity. Internally matched flow must never be exposed to the AMM.**

The execution happens in one PoolManager unlock. A quote is a full forced-revert simulation and never authorizes execution. Eligibility, policy revision, signatures, limits, balances and allowances are checked again against execution-time state.

> **Policy enforcement must never trap LP principal. Eligibility controls new risk-taking actions, not withdrawal of existing assets.**

Adding liquidity requires a live grant. The position owner can exit principal and collect fees after credential revocation, grant expiry, policy shutdown or oracle failure.

Run the complete local pilot from a blank Anvil chain:

```bash
npm ci --prefix sdk
npm ci --prefix cli
make build
make pilot-test
```

The gate writes `artifacts/pilot/local-evidence.json` and verifies role separation, the 170/140/30 flow decomposition, quote-to-execution equality, zero Hook/Router inventory, a quote → policy change → execute atomic failure, credential revocation and LP exit safety. See the [issuer pilot guide](docs/pilot/ISSUER_PILOT.md).

## Protocol

ILAL has one maintained implementation: CNF/ZK eligibility sources, reusable pool-scoped grants, bounded signed orders, atomic matching and owner-controlled liquidity. Existing internal `Mixed*` names remain only where the deployed wire format requires them.

A grant reuses eligibility, not permission to spend. Every execution still requires its own authorization and ERC-20 allowance. Direct swaps use the same policy and authorization system. Quotes always roll back.

The current [Base Sepolia issuer-pilot candidate](deployments/base-sepolia/v1.0.0-issuer-pilot-testnet.1.json) has a funded seven-role public lifecycle demonstration. Its [versioned evidence](deployments/base-sepolia/evidence/v1.0.0-issuer-pilot-testnet.1.json) records the verified 170/140/30 execution, an execution-time policy-ban TOCTOU revert with unchanged balances and nonces, CNF revocation, zero protocol inventory, and LP collection and full exit after policy shutdown. The candidate remains an unaudited testnet sandbox.

## Development

Requires Node.js 24, Foundry v1.5.1 and Circom 2.2.3.

```bash
make verify          # complete maintained protocol and issuer-pilot gates
make pilot-test      # isolated issuer pilot and evidence validation
make contracts-test  # Solidity unit and fuzz tests
make protocol-test   # real proof, differential and invariant checks
make local-test      # unified protocol lifecycle and economics
```

| Area | Entry |
| --- | --- |
| Issuer pilot | [docs/pilot/ISSUER_PILOT.md](docs/pilot/ISSUER_PILOT.md) |
| Protocol specification | [docs/mixed/SPEC.md](docs/mixed/SPEC.md) |
| Operations | [docs/mixed/RUNBOOK.md](docs/mixed/RUNBOOK.md) |
| Audit boundary | [docs/mixed/AUDIT_SCOPE.md](docs/mixed/AUDIT_SCOPE.md) |
| CLI | [cli/README.md](cli/README.md) |
| SDK | [sdk/README.md](sdk/README.md) |
| Historical records | [docs/HISTORY.md](docs/HISTORY.md) |

The software and pilot are unaudited, unpublished and not production-ready. Apache License 2.0; generated-verifier and third-party exceptions are documented in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
