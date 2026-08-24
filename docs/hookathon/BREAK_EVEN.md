# Gas-cost break-even benchmark

This benchmark answers a narrower economic question than the mechanism test:
**at what order notional does ILAL's execution improvement exceed its gas
premium?** It fixes the opposing-flow pattern at `N / 0.7N` and tests anchor
notionals of 100, 1,000, 10,000 and 100,000 tokens.

Run it from the repository root:

```bash
make break-even-benchmark
```

## Headline result

With liquidity scaled proportionally to notional, the measured user benefit is
approximately **7.00 bps of anchor notional**
(4.12 bps of gross submitted notional).
The conservative measured total-gas premium is **449,430 gas**.

At a scenario ETH price of $3,000, the resulting anchor-notional break-even is:

- **$19.26** at 0.01 gwei
- **$192.61** at 0.1 gwei
- **$1,926.14** at 1 gwei

These are sensitivity inputs, not claims about current ETH or Base gas prices.

## Scaled-liquidity notional sweep

| Anchor notional | Gross notional | User output benefit | Benefit vs gross | Total-gas premium | Break-even gas price at $3k ETH |
|---:|---:|---:|---:|---:|---:|
| 100 | 170 | $0.070000 | 4.12 bps | 449,430 | 0.052 gwei |
| 1,000 | 1,700 | $0.699996 | 4.12 bps | 441,343 | 0.529 gwei |
| 10,000 | 17,000 | $6.999946 | 4.12 bps | 441,355 | 5.287 gwei |
| 100,000 | 170,000 | $69.999456 | 4.12 bps | 441,379 | 52.864 gwei |

Scaling liquidity keeps price depth constant and isolates gas amortization. The
gas premium stays approximately fixed while user benefit grows linearly with
notional.

## Break-even anchor notional sensitivity

| ETH/USD scenario | 0.01 gwei | 0.1 gwei | 1 gwei |
|---:|---:|---:|---:|
| $2,000 | $12.84 | $128.41 | $1,284.10 |
| $3,000 | $19.26 | $192.61 | $1,926.14 |
| $4,000 | $25.68 | $256.82 | $2,568.19 |

## Net benefit at $3,000 ETH

| Anchor notional | Execution benefit | 0.01 gwei | 0.1 gwei | 1 gwei |
|---:|---:|---:|---:|---:|
| 100 | $0.070000 | +$0.057 | −$0.065 | −$1.278 |
| 1,000 | $0.699996 | +$0.687 | +$0.565 | −$0.648 |
| 10,000 | $6.999946 | +$6.986 | +$6.865 | +$5.652 |
| 100,000 | $69.999456 | +$69.986 | +$69.865 | +$68.651 |

Positive values mean the measured output improvement exceeds the conservative
gas premium. Negative values mean gas costs more than the measured execution
benefit under that scenario.

## Fixed candidate-liquidity stress test

| Anchor notional | Output advantage | Benefit vs gross | ILAL full execution | Vanilla full fill | ILAL ending tick |
|---:|---:|---:|---:|---:|---:|
| 100 | 0.070000 | 4.12 bps | yes | yes | -1 |
| 1,000 | 0.699459 | 4.11 bps | yes | yes | -6 |
| 10,000 | 6.467941 | 3.80 bps | yes | yes | -60 |
| 100,000 | capacity-limited | capacity-limited | no | no | n/a |

The fixed-liquidity `100k/70k` row is deliberately reported as
**capacity-limited**, not as an economic win. With the candidate's
1,000,000,000,000 liquidity and [-1000, 1000] LP range, the ILAL batch reverts
during immediate settlement and neither vanilla ordering fully consumes both
signed inputs. It is excluded from break-even interpolation.

This exposes an operational boundary: a solver must preflight both price depth
and physical PoolManager token balances. Large batches need deeper liquidity,
smaller residuals, stricter signed limits, or a settlement design that does not
attempt an output transfer before the offsetting input has arrived.

## Gas methodology and limits

- ILAL total gas is measured execution gas plus encoded calldata gas and one
  21,000-gas transaction envelope.
- Vanilla total gas is the lower-gas full-fill ordering plus encoded calldata
  gas and two 21,000-gas transaction envelopes.
- The sensitivity model uses the maximum measured scaled-liquidity gas premium,
  avoiding a lower break-even caused by fixture warming or row-level variance.
- Vanilla is the direct Foundry v4 test router with approvals already in place;
  it is not a Universal Router, Permit2 or production bundler trace.
- L1 data fees, solver discovery, latency, MEV, approval setup and off-chain
  operating cost are not included.
- Both mock stablecoins are assumed to be worth $1 and match at raw-unit 1:1.

Machine-readable results: [`break-even-results.json`](break-even-results.json).
