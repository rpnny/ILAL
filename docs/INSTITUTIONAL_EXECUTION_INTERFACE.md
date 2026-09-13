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

## Compatibility and boundaries

The prior `ilal netting ...` commands remain available as deprecated aliases.
Their `ilal-netting-order-v1`, EIP-712 domain, deterministic sorting, batch ID,
preflight format, and settlement behavior are unchanged.

The preview is unaudited, Base Sepolia only, and not production-ready. It does
not include a graphical console, new deployment, mainnet support, OMS adapter,
custody adapter, managed backend, or hosted reconciliation service.
