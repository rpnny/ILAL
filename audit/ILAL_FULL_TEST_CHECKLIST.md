# ILAL Full Product & Security Test Checklist

> Status notice (2026-07-22): v0.3.3 has an active Safe-controlled Base Sepolia demo manifest. References to v0.3.2 remain historical and must not be reused.

Version: v0.2.x  
Network: Base Sepolia / local fork  
Audience: issuer design partners, security reviewers, audit teams, demo-day technical judges

## Scope

This checklist tests ILAL from three angles:

1. **Customer behavior** — issuer, institution, market maker, and pool operator flows.
2. **Product reliability** — CLI onboarding, preflight, error UX, npm install path, config behavior.
3. **Security/adversarial behavior** — unauthorized access, stolen sessions, replay, wrong bindings, signature malleability, policy mismatch, expiry, and liquidity edge cases.

This is not a replacement for a formal audit. It is a structured acceptance and adversarial test plan for validating the current testnet product before issuer pilots.

## Test Roles

| Role | Description | Example Wallet |
|---|---|---|
| Issuer Owner | Controls issuer attestation flow / EAS issuer key | Goldfinch backend signer |
| Compliant Institution | User that receives EAS attestation, mints CNF, trades | NorthBridge Capital |
| Market Maker / LP | Adds liquidity to verified-flow pool | Atlas Market Making |
| Non-Compliant Wallet | Has no CNF, should be blocked | Unknown Wallet |
| Attacker | Attempts replay, stolen hookData, wrong chain, wrong pool, etc. | Separate funded test wallet |

## Required Evidence Format

For each test, record:

| Evidence | Required |
|---|---|
| CLI version | `ilal --version` |
| Config | `.ilal.json` addresses |
| Wallet | address used |
| Command | exact command run |
| Result | pass/fail |
| Tx hash | if transaction is broadcast |
| Block number | if transaction succeeds |
| Error message | if blocked/reverted |
| Notes | explanation if behavior is expected |

---

# A. Environment & Install Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| A1 | Fresh npm install | `npm install -g @ilalv3/cli@latest` | Installs without build errors | High | npm output |
| A2 | Version check | `ilal --version` | Prints expected latest version | Medium | version output |
| A3 | Init config | `ilal init --force` | Creates `.ilal.json` with current demo addresses | High | config file |
| A4 | Demo readiness | `ilal demo check --wallet <seeded_wallet>` | Infrastructure 100%, wallet 100%, tx ready | High | CLI output |
| A5 | Non-seeded wallet readiness | `ilal demo check --wallet <fresh_wallet>` | Infra ready, wallet not ready; no false "ready for tx" | High | CLI output |
| A6 | Bad private key format | `PRIVATE_KEY=<no_0x> ilal status` | Clear error: key must include `0x` | Medium | error output |
| A7 | Missing config | Run command outside config dir | CLI asks for required addresses or `ilal init` | Medium | error output |
| A8 | RPC override | Run with `--rpc <url>` | Reads same chain state through custom RPC | Medium | CLI output |

---

# B. Issuer Onboarding Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| B1 | Create issuer standard | `ilal issuer create --standard "Goldfinch Accredited Investor"` | Returns deterministic `standard_id` / `credentialType` | High | CLI output + `.ilal-issuer-standards.json` |
| B2 | Set jurisdiction | `ilal issuer set-jurisdiction --allow US,EU,SG` | Standard profile updated | Medium | JSON file |
| B3 | Set investor type | `ilal issuer set-type --accredited-only true` | Standard profile updated | Medium | JSON file |
| B4 | Query standard | `ilal issuer get` | Shows standard, jurisdictions, accredited flag, credentialType | Medium | CLI output |
| B5 | Unknown standard lookup | `ilal issuer get --id 0x...bad` | Clear "unknown standard" error | Low | error output |
| B6 | Invalid jurisdiction input | `ilal issuer set-jurisdiction --allow ""` | Clear validation error | Low | error output |
| B7 | Invalid accredited flag | `ilal issuer set-type --accredited-only maybe` | Clear validation error | Low | error output |
| B8 | Issuer attest using configured issuer | `PRIVATE_KEY=<issuer_key> ilal issuer attest --wallet <user>` | EAS/MockEAS attestation tx succeeds and UID is returned | Critical | tx hash + UID |
| B9 | Issuer attest with explicit EAS/schema | `ilal issuer attest --wallet <user> --eas <addr> --schema <uid>` | Uses provided EAS/schema | High | tx hash + UID |
| B10 | Attest without issuer/eas | `ilal issuer attest --wallet <user>` in empty config | Clear error: EAS required | Medium | error output |
| B11 | Non-owner MockEAS attest | Run `issuer attest` with wrong key on MockEAS | Reverts with owner/authorization error | High | error output |
| B12 | Attestation expiry setting | `--expires-in-days 1` | EAS attestation has expected expiration | Medium | EAS read / tx logs |

---

# C. User Credential Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| C1 | User mints CNF from issuer attestation | `PRIVATE_KEY=<user_key> ilal credential mint --attestation <uid>` | CNF minted, `isValid() = true` | Critical | tx hash + status |
| C2 | Mint simulation | `ilal credential mint --attestation <uid> --simulate` | Verifies attestation without tx | Medium | CLI output |
| C3 | Wrong recipient tries mint | Different wallet uses another user's UID | Blocked before or reverted by contract | Critical | error output |
| C4 | Reuse attestation UID | Same user mints twice with same UID | Reverted: already used / credential exists | Critical | error output |
| C5 | Expired attestation | Mint after attestation expiration | Rejected | High | error output |
| C6 | Revoked attestation | Mint with revoked UID | Rejected | High | error output |
| C7 | Wrong schema | Attestation schema != issuer `schemaUID()` | Rejected by CNFIssuer | Critical | error output |
| C8 | Wrong attester | Attestation attester != issuer `trustedAttester()` | Rejected by CNFIssuer | Critical | error output |
| C9 | Credential status valid | `ilal credential status <wallet>` | Shows token id, valid, expiry | Medium | CLI output |
| C10 | Credential status missing | `ilal credential status <fresh_wallet>` | Shows missing and explains issuer attest path | Medium | CLI output |
| C11 | CNF renewal | `ilal credential renew --attestation <fresh_uid>` | Extends expiry | Medium | tx hash + status |
| C12 | Revoked/permanently banned wallet renew attempt | Owner revokes, wallet tries renew | Rejected | Critical | error output |

---

# D. ZK Credential Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| D1 | Hosted artifact download | `ilal credential prove --wallet <wallet>` without local circuits | Downloads/caches artifacts | High | cache files + CLI output |
| D2 | Offline artifact mode | `--offline --artifact-cache <path>` | Uses local cache, no network download | Medium | CLI output |
| D3 | Missing artifact offline | `--offline` with empty cache | Clear error | Medium | error output |
| D4 | ZK root helper | `ilal credential zk-root --wallet <wallet> --expires-at <ts>` | Prints root and public input hashes | Medium | CLI output |
| D5 | Proof mint with matching root | `credential prove` after issuer root configured | CNF minted | Critical | tx hash |
| D6 | Proof with wrong root | root mismatch | Rejected with root mismatch | Critical | error output |
| D7 | Proof for wrong wallet | Use proof generated for A from wallet B | Rejected by wallet hash check | Critical | error output |
| D8 | Expired proof public input | expiresAt <= now | Rejected | High | error output |

---

# E. Session Signing Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| E1 | Sign swap session | `ilal session sign --action swap` | Produces hookData, 0 gas | High | CLI output |
| E2 | Sign add-liquidity session | `--action addLiquidity` | Produces hookData action=2 | High | CLI output |
| E3 | Config-derived chainId | Omit `--chain` after `ilal init` | chainId matches `.ilal.json` | High | decoded hookData |
| E4 | Wrong action input | `--action foo` | Clear validation error | Medium | error output |
| E5 | TTL expiry | Sign `--ttl 1`, wait, use hookData | Rejected as expired | High | error output |
| E6 | External hookData swap | `ilal swap --hook-data <valid>` | Uses supplied hookData, does not re-sign | High | tx / nonce evidence |
| E7 | High-s external hookData | Submit malleable signature | CLI rejects locally or contract reverts | High | error output |
| E8 | Invalid signature bytes | Mutate signature | Rejected | Critical | error output |

---

# F. Compliant Institution Trading Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| F1 | Fund user with demo tokens | `ilal demo faucet --wallet <user>` | TOKA/TOKB minted | Medium | tx hash |
| F2 | Swap happy path | `PRIVATE_KEY=<user> ilal swap --amount-in 0.001 --token-in <token>` | Swap succeeds through ILALRouter | Critical | tx hash + block |
| F3 | Swap without an output floor | Omit both slippage flags | CLI refuses before approve/broadcast | High | preflight output |
| F4 | Swap with impossible minAmountOut | `--min-amount-out <huge>` | Reverts with slippage protection | High | error output |
| F4b | Explicit testnet opt-out | `--unsafe-no-slippage` | Runs only after a visible unsafe warning | Medium | CLI output |
| F5 | External signed session execution | Sign hookData, execute with `--hook-data` | Succeeds once | High | tx hash |
| F6 | Replay same hookData | Reuse same hookData | Rejected by nonce bitmap | Critical | error output |
| F7 | Swap after CNF expiry | Wait or deploy short TTL issuer; then swap | Rejected by hook | Critical | error output |
| F8 | Swap after revocation | Owner revokes CNF; user swaps | Rejected by hook | Critical | error output |
| F9 | Pool price boundary | Repeated one-sided swaps push price to limit | CLI/tx reports price-limit/liquidity condition; not mistaken for credential failure | Medium | error output |

---

# G. Market Maker / LP Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| G1 | Add liquidity happy path | `ilal pool add-liquidity --tick-lower -600 --tick-upper 600 --liquidity <safe> --max-amount-0 <raw0> --max-amount-1 <raw1>` | Liquidity added through hook within spend bounds | Critical | tx hash |
| G2 | Add liquidity without CNF | LP wallet has no CNF | Blocked before approve/broadcast | Critical | CLI output |
| G3 | Add liquidity with no token balance | CNF valid but zero token balance | Preflight rejects | High | CLI output |
| G4 | Add liquidity with huge amount | Amount exceeds balances / range economics | Reverts or preflight detects; error is understandable | Medium | error output |
| G5 | Wide tick range | Add liquidity with broad active range | Succeeds if amount safe | Medium | tx hash |
| G6 | Remove liquidity happy path | Remove previously added liquidity | Succeeds | High | tx hash |
| G7 | Remove with wrong session action | Use swap hookData for remove | Rejected action mismatch | Critical | error output |
| G8 | Position salt collision / reuse | Add same tick range with same salt twice | Expected v4 behavior documented; no credential bypass | Medium | tx/output |
| G9 | Add exceeds currency0/1 maximum | Set a maximum below the real PoolManager delta | Router reverts before settlement | Critical | revert selector |
| G10 | Remove returns below currency0/1 minimum | Set a minimum above the real PoolManager delta | Router reverts atomically | Critical | revert selector |

---

# H. Non-Compliant Wallet Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| H1 | No CNF swap | `ilal swap` from no-CNF wallet | Blocked before approve/broadcast | Critical | CLI output |
| H2 | No CNF add liquidity | `ilal pool add-liquidity` | Blocked before approve/broadcast | Critical | CLI output |
| H3 | Funded but no CNF | Faucet tokens to no-CNF wallet, then swap | Still blocked by CNF missing | Critical | CLI output |
| H4 | Approved but no CNF | Preapprove router manually, then swap | Still blocked | Critical | error output |
| H5 | CNF on different issuer | Wallet has CNF from issuer A, pool requires issuer B | Rejected by policy/issuer mismatch | Critical | error output |
| H6 | Wrong credential type | CNF valid but pool requires different credentialType | Rejected | Critical | error output |

---

# I. Policy Registry Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| I1 | Read policy | `ilal pool policy get --pool <id>` | Shows issuer, credentialType, enabled | High | CLI output |
| I2 | Owner sets policy | `pool policy set` with owner key | Policy registered | Critical | tx hash |
| I3 | Non-owner sets owner-only policy | Wrong key | Rejected | Critical | error output |
| I4 | Registered issuer self-service policy | Registered issuer calls self-service overload | Policy binds msg.sender as issuer | High | tx hash |
| I5 | Unregistered issuer self-service | Unregistered issuer attempts | Rejected | High | error output |
| I6 | Disable policy | Owner disables policy | Hook rejects swaps/add liquidity | Critical | tx + failed swap |
| I7 | Policy issuer mismatch | Pool policy issuer != CNF issuer | Rejected by hook | Critical | error output |
| I8 | Policy credential mismatch | Pool policy type != CNF type | Rejected by hook | Critical | error output |

---

# J. Direct Contract / Bypass Tests

| ID | Attack | Method | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| J1 | Direct hook call | EOA calls `beforeSwap` | Reverts `OnlyPoolManager` | Critical | cast output |
| J2 | Direct PoolManager bypass to avoid router | Attempt swap not through authorized router | Hook rejects `RouterNotAuthorized` | Critical | error output |
| J3 | Wrong router | Use old/unapproved router address | Hook rejects | Critical | error output |
| J4 | Router with wrong hook | Router call using different hook address in PoolKey | Rejected hook/pool mismatch or v4 invalid pool | Critical | error output |
| J5 | Direct CNFIssuer mint with fake UID | Call `mintWithEAS(0xdead...)` | Rejected: attestation not found/wrong schema | Critical | error output |
| J6 | Direct CNFIssuer proof with fake proof | Call `mintWithProof` with fake proof | Rejected | Critical | error output |
| J7 | Native ETH transfer to router | Send ETH to router | Rejected / no stuck ETH path | Medium | tx/error |
| J8 | Exact output swap | Positive amountSpecified | Rejected if unsupported | Medium | error output |

---

# K. Session Attack Tests

| ID | Attack | Method | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| K1 | Stolen hookData, no-CNF attacker | Attacker uses victim hookData | Rejected; ideally `SessionUserMismatch` | Critical | error output |
| K2 | Stolen hookData, attacker has own CNF | Compliant B uses A's hookData | Rejected `SessionUserMismatch` | Critical | error output |
| K3 | Replay | Submit same hookData twice | First may succeed, second rejected `NonceAlreadyUsed` | Critical | tx + error |
| K4 | Wrong caller binding | Change authorizedCaller | Rejected | Critical | error output |
| K5 | Wrong hook binding | Change verifyingHook | Rejected | Critical | error output |
| K6 | Wrong pool binding | Change poolId | Rejected | Critical | error output |
| K7 | Wrong chain binding | chainId 8453 on Base Sepolia | Rejected | Critical | error output |
| K8 | Wrong action binding | Use addLiquidity session for swap | Rejected | Critical | error output |
| K9 | Expired deadline | Submit after deadline | Rejected | High | error output |
| K10 | High-s signature malleability | Construct `(r, n-s, v^1)` | Rejected by low-s enforcement | High | error output |
| K11 | Invalid v value | v not 27/28 | Rejected | High | error output |
| K12 | Short signature | Signature length != 65 | Rejected | High | error output |

---

# L. Fee / Economics Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| L1 | Verified LP fee override | Swap in dynamic fee pool | Hook applies 0.05% verified-flow fee | High | event / output |
| L2 | Static fee pool | Swap in non-dynamic pool | No override applied | Medium | event/output |
| L3 | Protocol fee calculation | Swap known amount | Protocol fee = amountIn * feePips / 1e6 | High | treasury balance delta |
| L4 | Dust fee rounding | Swap tiny amount | May round protocol fee to zero; documented as economically non-viable | Low | tx/output |
| L5 | Treasury transfer | Swap with nonzero protocol fee | Treasury receives tokenIn fee | High | token balance diff |
| L6 | Exact output unsupported | Try exactOutput | Rejected clearly | Medium | error output |
| L7 | LP fee claim in CLI | CLI says 0.05% only when dynamic fee configured | No misleading output | Medium | CLI output |

---

# M. Admin / Governance Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| M1 | Propose Merkle root | `ilal oracle propose-root --root <root>` | Queued behind 48h timelock | Critical | tx + pendingRoot |
| M2 | Activate root too early | `activate-root` before delay | Rejected | Critical | error output |
| M3 | Activate root after delay | after timelock | Root updates | Critical | tx + merkleRoot |
| M4 | Propose verifier | `propose-verifier` | Queued behind 72h timelock | Critical | tx + pendingVerifier |
| M5 | Activate verifier too early | before delay | Rejected | Critical | error output |
| M6 | Non-owner proposes root | wrong key | Rejected | Critical | error output |
| M7 | Revoke credential | owner calls revoke | Wallet invalid immediately | Critical | tx + status |
| M8 | Renew after revoke | revoked wallet renew attempt | Rejected due permanent ban | Critical | error output |
| M9 | Set ZK public input hashes | owner sets hashes | Values update | Medium | tx + reads |

---

# N. CLI UX / Reliability Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| N1 | Human-readable amounts | Swap output | Shows token units first, wei in parentheses | Low | CLI output |
| N2 | Allowance display | Max allowance | Shows `unlimited (MAX)`, not huge raw number | Low | CLI output |
| N3 | Preflight progress | Swap/add liquidity | Shows credential, policy, issuer, balance, allowance checks | Medium | CLI output |
| N4 | No unnecessary approval | Non-compliant wallet swap | No approve tx sent | High | wallet tx history |
| N5 | Zero amount swap | `--amount-in 0` | Rejected before tx | Medium | error output |
| N6 | Zero liquidity | `--liquidity 0` | Rejected before approval/tx | Medium | error output |
| N7 | Stale RPC after mint | `credential mint` then immediate status | CLI retries or reports pending RPC refresh clearly | Medium | CLI output |
| N8 | External hookData validation | Wrong chain/hook/caller/pool | CLI rejects before tx when detectable | Medium | error output |
| N9 | Help output completeness | `ilal --help`, `ilal issuer --help` | All key commands visible | Low | output |

---

# O. Demo Pool Operations Tests

| ID | Scenario | Command / Action | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|---|
| O1 | Pool initialized | Read/attempt swap | Pool exists and is initialized | High | pool state / tx |
| O2 | No liquidity | Swap before LP added | Reverts clearly as liquidity/price issue, not credential issue | Medium | error output |
| O3 | Add active liquidity | Add in range around current tick | Swap can execute | High | tx hashes |
| O4 | Price at boundary | One-sided repeated swaps push to min/max | Opposite-direction swap or new liquidity rebalances | Medium | tx/output |
| O5 | Wide range LP | Use practical wide range | Succeeds with safe liquidity amount | Medium | tx hash |
| O6 | Demo command recommendation | Docs recommend token direction and liquidity size that work | No customer dead-end | Medium | README/CLI output |

---

# P. Documentation / Partner Readiness Tests

| ID | Scenario | Expected Result | Severity if Fails | Evidence |
|---|---|---|---|---|
| P1 | First issuer guide | Clear flow: deploy/configure issuer, attest, user mint, user swap | High | README / docs |
| P2 | Goldfinch-style backend path | Shows backend can call `ilal issuer attest` or direct EAS contract | High | docs |
| P3 | User mint guide | User only needs attestation UID + wallet key | High | docs |
| P4 | Pool policy guide | Explains `standard_id` as `credentialType` | High | docs |
| P5 | Known limitations | Lists testnet liquidity depth, audit status, mainnet requirements | Medium | docs |
| P6 | Security claims | Claims backed by test evidence, not overstated as formal audit | High | docs |
| P7 | Fee precision note | Dust fee rounding documented as informational | Low | docs |
| P8 | Production checklist | Multisig, audit, issuer governance, monitoring, liquidity ops | High | docs |

---

# Recommended Acceptance Gates

## Demo-Day Acceptance

| Gate | Requirement |
|---|---|
| G-D1 | `npm install -g @ilalv3/cli@latest` works |
| G-D2 | `ilal init` points to latest Base Sepolia stack |
| G-D3 | `issuer attest -> credential mint -> swap` works end-to-end |
| G-D4 | Non-compliant wallet is blocked before approve/broadcast |
| G-D5 | Add liquidity works with documented safe parameters |
| G-D6 | Stolen hookData and replay are rejected |
| G-D7 | README has current addresses and working commands |

## Issuer Pilot Acceptance

| Gate | Requirement |
|---|---|
| G-I1 | Issuer can create standard profile and get `standard_id` |
| G-I2 | Issuer can issue EAS attestation without ILAL team involvement |
| G-I3 | User can mint CNF from issuer attestation |
| G-I4 | Pool policy can require issuer credentialType |
| G-I5 | User can swap/add liquidity after CNF |
| G-I6 | Revocation/expiry blocks future swaps |
| G-I7 | Operational docs explain deploy, attest, mint, trade, revoke |

## Mainnet Readiness Acceptance

| Gate | Requirement |
|---|---|
| G-M1 | Formal third-party audit completed |
| G-M2 | Admin keys moved to multisig/timelock setup |
| G-M3 | Real EAS / KYC issuer integration tested |
| G-M4 | Production liquidity operations plan exists |
| G-M5 | Monitoring for root/verifier changes, revocation, failed swaps |
| G-M6 | Incident response plan for compromised issuer key |
| G-M7 | Legal/compliance review of issuer responsibilities |

---

# Known Non-Bugs / Operational Notes

| Topic | Explanation |
|---|---|
| Demo pool price boundary | Repeated one-sided swaps can move a shallow testnet pool to min/max price. Add liquidity around active tick or swap opposite direction to rebalance. |
| Dust protocol fee | Very small swaps can round the protocol fee to zero. Gas cost makes this economically irrelevant, but it should be documented. |
| CLI issuer standard profile | Current v0.2.x stores issuer standard metadata in `.ilal-issuer-standards.json`; pools enforce the resulting `standard_id` as `credentialType` on-chain. |
| Testnet MockEAS | `ilal issuer attest` supports MockEAS compatibility for Base Sepolia demo; production issuers should use real EAS or their own configured attestation contract. |
| Testnet red-team evidence | Passing this checklist increases confidence but is not equivalent to a formal audit. |
