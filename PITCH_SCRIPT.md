# ILAL Angel Round Pitch Script

Target length: 7 to 9 minutes.

CEO framing:

> Compliant pools are the wedge. Verified-flow liquidity is the company.

Core line:

> Compliance is the hook. Just prove it and swap.

## 1. Opening

The next trillion dollars of assets will not trade in anonymous pools.

That is the starting point for ILAL.

Institutional capital is moving on-chain, but DeFi liquidity still treats every wallet the same.

That does not work for RWA issuers, regulated funds, or market makers serving institutional order flow.

ILAL is the verified-flow layer for institutional DeFi.

Issuers define eligible flow. Institutions prove privately. Market makers price that verified flow inside Uniswap v4 pools.

We are starting with compliant Uniswap v4 pools. The bigger company is verified-flow liquidity.

## 2. The Economic Inversion

The most important idea is that compliance should not be a tax.

Compliance should become the better deal.

Today, most compliance systems add friction: more checks, more cost, more operational overhead.

ILAL flips that.

If a wallet is verified, it can access lower-fee execution.

If a market maker sees verified flow, it can quote better because counterparty eligibility is known.

If an issuer wants liquidity, it can launch controlled pools without building a custom exchange.

So the pitch is not “we built compliance.”

The pitch is: verified flow gets better liquidity.

## 3. Why Now

The timing is the reason this matters now.

Stablecoins have become real settlement infrastructure. Tokenized assets are growing. Institutions are no longer asking whether assets will move on-chain. They are asking where they can safely trade and settle them.

But execution infrastructure has not caught up.

We have open AMMs, centralized exchanges, and bespoke permissioned venues.

What is missing is a native DeFi layer where verified capital can meet liquidity without giving up privacy, custody, or composability.

Uniswap v4 hooks make this possible now.

## 4. Problem

The problem is not simply compliance paperwork.

The problem is that institutional liquidity has the wrong market structure.

Issuers need controlled liquidity, but they do not want to build custom exchanges.

Institutions need DeFi execution, but they cannot leak identity, strategy, or KYC details on-chain.

Market makers want high-quality flow, but open pools give them no way to price flow quality.

So good issuers, good institutions, and good market makers cannot safely meet in the same AMM.

That is the gap ILAL fills.

## 5. Category Break

We are not building another KYC hook.

That distinction matters.

KYC hooks are bouncers. They allow or deny access.

That is useful, but it is a feature.

ILAL is a market signal.

It does not only ask whether a wallet can pass.

It asks how verified flow should be routed, priced, and incentivized.

That is why this can become a category instead of a single hook.

A gate can be copied.

A verified-flow liquidity network is harder to copy.

## 6. Thesis

Most compliance crypto products treat compliance as friction.

We think compliance can become a liquidity advantage.

Most KYC hooks answer: who can pass?

ILAL answers: if this flow is verified, how should liquidity price it?

That is the wedge.

Verified flow can get lower fees, better routing, and eventually better liquidity incentives.

The hook is not the end product. The hook is how we turn verified flow into a DeFi-native pricing signal.

## 7. Product

The first product is a verified-flow execution lane for Uniswap v4.

There are three sides.

Issuers define eligibility. That can come from KYB, EAS attestations, a private Merkle root, or a future KYC provider.

Institutions prove eligibility privately, mint a soulbound CNF credential, and sign short-lived sessions from their own trading stack.

Liquidity lives in Uniswap v4 pools. The ILAL hook verifies the session and credential before the swap or liquidity action, then applies verified-flow terms.

The trade still happens through Uniswap v4.

ILAL is not a new DEX. It is a verified-flow adapter for institutional execution.

## 8. Session Economics

The key mechanism is the session.

This is where ILAL turns compliance from something expensive into something usable for high-frequency institutional flow.

The old way is to keep re-checking compliance at every touchpoint, or to move the decision into a centralized API.

ILAL does something different.

The wallet proves eligibility once. That creates a CNF credential.

Then the institution signs short-lived EIP-712 sessions locally from its own trading system.

That session binds the user, chain, router, hook, pool, action, deadline, and nonce.

Signing it costs zero gas.

When the trade reaches the hook, the hook checks the cached credential, consumes the nonce, and lets the trade execute through Uniswap v4.

So the claim is not “compliance is free.”

The claim is stronger and more honest:

compliance becomes amortized.

The expensive proof happens once. The execution path becomes cheap enough to route real flow. That is why verified wallets can receive better terms.

## 9. Business Model

Our model is volume-native.

Today, ILALRouter can collect a small protocol fee on verified exact-input swaps. The demo is 0.005%.

This matters because the company scales with verified flow, not SaaS seats.

Near term, we help issuers launch compliant pools and onboard market makers.

Long term, we become the verified-flow routing layer. If multiple issuers and pools exist, ILAL can route eligible institutional order flow to the best verified liquidity.

The economic engine is simple:

More issuers create more verified venues.

More verified venues attract more market makers.

More liquidity attracts more institutional flow.

ILAL monetizes the volume moving through that network.

## 10. Go To Market

The first wedge is not “all institutions.”

The first wedge is RWA issuers and funds that need compliant secondary liquidity.

Our first milestone is one issuer, one market maker, and one real flow loop.

The issuer launches an ILAL-enabled pool.

The market maker supplies liquidity to that verified pool.

An institution or fund wallet routes swaps through the ILAL SDK or CLI path.

Once this loop works, the deployment pattern becomes repeatable: issuer policy, credential path, market maker integration, verified-flow routing.

## 11. Moat

The contract can be copied. The network is harder to copy.

The moat is not just a hook.

It is the issuer graph, the credential graph, market maker integrations, and the verified-flow data that comes from routing institutional order flow.

Every issuer adds policies and eligible wallets.

Every market maker integration increases liquidity quality.

Every institution integration embeds ILAL deeper into execution systems.

Over time, ILAL becomes the place where verified flow knows which liquidity it is allowed to access, and where liquidity knows how to price verified flow.

## 12. Proof

We are early, but we ship.

The v0.3.3 software is a release candidate; the previous Base Sepolia stack is archived and deprecated, and the Safe-controlled replacement is not yet active.

We deployed CNFIssuer, ComplianceHook, PolicyRegistry, ILALRouter, demo tokens, and a Uniswap v4 dynamic-fee pool.

The current source is `@ilalv3/cli@0.3.3-rc.1`. npm `0.3.2` is deprecated and must not be presented as an active deployment client.

The SDK is published as `@ilalv3/sdk`.

We have 188 Solidity tests, 19 CLI tests, and 15 SDK tests passing.

This includes timelocks, slippage protection, session checks, permanent revocation, issuer policy tests, router tests, high-s signature rejection, and fuzz cases.

The demo is not a simulation.

A seeded compliant wallet can mint a CNF through MockEAS, add liquidity, and swap on-chain through ILAL. This public deployment is not the ZK-enabled demo: its verifier and Merkle root are not configured.

A non-compliant wallet is blocked before approve or broadcast.

An issuer can create an attestation with `ilal issuer attest`; the user can mint the CNF themselves; then the trade goes through the same hook-gated path.

That is the full loop: issuer eligibility, user credential, local session, Uniswap v4 execution.

This is unaudited and not production-ready. The contracts and local candidate are executable and fully tested; archived testnet transactions are evidence of prior behavior, not a claim that an active stack exists today.

## 13. Roadmap

The next 90 days are about turning the prototype into institutional pilots.

First, production hardening: external review, better fuzz coverage, deployment tooling, monitoring, and operational runbooks.

Second, real attester integration: connect a KYC or KYB provider while keeping the hook provider-agnostic. The issuer-facing CLI path already exists; the next step is a real design partner wiring their KYC pipeline into `issuer attest`.

Third, issuer pilot: run one controlled RWA or fund liquidity pilot.

Fourth, market maker integration: connect one market-making bot to add liquidity and price verified flow.

The milestone is not more features.

The milestone is one live verified-flow loop.

## 14. The Ask

We are raising a $1 million to $1.5 million angel round to win this wedge.

The capital goes to security review, production hardening, KYC/KYB provider integration, issuer onboarding, and market maker pilots.

The milestone is concrete:

one issuer, one market maker, and one live verified-flow loop.

We are early enough to define the category, and fast enough to own the wedge.

## 15. Close

Compliant pools are the wedge.

Verified-flow liquidity is the company.

The future of finance will not run on anonymous pools.

It will run on verified liquidity: capital that can prove eligibility, market makers that can price flow quality, and issuers that can launch liquid markets without rebuilding exchanges.

ILAL makes compliance the hook.

Just prove it and swap.
