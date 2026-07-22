# ILAL Institutional PoC Readiness

Date: 2026-06-28  
Target: controlled issuer / market-maker proof of concept  
Network: Base Sepolia  
CLI: `@ilalv3/cli@0.2.19`

## Verdict

ILAL is ready for a controlled institutional PoC.

This means a friendly issuer, institution, or market maker can independently install the CLI, point at the Base Sepolia demo stack or deploy a mock stack, issue or receive a CNF, sign a local session, and execute hook-gated swap / liquidity actions.

It does **not** mean ILAL is ready for mainnet production capital. Mainnet still requires third-party audit, issuer governance, operational monitoring, production key management, and real KYC/KYB attester integration.

## What A PoC Can Prove Today

| Claim | PoC Evidence |
|---|---|
| A compliant wallet can trade through ILAL | Seeded CNF wallet passes `ilal demo check` and can execute `ilal swap`. |
| A compliant market maker can add liquidity | `ilal pool add-liquidity` supports hook-gated liquidity actions with session binding. |
| A non-compliant wallet is blocked | CLI preflight rejects missing CNF / missing balances before approve or broadcast. |
| Issuers can issue credentials without ILAL team custody | `ilal issuer attest` lets an issuer backend create an EAS/MockEAS attestation; the user mints their own CNF. |
| Institutions do not need to compile Circom | `ilal credential prove` supports hosted/cached proving artifacts. |
| Trading systems can integrate without using the interactive CLI | `ilal session sign` exports one-time hookData; `ilal swap --hook-data` consumes externally signed hookData. |
| HookData theft is not sufficient to impersonate | Contracts enforce `msg.sender == session.user` and nonce replay protection. |
| Verified flow gets a better deal | Dynamic-fee pool can apply 0.05% verified-flow LP fee; ILAL protocol fee is 0.005% in demo. |

## Required PoC Roles

| Role | Responsibility | Can Be Mocked? |
|---|---|---|
| Issuer owner / backend | Approves eligible wallets and runs `ilal issuer attest`. | Yes, with MockEAS on Base Sepolia. |
| Institutional trader | Mints CNF, signs sessions, swaps through ILALRouter. | No; should use a real test wallet. |
| Market maker | Adds liquidity to the compliant pool and verifies fee / access behavior. | No; should use a real test wallet. |
| Non-compliant control wallet | Confirms blocked path before approve / broadcast. | Yes. |

## Minimal PoC Script

### 1. Install and initialize

```bash
npm install -g @ilalv3/cli@latest
ilal --version
ilal init --force
```

Expected: `0.2.19` or newer.

### 2. Check seeded demo readiness

```bash
ilal demo check --wallet 0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58
```

Expected: infrastructure ready, wallet ready, transaction ready.

### 3. Issuer attests a new user

```bash
PRIVATE_KEY=0xIssuerKey ilal issuer attest \
  --wallet 0xUserWallet \
  --expires-in-days 365
```

Expected: attestation transaction succeeds and returns a UID.

### 4. User mints CNF

```bash
PRIVATE_KEY=0xUserKey ilal credential mint --attestation <uid>
ilal status --wallet 0xUserWallet
```

Expected: CNF exists, `isValid() = true`, credential type matches pool policy.

### 5. User signs a local session

```bash
PRIVATE_KEY=0xUserKey ilal session sign --action swap
```

Expected: zero-gas EIP-712 authorization binding user, chain, router, hook, pool, action, deadline, and nonce.

### 6. User swaps

```bash
PRIVATE_KEY=0xUserKey ilal swap \
  --amount-in 1 \
  --token-in 0x5F6556DF0260A6Bc3613356CAC3c01f727578774 \
  --unsafe-no-slippage # Base Sepolia demo only
```

Expected: preflight passes, hook gate passes, swap transaction confirms.

### 7. Market maker adds liquidity

```bash
PRIVATE_KEY=0xMarketMakerKey ilal pool add-liquidity \
  --tick-lower -600 \
  --tick-upper 600 \
  --liquidity 1000000000000 \
  --max-amount-0 <quotedMaximumRaw0> \
  --max-amount-1 <quotedMaximumRaw1>
```

Expected: preflight passes, hook gate passes, liquidity transaction confirms.

### 8. Non-compliant wallet is blocked

```bash
PRIVATE_KEY=0xFreshWalletKey ilal swap \
  --amount-in 1 \
  --token-in 0x5F6556DF0260A6Bc3613356CAC3c01f727578774 \
  --unsafe-no-slippage # Base Sepolia demo only
```

Expected: no CNF / insufficient readiness error; no approve; no broadcast.

## Acceptance Gates

| Gate | Required For PoC | Current Status |
|---|---:|---|
| Published CLI install | Yes | PASS: `@ilalv3/cli@0.2.19`. |
| Demo stack config | Yes | PASS: `.ilal.json` / `ilal init` point to Base Sepolia demo. |
| Issuer attestation path | Yes | PASS: `ilal issuer attest`. |
| User credential mint path | Yes | PASS: `ilal credential mint`. |
| Swap path | Yes | PASS: `ilal swap`. |
| Liquidity path | Yes | PASS: `ilal pool add-liquidity`. |
| External hookData path | Yes | PASS: `ilal session sign` + `ilal swap --hook-data`. |
| Non-compliant block path | Yes | PASS: preflight blocks before tx. |
| Security test checklist | Yes | PASS: `audit/ILAL_FULL_TEST_CHECKLIST.md`. |
| Formal third-party audit | No for PoC, yes for mainnet | OPEN. |
| Mainnet governance / multisig | No for PoC, yes for mainnet | OPEN. |
| Real KYC/KYB partner integration | Optional for first PoC, required for production pilot | OPEN / partner-dependent. |

## Known PoC Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Testnet liquidity is shallow | Repeated one-sided swaps can move price to boundary. | Rebalance pool or add wider-range liquidity before demos. |
| MockEAS is not a real KYC provider | Good for PoC mechanics, not regulatory reliance. | Replace with issuer-controlled EAS/schema or KYC/KYB attester. |
| Contracts are not formally audited | Not suitable for production capital. | Use testnet only until third-party audit is complete. |
| Owner keys are testnet operational keys | Not production governance. | Mainnet requires multisig/timelock ownership. |
| ZK verifier/circuit needs formal review | Verifier works in demo, but proof system requires dedicated review. | Freeze artifact hashes and include circuit/verifier review in audit. |

## PoC Positioning

Use this sentence with issuers and market makers:

> ILAL does not replace your KYC process. You keep the issuer decision, ILAL turns that decision into a private credential and enforces it at Uniswap v4 execution time, where verified flow can receive better terms.

Use this sentence with investors:

> The PoC proves the core loop: issuer eligibility, user-controlled credential, local session authorization, hook-gated Uniswap v4 execution, and non-compliant wallet rejection before transaction broadcast.

## Go / No-Go

| Outcome | Decision |
|---|---|
| Demo day / UHI technical judging | GO |
| Friendly issuer design partner PoC | GO |
| Market maker testnet integration | GO |
| Mainnet pilot with real value | NO-GO until audit, governance, monitoring, and real attester integration |
