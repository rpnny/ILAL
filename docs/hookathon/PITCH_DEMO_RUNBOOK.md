# ILAL Hookathon pitch demo runbook

The presentation runner is intentionally non-broadcasting. It combines a real
ILAL CLI calculation, immutable candidate evidence and a real local oracle
rollback regression. It does not require a user-supplied or stored private key
and does not present a historical transaction as a newly broadcast transaction.

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
