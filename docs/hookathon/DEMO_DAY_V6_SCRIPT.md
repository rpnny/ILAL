# ILAL Demo Day V6 — Demo-first Script & Operations

Target: **4:25–4:35**. Hard stop: **4:45**. Use a human voice.

## Before recording

- Open the deck at `http://127.0.0.1:4175/docs/hookathon/ilal-soee-demo-day-v6.html`.
- Open `http://127.0.0.1:4173/app.html` in the next tab, connected to Base Sepolia.
- Open the confirmed SOEE transaction in a third tab: `0x6c2dbee372a3a88e0e8fe4e5cd15bf64389a9a4e6ebc6f03cce15ba0e620c72a`.
- Keep a matchable opposite order prepared. Do not wait for a new counterparty or testnet block on camera.
- Press `F` for fullscreen. Use `→` / Space to advance. Press `N` to show notes during rehearsal only.

## 01 — Cover · 0:00–0:15

> Why send 170 units into the market when the real imbalance is only 30? Two verified institutions want opposite trades. ILAL settles what cancels and sends only the imbalance to Uniswap v4.

## 02 — The entire why · 0:15–0:42

> The rails are already large: roughly four trillion dollars of Uniswap volume, 12.7 trillion dollars of adjusted stablecoin value in the first half of 2025, and more than ten billion dollars in tokenized Treasuries. Yet institutional controls still sit around the trade, not inside final execution. That is the entire why. Now the how.

## 03 — Two ILAL layers · 0:42–1:05

> ILAL has two independent candidates today. Session answers who may act: prove policy once and reuse a short-lived scoped grant. SOEE answers how a group executes: verify signed orders, net opposite directions atomically and route only the imbalance to v4. Today I am demonstrating SOEE.

## 04 — How the institution operates · 1:05–1:30

> An institution does not need to trade in the Uniswap consumer interface. Its treasury system uses our SDK or CLI. It defines the order, signs locally, and keeps custody. A solver discovers eligible opposite flow and chooses when and which orders to submit. But settlement happens only if the Router and Hook can enforce every signed bound atomically.

## 05 — What the institution signs · 1:30–1:55

> This is the important boundary. The institution signs the pool, side, amount, minimum output, maximum AMM input, deadline and nonce. The solver may choose batch membership and timing, but cannot change those fields. The Hook verifies and enforces them. Authority to submit is not authority to decide.

## 06 — 100 / 70 netting · 1:55–2:20

> Now the mechanism. Institution A signs one hundred units in one direction. Institution B signs seventy in the other. Seventy matches seventy, so one hundred forty gross units settle internally. Only the thirty-unit imbalance moves the Uniswap curve—an 82.35 percent reduction in gross AMM exposure.

## 07 — Under the hood · 2:20–2:45

> For the same fixed signed set, permutation cannot change the batch ID, allocation or pool result. Policy, CNF and the Chainlink batch-opening circuit breaker run before movement. The Hook nets opposing flow with before-swap deltas, and v4 handles one residual exact-input leg. The solver still chooses membership and timing; it never rewrites a signed order.

## 08 — Economics · 2:45–3:10

> The tradeoff is explicit. The canonical case cuts AMM exposure by 82.35 percent and improves aggregate output by 4.12 basis points, but local execution gas is 3.57 times higher. The premium is 485,401 gas. So we show a sensitivity range instead of pretending ETH has one permanent price. At one gwei, the modeled break-even anchor ranges from about 1,387 dollars at a two-thousand-dollar ETH to 2,774 dollars at four thousand. This is a benchmark, not a forecast.

## 09 — Operate the institution app · 3:10–4:00

> This is not a consumer DEX. It is a local simulation of the treasury interface an institution would build on the ILAL CLI or SDK.

Operate in this order:

1. Keep **Netting** selected.
2. Point to `You pay`, `You receive at least`, expected internal match and maximum market exposure.
3. Click **Review institutional swap**.
4. Point to Policy, CNF, nonce, deadline and signed execution limits.
5. Sign the bounded order locally.
6. Show `Matched · ready to settle` or the prepared settlement review.
7. Switch to the confirmed BaseScan transaction instead of waiting for new testnet execution.

During the operation:

> The institution chooses the side, size, minimum output and maximum AMM exposure. It signs locally. The solver can pair this with eligible opposite flow, but cannot rewrite the limits. Preflight checks policy, CNF, price-reference safety, nonce and deadline before broadcast. Instead of waiting for a testnet block, here is the confirmed settlement.

Return to slide 10.

## 10 — Public proof · 4:00–4:18

> This successful Base Sepolia transaction settles two signed orders atomically. In this equal-decimal test-token PoC, 0.17 raw-unit flow is submitted, 0.14 is internally matched and only 0.03 reaches the AMM. Both nonces are consumed, user limits hold, and protocol inventory returns to zero.

## 11 — Close · 4:18–4:30

> ILAL does not create another liquidity venue. It provides a working path toward institution-ready execution on existing Uniswap liquidity. Verify access. Net what cancels. Send only the residual. This is an unaudited Base Sepolia candidate.

Stop immediately.

## Failure fallback

- If the order waits for a match, show the waiting state for no more than three seconds, explain that an eligible opposite order is required, and switch to BaseScan.
- If MetaMask does not appear, do not refresh. Switch directly to the confirmed transaction.
- If BaseScan loads slowly, return to slide 10; the hash and outcome are already visible.
- If the clock reaches 4:15 before the closing slide, skip the transaction details and deliver the final four sentences.

## Claims that must remain precise

- Session and SOEE are separate Base Sepolia candidates today.
- For the same fixed signed order set, permutation cannot change the batch ID, allocation or pool result. The solver still chooses batch membership and timing.
- Canonical sequential allocation is not pro-rata and is not claimed to be strategy-proof.
- Chainlink is the batch-opening circuit breaker, not the execution price.
- hUSDT is an ILAL test representation; the USDT/USD feed is not claimed as its market price.
- The current netting candidate is an exact-input, equal-decimal ERC20 stablecoin PoC with raw-unit 1:1 internal matching and zero netting fee.
- Current software is unaudited Base Sepolia software, not production-ready.
- Existing confirmed transactions must not be described as newly broadcast during recording.
- Market figures are adjacent market signals, not ILAL TAM.
