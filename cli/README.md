# ILAL CLI

Command-line access to ILAL's policy-controlled atomic execution and settlement protocol. Requires Node.js 24. This development package is private and unpublished.

```bash
npm ci --prefix sdk
npm ci --prefix cli
make build
node cli/dist/index.js --help
node cli/dist/index.js console --manifest deployments/base-sepolia/v1.0.0-mixed-testnet.1.json --rpc https://sepolia.base.org
```

Commands run directly under `ilal`; there is no `mixed`, `session`, `netting` or protocol-version command group.

| Command | Purpose |
| --- | --- |
| `check`, `monitor` | Validate deployment bindings and inspect policy/grants |
| `grant` | Activate CNF, ZK or combined eligibility |
| `approve` | Grant an explicit token allowance to the execution or LP router |
| `quote`, `sign`, `execute`, `status` | Simulate, authorize, settle and inspect orders |
| `liquidity` | Add, exit or collect an owner-controlled position |
| `cancel` | Cancel one authorization nonce namespace |
| `issuer-build` | Build issuer-controlled ZK policy witnesses |
| `policy-prepare`, `safe-propose` | Prepare governance calldata and Safe proposals |
| `console` | Start the local wallet-based application |

Network commands require an explicit `--manifest` and `--rpc`. Historical deployment presets are not loaded. Use `<command> --help` for required inputs.

Select transaction signers with `--keystore` and `--password-file`, or `--rpc-account`. The explicitly enabled `--unsafe-private-key` mode is testnet-only. Safe proposals require the explicit `safe-propose` command; preparation does not imply permission to submit. Browser signing stays in the connected wallet.

Existing `Mixed*` JSON formats and signature domains remain unchanged. Old Session/V2/SOEE authorization files are incompatible. See [the runbook](../docs/mixed/RUNBOOK.md) and [historical migration notes](../docs/HISTORY.md).
