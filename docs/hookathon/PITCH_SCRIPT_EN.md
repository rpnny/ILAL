# ILAL Pitch (English) — approximately 4 minutes 15 seconds

This version is written for a human presenter operating the public npm CLI.
Bracketed lines are stage directions and are not spoken.

> Presenter accuracy note (not spoken): the Hookathon SOEE candidate checks
> current v1 Policy + CNF credentials on each signed netting order. The separate
> V2 demo uses Groth16 Policy Grants and one-time sessions for direct LP / swap.
> Do not say that SOEE netting currently uses the V2 grant/session path.

## 0:00–0:35 — Opening

“AMMs are excellent markets. They are terrible meeting rooms.

When two institutions arrive with opposite orders, the default is surprisingly
primitive: send both orders through public liquidity, pay twice, move the market
twice, and invite MEV to take attendance.

ILAL asks one impolite but profitable question: do these orders actually
disagree?

I’m presenting ILAL — the Institutional Liquidity Access Layer for Uniswap v4.”

## 0:35–1:15 — The mechanism

“ILAL verifies institutional access, atomically nets opposing signed flow, and
sends only the true residual to Uniswap.

Take two orders: one hundred in one direction, seventy in the other. Seventy on
each side settles internally — one hundred and forty of matched gross flow.
Only thirty reaches the AMM.

The Hook does not warehouse assets. The executor cannot choose a friendlier
allocation. Orders are sorted by canonical order hash, settlement goes directly
to the signers, and any failed check rolls back the entire batch.

Public liquidity absorbs imbalance — not organizational drama.”

## 1:15–1:55 — Public CLI and deterministic preview

[Run `ilal --version`.]

“This is the published npm preview: version 0.4.0-v2-poc.7. It is the same CLI a
reviewer can install; this is not a private demo interface.”

[Run the `ilal netting batch preview` command.]

“These are freshly signed testnet orders. The CLI produces the canonical batch
commitment before touching an RPC.

Seventeen thousand units submitted. Fourteen thousand internally matched.
Three thousand residual.

Scaled up, it is the same one-hundred-versus-seventy mechanism: 82.35 percent of
gross AMM exposure is removed before price formation.”

## 1:55–2:35 — Chainlink safety boundary and preflight

[Run the `ilal netting batch preflight` command.]

“Before the executor can broadcast, ILAL pins one Base Sepolia block and checks
every condition against the same snapshot: signatures, deadline, nonce, policy,
balances, allowances, pool state, and the complete execution through
`eth_call`.

Chainlink USDC/USD and USDT/USD feeds form an independent, fail-closed safety
boundary. Stale data, a stablecoin depeg, or excessive pair divergence stops the
batch before nonce consumption or asset movement.

Chainlink is the circuit breaker. Uniswap remains the execution venue and price
source.”

[Point to `status: executable` and `oracle.status: valid`.]

## 2:35–3:10 — Atomic broadcast

[Run `ilal netting batch execute`.]

“Execution performs preflight twice: once before signer access and again
immediately before broadcast. There is no skip flag.

This transaction is permissionlessly submitted through one PoolManager unlock.
The matched flow settles directly between signers, only the residual swaps
against Uniswap, and Hook and Router inventory return to zero.”

[Wait for the receipt, print the BaseScan URL, and open it.]

“That is a new Base Sepolia transaction, not a screenshot and not a simulation.
You can verify the receipt, logs, gas and contracts now.”

## 3:10–3:50 — Measured impact

“The economics are not free, and that matters.

In the measured one-hundred-versus-seventy benchmark, ILAL reduces AMM exposure
by 82.35 percent and improves aggregate output by 4.1197 basis points, while
using 3.57 times the execution gas of the measured direct-v4 baseline.

At the strict ten-thousand-dollar Base anchor, after L2 execution, the full
candidate L1 fee and a 0.5-basis-point solver reserve, ILAL beats the bundled
Universal Router baseline by 4 dollars and 64 cents.

That is not a promise that every trade should use ILAL. It is a supported
operating envelope — and when the economics or safety checks fail, the correct
answer is no.”

## 3:50–4:15 — Proof and close

“The candidate has 282 passing Solidity tests, one hundred thousand stateful
invariant calls, zero rounding dust in the reported sixteen-order study, live
two-, four-, and sixteen-order evidence, and Sourcify exact-match verification.

It is unaudited. It is not production-ready. It is ready for an institutional
pilot.

Verify access. Net what cancels. Send only the residual.

ILAL — because the AMM should see the imbalance, not the drama.”

## Fail-closed contingency — replace the broadcast section if preflight rejects

“Preflight has rejected this batch, so I will not broadcast it. The reason is
shown here, decoded from the onchain simulation.

This is not a demo failure. This is the product refusing to turn stale or unsafe
state into settlement risk. The repository includes already-broadcast successful
two-, four-, and sixteen-order transactions, but I will not misrepresent one of
those historical receipts as a transaction created now.”

Use this contingency only when necessary. A successful live transaction is still
preferred for the final recording.
