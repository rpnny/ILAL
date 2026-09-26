# ILAL — Institutional Access and Execution for Uniswap v4

Prove eligibility once. Net opposing orders. Send only the residual to Uniswap v4.

ILAL has **one maintained protocol**: eligibility grants, atomic signed-order settlement and owner-controlled liquidity. Internal `Mixed*` names remain only where the deployed wire format requires them. Earlier Session, V2 and SOEE implementations are historical and are not selectable products or executable stacks in this checkout.

## How it works

1. **Eligibility:** a pool accepts CNF credentials, a ZK policy proof, either source, or both.
2. **Reusable access:** a short-lived grant binds eligibility to a user, pool and policy revision. Source validity is checked on use; expiry, revocation and policy changes can invalidate access.
3. **Execution:** users sign bounded orders. ILAL sorts the batch, matches opposing flow and sends the residual through Uniswap v4, all in one transaction. Direct swaps use the same protocol with their own authorization.
4. **Liquidity:** positions belong to individual users. Adding liquidity requires a live grant; withdrawing principal and collecting fees remain available without one.

A grant reuses eligibility, not permission to spend. Each execution still needs its own authorization and ERC-20 allowance. Order limits, deadlines and nonce protection are enforced on-chain. Quotes simulate settlement and always roll back; they never authorize execution.

## Current status

The current [Base Sepolia candidate](deployments/base-sepolia/v1.0.0-mixed-testnet.1.json) uses **CNF_ONLY**, Circle test USDC and ILAL hUSDT. It is unaudited; ZK is disabled in this public pool. The deployment manifest records a successful read-only preflight, not a funded grant/trading/LP demonstration. Local end-to-end tests exercise those capabilities.

The source packages are private, unpublished development packages. Selecting this implementation does not promote the candidate to an active stable release, migrate any positions, or change existing deployments. [protocol.json](protocol.json) selects the implementation and candidate; [historical records](docs/HISTORY.md) preserve earlier release evidence.

## Start locally

Requires Node.js 24, Foundry v1.5.1 and Circom 2.2.3.

```bash
npm ci --prefix sdk
npm ci --prefix cli
npm ci --prefix circuits
make build
node cli/dist/index.js --help
```

Open the wallet-based console against the candidate using an explicit RPC:

```bash
node cli/dist/index.js console \
  --manifest deployments/base-sepolia/v1.0.0-mixed-testnet.1.json \
  --rpc https://sepolia.base.org
```

The console listens on `http://127.0.0.1:4174`. Signing stays in the wallet. Use `ilal grant`, `quote`, `sign`, `execute`, `liquidity` and `monitor` when installed from a locally packed CLI. There is no protocol-version selector.

## Development

```bash
make verify          # all current checks, including real proofs and local end-to-end
make contracts-test  # Solidity unit/fuzz tests
make cli-test        # CLI and signer tests
make sdk-test        # model, encoding and client tests
make circuits-test   # policy-circuit constraint tests
make protocol-test   # real proof, differential, 100,000 invariant calls, deployment checks
make local-test      # isolated Anvil lifecycle, economics and console integration
```

| Area | Entry |
| --- | --- |
| Protocol contracts | [contracts/src/mixed](contracts/src/mixed) |
| Shared credential and oracle infrastructure | [contracts/README.md](contracts/README.md) |
| SDK | [sdk/README.md](sdk/README.md) |
| CLI and local console | [cli/README.md](cli/README.md) |
| Executable specification | [docs/mixed/SPEC.md](docs/mixed/SPEC.md) |
| Operations and deployment | [docs/mixed/RUNBOOK.md](docs/mixed/RUNBOOK.md) |
| Migration and history | [docs/HISTORY.md](docs/HISTORY.md) |

The Hook is immutable. Protocol changes require explicit deployment and migration review. See [SECURITY.md](SECURITY.md) and the [audit scope](docs/mixed/AUDIT_SCOPE.md).

Apache License 2.0; generated verifier and third-party exceptions are documented in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
