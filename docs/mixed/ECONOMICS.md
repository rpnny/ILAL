# Mixed v1 economic evidence

The local matrix compares Mixed execution with an unhooked Uniswap v4 pool using the same starting sqrt price, liquidity range, fee tier, input amounts and order ordering. It covers 2, 4, 8 and 16 orders; balanced and 100/70/20 opposing flow; parity and moved price; and two liquidity levels. Matched fee and protocol fee are zero, residual pool fee is 5 bps, and gas is recorded separately.

The current run produced 48 same-state comparisons, 16 retained failure samples and four split/nonce-grinding studies. Gross output improvement was positive for every measured order, while the assumed 1 gwei gas and USD 3,000 ETH cost made net improvement negative for every tested small-notional case. This is a real product boundary: matching reduced AMM input by 33.19% to 100%, but input compression is not net economic benefit.

The split studies found no nonce-grinding advantage and a 0 to 1 raw-unit disadvantage from splitting in the tested cases. A fixed signed set was permutation-independent. These results constrain only this matrix and do not prove a solver cannot select a more favorable set or execution time.

The machine-readable result is generated at `artifacts/mixed/economics.json`. The historical 82.35% figure remains a specific 100/70 parity input-compression example; it is not a general savings or profitability claim.
