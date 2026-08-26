# ILAL UHI10 Pitch + Manual CLI Demo (English)

Target runtime: **4 minutes 15 seconds**. The script is written for a live,
presenter-controlled terminal. Commands are executed manually; no automated
demo runner is required.

The timing assumes the two ephemeral signed order files are prepared before
recording by following sections 0 and 1 of the
[manual CLI guide](CLI_DEMO_GUIDE_ZH.md). Keep that guide open beside the
terminal as the recovery runbook.

## Claim discipline

Use the following language precisely:

- `82.35%` is the measured reduction in **gross AMM exposure** for the tested
  `100 / 70` scenario. It is not a universal price-impact or LP-loss claim.
- `$4.64345` is the measured net benefit at the fixed `$10,000 / 70% / 5 bps`
  Base benchmark after the modeled execution cost, measured L1 security fee
  and solver reserve. Do not linearly extrapolate it to `$1 million`.
- ILAL does not make all MEV impossible and does not hide public calldata. It
  removes internally matched flow from the pool-level price-impact and MEV
  surface; only the residual traverses the AMM curve.
- Permissioned Pools and ILAL are strategically complementary. The current
  candidate is not presented as a deployed integration with Superstate,
  Securitize or their pools.
- The candidate is unaudited, Base Sepolia-only and ready for an institutional
  pilot—not production-ready.

## Before recording

Complete sections 0 and 1 of the manual guide, leaving the two order JSON files
in `$ILAL_PITCH_TMP`. Then clear the terminal. Do not expose a private key,
shell history or environment dump.

Keep these pages available as optional visual evidence:

- [Base Sepolia forward transaction](https://sepolia.basescan.org/tx/0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998)
- [Chainlink-guarded Hook exact match](https://sourcify.dev/server/v2/contract/84532/0x8d1fA43F848701b2adB105D5c925A9247E600088)
- [Oracle Guard exact match](https://sourcify.dev/server/v2/contract/84532/0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3)

## 0:00–0:34 — Opening: execution risk in plain sight

**Visual:** Title slide. Show the date and three figures: `$50.4M`, `~$36K`,
`~$10M MEV`.

> March 12, 2026. A wallet attempted an onchain collateral swap worth roughly
> fifty million dollars. It received about thirty-six thousand dollars of
> AAVE. The route hit shallow liquidity, and analyses estimated that an MEV
> operator captured about ten million dollars.
>
> This was not a smart-contract exploit. It was execution risk, in plain
> sight.
>
> I am presenting ILAL: the Institutional Liquidity Access Layer for Uniswap
> v4.

## 0:34–1:03 — The window: permission is necessary, execution still matters

**Visual:** `WHO MAY TRADE?` on the left, `HOW SHOULD THEY EXECUTE?` on the
right.

> Citi estimates tokenized assets at about seventeen billion dollars today;
> its base case reaches five-point-five trillion by 2030. Uniswap's
> Permissioned Pools bring compliant market access to v4 with launch partners
> including Superstate and Securitize.
>
> That answers **who may trade**. It does not optimize **how verified,
> opposing flow executes**.
>
> AMMs are excellent markets. But with offsetting orders, they are an expensive
> way to discover that two institutions should have met first.

## 1:03–1:35 — The mechanism: net first, expose only the residual

**Visual:** Animate `100 →` against `← 70`, then `140 matched` and `30 → v4`.

> ILAL lets verified orders meet before they move the pool.
>
> One institution submits one hundred units. Another submits seventy in the
> opposite direction. Inside one `PoolManager.unlock`, ILAL verifies signed
> limits and policy, sorts by order hash, and matches seventy on each side.
> One hundred forty units settle internally. Only the residual—thirty—reaches
> the Uniswap curve through `beforeSwapReturnDelta`.
>
> No solver custody. No protocol inventory. No half-completed batch.

## 1:35–2:55 — Live terminal demo

### 1:35–1:53 — Preview the signed batch

**Terminal:**

```bash
node cli/dist/index.js netting batch preview \
  --orders "$ILAL_PITCH_TMP/order-a.json" "$ILAL_PITCH_TMP/order-b.json"
```

> These are independently signed, bounded orders. The CLI sorts by order hash:
> one hundred seventy million raw units submitted, one hundred forty million
> matched, and thirty million left for the AMM—an eighty-two-point-three-five
> percent reduction in gross AMM exposure.

### 1:53–2:10 — Read the live Chainlink circuit breaker

**Terminal:**

```bash
cast call 0x1dEc06Bd8d43E37c855767326864BEe0Ae6199D3 \
  'validate()((uint256,uint256,uint256,uint256,bool))' \
  --rpc-url "$ILAL_PITCH_RPC"
```

> Before nonce or asset mutation, the Hook checks two Chainlink dollar feeds
> and the pool tick. Chainlink is a circuit breaker, not the execution price.
> Stablecoins sometimes develop creative opinions about one dollar; ILAL fails
> closed when they do.

### 2:10–2:25 — Show the pinned preflight

**Terminal:**

```bash
jq '.batches.forward010By007.preflight' \
  docs/hookathon/chainlink-candidate-manifest.json
```

> This pinned snapshot passed signatures, deadlines, nonces, policy, balances,
> allowances, oracle state, pool state and a complete `eth_call` before
> broadcast.

### 2:25–2:39 — Query the live receipt

**Terminal:**

```bash
cast receipt \
  0x91770caae1cd596f5974e88997cff364c925b78924cda781026144595c130998 \
  --rpc-url "$ILAL_PITCH_RPC" | \
  awk '/^(blockNumber|gasUsed|status|transactionHash)[[:space:]]/{print}'
```

> This is the successful Base Sepolia receipt. We also recorded two-, four- and
> sixteen-order evidence with exact-match source verification.

### 2:39–2:55 — Prove rejection is atomic

**Terminal:**

```bash
forge test --root contracts \
  --match-path test/InstitutionalNetting.t.sol \
  --match-test test_oracleRejectionHappensBeforeNonceOrAssetMutation -vv
```

> When the oracle boundary fails, balances stay unchanged, nonces remain
> unused, context closes, and Hook inventory stays zero. In institutional
> settlement, "almost atomic" is another spelling of "no."

## 2:55–3:25 — The measured impact

**Visual:** Show three evidence cards: `82.35%`, `$4.64345`, `0 dust`.

> Three measured results matter.
>
> First, eighty-two-point-three-five percent less gross flow traversed the AMM
> curve in the `100 / 70` test.
>
> Second, at the ten-thousand-dollar Base anchor, after execution cost, L1 fee
> and solver reserve, ILAL beat the cheapest full-fill Universal Router
> baseline by four dollars and sixty-four cents. ILAL is not economical for
> every batch. Preflight should say no when the economics say no.
>
> Third, tested sixteen-order scenarios produced zero rounding dust and
> permutation-stable commitments.

## 3:25–3:52 — Why this matters to Uniswap and UHI10

**Visual:** `Permissioned access + residual-only execution` above the UHI10
theme `The Fair Flow Frontier`.

> For Uniswap, ILAL complements permissioned market access. Permissioning
> decides who enters. ILAL reduces how much verified gross flow must touch
> public liquidity.
>
> UHI10 asks for sustainable liquidity and MEV protection. ILAL does not claim
> public calldata disappears. It makes a provable guarantee: internally
> matched flow never traverses the AMM curve. Only genuine imbalance creates
> pool-level price impact and the associated MEV surface.

## 3:52–4:15 — Close

**Visual:** Base Sepolia, `282 Solidity tests`, `100,000 invariant calls`,
`institutional pilot candidate`.

> ILAL is live on Base Sepolia. Two-, four- and sixteen-order batches executed.
> Two hundred eighty-two Solidity tests and one hundred thousand invariant
> calls pass. Its source is exact-match verified.
>
> Unaudited. Not production-ready. Ready for an institutional pilot.
>
> Public liquidity should absorb imbalance—not unnecessary gross flow. Verify
> access. Net what cancels. Send only the residual to Uniswap.
>
> ILAL. Let the AMM trade the truth.

## Source notes for judges

These links support external claims in the spoken script. They are not claims
of partnership or endorsement.

- March 2026 execution incident: [Talos, *A $50M DEX Swap With a $36K
  Outcome*](https://www.talos.com/insights/state-of-the-network-355).
- Tokenization forecast: [Citi, *Tokenization 2030*](https://www.citigroup.com/global/insights/tokenization-2030).
- Permissioned Pools and launch partners: [Uniswap Labs,
  *Introducing Permissioned Pools on Uniswap v4*](https://blog.uniswap.org/es-ES/introducing-permissioned-pools-on-uniswap-v4).
- UHI10 theme: [Atrium Academy, *Uniswap Hook Incubator 2025
  Wrapped*](https://blog.atrium.academy/uniswap-hook-incubator-2025-wrapped).
- ILAL measurements and limitations: [complete test data report
  (Chinese)](../research/ILAL_COMPLETE_TEST_DATA_REPORT_ZH.md) and
  [institutional stress and value report
  (English)](../research/ILAL_INSTITUTIONAL_STRESS_VALUE_REPORT_EN.md).

## Delivery notes

- Practice at `135–145` spoken words per minute. The terminal waits are part of
  the 4:15 runtime.
- Do not read headings, stage directions, code or source notes aloud.
- If the public RPC stalls, skip the live Chainlink call and receipt lookup;
  show the recorded manifest and continue. Do not spend pitch time debugging.
- Keep the opening sober. The humor belongs in the AMM, stablecoin and atomicity
  lines—not in the description of the loss event.
- Use a human voice and keep the final submission within the official time
  limit.
