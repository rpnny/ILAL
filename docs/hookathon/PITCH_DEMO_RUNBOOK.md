# ILAL Hookathon pitch demo runbook

The presentation runner is intentionally non-broadcasting. It combines a real
ILAL CLI calculation, immutable candidate evidence and a real local oracle
rollback regression. It does not require a user-supplied or stored private key
and does not present a historical transaction as a newly broadcast transaction.

The runner prefers the exact public npm preview version declared in
`cli/package.json`. If the matching global `ilal` binary is unavailable, it
uses the pinned `@ilalv3/cli` npm version through `npx`; only an offline npm
failure causes a repository-build fallback. The opening screen reports which
surface is being exercised.

## Launch

On macOS, double-click:

```text
scripts/hookathon-pitch-demo.command
```

Or launch it from a terminal:

```bash
./scripts/hookathon-pitch-demo.command
```

Press return to advance each stage. Press `q` at an advance prompt to quit.

For an automatically advancing rehearsal:

```bash
ILAL_DEMO_DELAY=5 ./scripts/hookathon-pitch-demo.command --auto
```

For a non-interactive integrity check:

```bash
./scripts/hookathon-pitch-demo.command --smoke
```

## Live Base Sepolia broadcast

For the final recorded demo, double-click:

```text
scripts/hookathon-pitch-demo-live.command
```

The live runner silently prompts for the two candidate institution test keys
and any funded Base Sepolia executor key. The expected institution addresses
are shown at the prompts, and reversed A/B inputs are corrected automatically.
It creates fresh signed orders, runs a pinned-state
preflight, asks for the exact confirmation word `BROADCAST`, submits one scaled
`0.010 / 0.007` Base Sepolia batch, waits for the successful receipt and prints
the new BaseScan transaction URL. Keys remain in memory only and are not saved
to the repository or printed.

Use the ordinary runner for rehearsals. Live mode consumes testnet ETH and
assets, and the transaction is irreversible once broadcast. If preflight
rejects the batch, the CLI stops before accessing the solver signer or sending
a transaction.

Before requesting any key, live mode calls the immutable Chainlink guard at the
latest Base Sepolia block. If either official testnet feed is stale or otherwise
invalid, it prints both feed ages and BaseScan links and exits without signing,
preflighting or broadcasting. Do not loosen the candidate guard for a recording;
use the recorded-evidence runner until the official feed updates.

## Speaking cues

| Stage | Target | Cue |
|---|---:|---|
| Opening | 10s | “AMMs are great markets. They are terrible meeting rooms.” |
| CLI preview | 25s | Explain signed opposing flow, canonical allocation and `140 → 30`. |
| Chainlink | 20s | External price boundary; circuit breaker, not execution price. |
| Preflight | 20s | Pinned state snapshot and complete simulation before broadcast. |
| Settlement | 25s | Atomic Base Sepolia evidence, residual-only AMM execution and zero inventory. |
| Rejection | 20s | Oracle failure occurs before balance or nonce mutation. |
| Impact | 25s | 82.35%, 4.1197 bps and the strict `$10k` Base gate; state the limits. |
| Close | 10s | “Verify access. Net what cancels. Send only the residual.” |

The terminal segment should take roughly two minutes. Slides provide the first
90 seconds of problem/mechanism context and the final 30–45 seconds of summary.

## Recording rules

- Record at 1080p or higher with a terminal font large enough to read.
- Use a human voice; UHI does not allow AI narration.
- Rehearse with interactive mode so narration controls the pace.
- Do not add private keys, keystore passwords or writable RPC credentials.
- Keep the BaseScan link visible long enough for a reviewer to pause the video.
- If a local dependency fails on recording day, use the already recorded clean
  take rather than changing protocol state or broadcasting a replacement batch.
