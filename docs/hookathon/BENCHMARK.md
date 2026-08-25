# Institutional netting impact benchmark

This reproducible Foundry benchmark compares one ILAL atomic batch with two
ordinary exact-input Uniswap v4 swaps from the same initial pool state. The
two vanilla orderings are both executed. Reported output improvement uses the
higher vanilla output, while the gas comparison uses the lower vanilla gas.

Run it from the repository root:

```bash
make benchmark
```

## Results

| Orders (token0/token1) | AMM exposure reduction | ILAL AMM residual | User output advantage vs best vanilla | LP fee reduction | Local execution gas ILAL / best vanilla |
|---:|---:|---:|---:|---:|---:|
| 100/25 | 40.00% | 75.000000 | +0.025001 (2.00 bps) | 40.00% | 698,849 / 195,556 (3.57x) |
| 100/50 | 66.67% | 50.000000 | +0.050000 (3.34 bps) | 66.67% | 698,850 / 195,557 (3.57x) |
| 100/70 | 82.35% | 30.000000 | +0.070000 (4.12 bps) | 82.35% | 698,353 / 195,556 (3.57x) |
| 100/90 | 94.74% | 10.000000 | +0.090001 (4.74 bps) | 94.74% | 698,849 / 195,556 (3.57x) |
| 100/100 | 100.00% | 0.000000 | +0.100001 (5.00 bps) | 100.00% | 657,422 / 195,567 (3.36x) |

For the canonical `100/70` demo, ILAL routes 30.000000 tokens rather than
170.000000 gross tokens through AMM execution: an **82.35%
reduction**. Aggregate user output is **0.070000 tokens
(4.12 bps) higher** than the better vanilla ordering, and
the charged LP fee falls from 0.085000 to
0.015000 tokens. The tradeoff is execution complexity:
the ILAL path consumes 698,353 local execution gas versus
195,556 for the lower-gas pair of vanilla swap calls
(3.57x).

The ILAL output of 169.984100 matches the public Base Sepolia
`100/70` settlement recorded in the candidate manifest. This connects the
controlled benchmark to the deployed evidence without treating testnet gas as
a production gas estimate.

## What the result means

- More opposing flow produces a nearly linear reduction in AMM exposure and LP
  fees under the benchmark's zero-netting-fee design.
- Users receive more aggregate output because internally matched units settle
  at raw-unit 1:1 instead of paying AMM fees and price impact twice.
- ILAL currently spends more execution gas because it verifies eligibility,
  EIP-712 signatures and nonces, computes canonical allocation, and directly
  settles both users inside one atomic unlock.
- LP fee reduction is a deliberate tradeoff: it benefits participating users
  but reduces fees earned on flow that would otherwise have reached the pool.

## Method and limits

- Two 6-decimal mock stablecoins, initial 1:1 price, 0.05% pool fee,
  1,000,000,000,000 liquidity and the same [-1000, 1000] range as the candidate.
- Each row fixes the token0 order at 100 tokens and varies the opposing token1
  order. The ILAL residual is the unmatched token0 amount.
- Foundry-local gas excludes transaction intrinsic gas and does not represent a
  Universal Router, production bundler or mainnet quote.
- The benchmark does not model solver discovery, latency, MEV, oracle pricing,
  depeg behavior or off-chain operating costs.
- Raw-unit 1:1 matching is appropriate only for the deliberately narrow
  equal-decimal stablecoin candidate described in the Hookathon scope.

Machine-readable results: [`benchmark-results.json`](benchmark-results.json).
