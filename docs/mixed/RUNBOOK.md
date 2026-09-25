# ILAL Mixed v1 local runbook

Mixed v1 combines atomic matching, bounded residual swaps, Mixed eligibility and owner-isolated liquidity. It currently has no public deployment. All commands below operate locally unless an explicit RPC and reviewed manifest are supplied.

## Verification

```bash
make mixed-verify
make mixed-local
```

`mixed-verify` regenerates two real development Groth16 proofs, checks Solidity/TypeScript vectors, executes the Mixed suites, runs 100,000 stateful handler calls, checks generated ABI drift and rejects deployed bytecode above EIP-170. `mixed-local` owns an ephemeral Anvil process, deploys a local fixture, exercises the SDK and browser protocol, runs four policy modes, root retirement, owner exit/collect and the economic matrix, then stops that process.

Generated evidence is under `artifacts/mixed/` and is intentionally ignored by git. Development proving artifacts and local manifests must never be presented as production evidence.

## CLI and Console

```bash
node cli/dist/index.js mixed check --manifest <manifest.json> --rpc <explicit-rpc>
node cli/dist/index.js mixed monitor --manifest <manifest.json> --rpc <explicit-rpc>
node cli/dist/index.js mixed quote --manifest <manifest.json> --rpc <explicit-rpc> --input unsigned-orders.json
node cli/dist/index.js mixed console --manifest <manifest.json> --rpc <explicit-rpc>
```

The workflow is grant activation, explicit ERC-20 approval, bounded order signing, forced-revert quote, fresh simulation and execution. An order signature never grants token spending permission. Direct swaps require a `MixedDirectSwap` signature and namespace; batch orders are not reused as fallback orders.

The Console binds to loopback, uses a random session token, rejects foreign Host/Origin values and delegates all signing and sending to the injected wallet. It does not hold keys or send notifications.

## Deployment preparation

`scripts/mixed/prepare-deployment.mjs` validates an explicit configuration and writes ordered unsigned transaction data. The plan deploys a dedicated owner-restricted `MixedHookFactory`; it does not depend on a test fixture or a pre-existing arbitrary deployer. Production classification fails closed unless source, external runtime hashes, proving ceremony, issuer acceptance and independent audit evidence are supplied.

After reviewing the exact plan, build the CLI and broadcast with exactly one explicit signer:

```bash
npm run build --prefix cli
node scripts/mixed/prepare-base-sepolia.mjs "$DEPLOYER" "$ADMIN" "$RPC_URL"
node scripts/mixed/broadcast-deployment.mjs \
  artifacts/mixed/base-sepolia-plan.json "$RPC_URL" deployments/<network>/<version>.json \
  --keystore "$KEYSTORE" --password-file "$PASSWORD_FILE"
```

The Base Sepolia helper reads the current deployer nonce, external runtime hashes, token metadata, issuer credential type and live feed rounds before writing a plan. It uses Circle test USDC and the existing ILAL `hUSDT` test representation; `hUSDT` is not official USDT. Pass the generated `artifacts/mixed/base-sepolia-plan.json` to the broadcaster unless custom output paths were supplied.

`--rpc-account <address>` is available for a node-managed signer. `--unsafe-private-key` reads `PRIVATE_KEY` only for an explicitly classified testnet plan. The broadcaster checks the chain, signer, pending nonce and every planned transaction, waits for each receipt, persists a resumable journal after every confirmation, and writes the deployment manifest only after all code is present.

Run the read-only post-deployment verification immediately afterward:

```bash
node scripts/mixed/preflight.mjs deployments/<network>/<version>.json config.json "$RPC_URL"
```

The preflight checks code and immutable bindings, Hook flags, feeds, thresholds, sequencer, policy, roles, verifier and current oracle health.

The reviewed deployer must still approve the concrete plan. The implementation does not treat a generated plan as a deployment.
