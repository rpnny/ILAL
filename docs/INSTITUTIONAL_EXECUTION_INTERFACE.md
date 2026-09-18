# Institutional Execution Interface v0.1

This interface makes the Hookathon settlement candidate usable as a local-first
institutional execution protocol:

```text
ILAL Order -> ILAL Batch -> Settlement Receipt
```

It does not use an ILAL-operated API, order book, indexer, or reconciliation
server. Creating intents, local signing, building batches, and previewing are
offline. Preflight, execution, and inspection use only a caller-selected
standard JSON-RPC endpoint.

## Frozen settlement baseline

The interface is built above, and does not modify, the signed
`v0.4.0-v2-poc.7` software baseline and the exact-match Base Sepolia deployment
from source commit `a512e6996735ab83d088a80723d30e4f7bb897a9`.
`baseline/institutional-execution-v0.1.json` records the source identity,
contract hashes, addresses, and golden settlement evidence. Run:

```bash
make baseline-check
node scripts/verify-settlement-baseline.mjs --artifacts # after forge/protocol builds
```

Any change to the protected Router, Hook, guard, or deployment script fails the
check. Such a change is a new protocol candidate and requires a breaking-change
rationale, deployment manifest, and replacement verification evidence.

## Install and configure

```bash
npm install -g @ilalv3/cli@next
```

The working directory's `.ilal.json` supplies the execution context:

```json
{
  "chain": "84532",
  "rpc": "https://sepolia.base.org",
  "router": "0x96456C68f25A1Fa6C2F2751183401ac26A732506",
  "hook": "0x8d1fA43F848701b2adB105D5c925A9247E600088",
  "tokenA": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "tokenB": "0xC4946fEC334f4B9350dF08E311261e4361B7c72C",
  "poolId": "0xeab91a1421cb5c170df74c1eaf676a8836eda1fc5a833f62ab9c2d516acfbc87",
  "fee": "500",
  "tickSpacing": "10"
}
```

## Reference workflow

Institution A creates a reviewable unsigned intent and then signs it with its
own keystore:

```bash
ilal order create \
  --user 0x1b869CaC69Df23Ad9D727932496AEb3605538c8D \
  --zero-for-one --amount-in 100000 --min-amount-out 99000 \
  --max-amm-input 30000 --ttl 900 --output order-a.intent.json

ilal --keystore institution-a.json --password-file institution-a.password \
  order sign order-a.intent.json --output order-a.json
```

Institution B independently creates and signs the opposing `70000` order with
`--one-for-zero --min-amount-out 70000 --max-amm-input 0`.

The permissionless executor then runs:

```bash
ilal batch build --orders order-a.json order-b.json --output batch.json
ilal batch preview batch.json
ilal batch preflight batch.json --output preflight.json

ilal --keystore solver.json --password-file solver.password \
  batch execute batch.json --receipt receipt.json

ilal settlement inspect <tx-hash> --output inspected-receipt.json
cmp receipt.json inspected-receipt.json
```

`execute` always repeats full preflight with the actual executor immediately
before broadcasting. A successful execution writes a deterministic
`ilal-settlement-receipt-v1`. Inspection decodes the transaction calldata,
recomputes the batch commitment, and cross-checks every `OrderSettled` event
and the `BatchExecuted` event.

Use `--json` for JSON-only stdout. Human status goes to stderr. Artifact files
are atomically written with mode `0600`; existing files are protected unless
`--force` is explicit. Exit status `2` means protocol/preflight rejection and
`1` means an input, RPC, or tool failure.

New-interface JSON uses decimal strings for every integer, including chainId,
fee, tickSpacing, and orderIndex. Library consumers should use the root export
`stringifyProtocolJson`; parsers also accept the existing numeric legacy metadata.

## Local end-to-end verification

After `npm ci`, `npm run build`, and `cd contracts && forge build`, run
`npm run test:institutional-e2e` from the repository root with Anvil on PATH.
The harness starts its own non-forked Anvil, deploys the frozen contracts with
local mock assets/credentials/feeds, and runs all seven CLI stages through real
transactions. It verifies 70000/70000 matching, 30000/0 residuals, identical
execute/inspect receipts, zero Router/Hook inventory, closed context, consumed
nonces, rejected replay, and legacy preview compatibility. It uses ephemeral
Anvil-managed accounts and does not inherit workstation signing credentials.

This local test does not substitute for the final funded Base Sepolia run.

## Base Sepolia acceptance harness

The final candidate run is guarded by a read-only readiness check. It pins all
reads to one block and verifies the frozen Router, Hook, and oracle-guard runtime
hashes; oracle freshness; credentials; balances; allowances; solver gas;
inventory; batch context; and configured keystore addresses. It sends requests
only to the explicitly configured JSON-RPC endpoint and never contacts an ILAL
service:

```bash
ILAL_ACCEPTANCE_RPC=https://sepolia.base.org \
  npm run acceptance:base-sepolia:check
```

The check prints `ilal-base-sepolia-acceptance-readiness-v1` JSON and exits `2`
while a protocol prerequisite is missing. It does not load passwords, sign, or
broadcast. `--output readiness.json` writes the report atomically with mode
`0600`.

Execution requires encrypted Web3 Secret Storage v3 keystores and password
files with mode `0600`. Supply paths, never secret contents:

```bash
export ILAL_INSTITUTION_A_KEYSTORE=/secure/institution-a.json
export ILAL_INSTITUTION_A_PASSWORD_FILE=/secure/institution-a.password
export ILAL_INSTITUTION_B_KEYSTORE=/secure/institution-b.json
export ILAL_INSTITUTION_B_PASSWORD_FILE=/secure/institution-b.password
export ILAL_EXECUTOR_KEYSTORE=/secure/executor.json
export ILAL_EXECUTOR_PASSWORD_FILE=/secure/executor.password

node scripts/base-sepolia-institutional-acceptance.mjs \
  --execute --output-dir ./base-sepolia-acceptance
```

Before creating any order, the harness requires every chain prerequisite and
keystore identity to match, then decrypts all three keystores to confirm their
addresses. It runs create, sign, build, preview, preflight, execute, and inspect;
requires byte-identical receipts; and verifies zero Router/Hook inventory, a
closed batch context, and consumed nonces. Existing output directories and
reports are refused unless `--force` is explicit.

## Compatibility and boundaries

The prior `ilal netting ...` commands remain available as deprecated aliases.
Their `ilal-netting-order-v1`, EIP-712 domain, deterministic sorting, batch ID,
preflight format, and settlement behavior are unchanged.

The preview is unaudited, Base Sepolia only, and not production-ready. It does
not include a graphical console, new deployment, mainnet support, OMS adapter,
custody adapter, managed backend, or hosted reconciliation service.
