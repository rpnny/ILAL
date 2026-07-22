# ILAL Enterprise Cybersecurity Test Plan

> Status notice (2026-07-22): the v0.3.2 Base Sepolia deployment referenced in historical test cases is deprecated and must not be treated as active. Execute chain scenarios only against a newly approved manifest; otherwise use deterministic local Anvil tests.

Date: 2026-07-08  
Scope: Base Sepolia controlled PoC, local fork, and CLI/SDK integration  
Audience: enterprise security teams, audit firms, issuer design partners, institutional trading teams

## Verdict Target

This plan is designed to answer one enterprise question:

```text
If a real issuer, institution, market maker, and attacker all interact with ILAL at the same time, does the system enforce compliance, prevent impersonation, preserve operational clarity, and fail safely?
```

This is not a replacement for a formal third-party audit. It is a maximum-realism customer simulation and adversarial acceptance plan for pre-mainnet institutional PoC.

## Test Principles

| Principle | Requirement |
|---|---|
| Realistic actors | Use separate keys for issuer, institution, market maker, attacker, operator, and fresh wallets. |
| Real chain state | Prefer Base Sepolia live stack; use local fork only for destructive/admin scenarios. |
| No hidden trust | Do not rely on CLI-only checks for security conclusions; confirm critical invariants on-chain. |
| Evidence first | Every pass/fail must include exact command, wallet, tx hash or error, timestamp, and operator notes. |
| Fail-safe standard | Unauthorized users must be blocked before approve/broadcast where possible, or revert on-chain if only contract can decide. |
| Customer language | Record whether the failure is understandable to a real institution, not just technically correct. |

## Required Test Identities

| Role | Name | Purpose | Required State |
|---|---|---|---|
| Protocol operator | ILAL Ops | Deploy/configure stack, set policies, manage root/verifier on fork | Owner key on fork or testnet operator key |
| Issuer | Goldfinch-style Issuer | Runs KYC/KYB backend and attests eligible wallets | Issuer attester key |
| Institution A | NorthBridge Capital | Receives CNF and trades | Valid CNF, funded TOKA/TOKB |
| Market maker B | Atlas Market Making | Provides liquidity and rebalances | Valid CNF, funded TOKA/TOKB |
| Attacker C | Unknown Wallet | No credential; attempts direct and indirect bypass | Funded ETH, optional tokens |
| Compliant attacker D | Rogue Compliant Wallet | Has own CNF but tries to steal A's session | Valid CNF, funded ETH/tokens |
| SOC observer | Security Monitor | Watches events, root/verifier proposals, revocations, failures | Read-only RPC + explorer access |

## Evidence Template

Use this row format for every test result:

| Field | Value |
|---|---|
| Test ID |  |
| Actor |  |
| Wallet |  |
| Network | Base Sepolia / local fork |
| CLI version | `ilal --version` |
| Config hash / addresses | `.ilal.json` or release matrix |
| Command or calldata |  |
| Expected result |  |
| Actual result |  |
| Tx hash |  |
| Block |  |
| Error selector/message |  |
| Pass/Fail |  |
| Notes |  |

## Severity Model

| Severity | Meaning |
|---|---|
| Critical | Compliance bypass, unauthorized trade/liquidity, CNF forgery, session impersonation, replay, or funds at risk. |
| High | Incorrect issuer/policy enforcement, wrong chain/pool/action accepted, bad admin control, misleading readiness. |
| Medium | Poor error clarity, avoidable gas loss, operational footgun, incomplete monitoring evidence. |
| Low | Cosmetic, documentation, or UX polish issue that does not alter security outcome. |

---

# Phase 0 — Chain, Package, And Environment Baseline

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| P0-01 | Fresh machine install | `npm install -g @ilalv3/cli@latest && ilal --version` | Version equals current release matrix | High |
| P0-02 | Registry confirmation | `npm view @ilalv3/cli version dist-tags --json` | `latest` equals expected version | Medium |
| P0-03 | Config bootstrap | `ilal init --force` | `.ilal.json` matches release matrix | High |
| P0-04 | Seeded demo check | `ilal demo check --wallet <seeded_wallet>` | Infra, wallet, tx readiness all 100% | High |
| P0-05 | Fresh wallet check | `ilal demo check --wallet <fresh_wallet>` | Infra ready, wallet not ready, tx not ready | High |
| P0-06 | CLI audit | `cd cli && npm audit --omit=dev` | 0 vulnerabilities | Medium |
| P0-07 | SDK audit | `cd sdk && npm audit --omit=dev` | 0 vulnerabilities | Medium |
| P0-08 | Circuits toolchain audit | `cd circuits && npm audit --omit=dev` | Known/offline findings documented; not silently ignored | Medium |

---

# Phase 1 — Issuer Lifecycle Simulation

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| ISS-01 | Issuer standard creation | `ilal issuer create --standard "Goldfinch Accredited Investor"` | Returns `standard_id` / credential type | High |
| ISS-02 | Jurisdiction policy | `ilal issuer set-jurisdiction --allow US,EU,SG` | Standard profile updated | Medium |
| ISS-03 | Accredited-only policy | `ilal issuer set-type --accredited-only true` | Standard profile updated | Medium |
| ISS-04 | Profile readback | `ilal issuer get` | Shows standard, jurisdictions, accredited flag, credential type | Medium |
| ISS-05 | Valid issuer attestation | Issuer key runs `ilal issuer attest --wallet <Institution A>` | Attestation UID returned; tx succeeds | Critical |
| ISS-06 | Wrong issuer key on MockEAS | Non-owner key attempts `issuer attest` | Rejected by owner/attester authorization | Critical |
| ISS-07 | Explicit schema/EAS | `issuer attest --eas <addr> --schema <uid>` | Uses explicit issuer-configured EAS/schema | High |
| ISS-08 | Expiring attestation | `issuer attest --expires-in-days 1` | Expiration recorded and later enforced | High |
| ISS-09 | Duplicate attestation handling | Attest same wallet twice | Both UIDs may exist, but CNF mint constraints still enforce one active credential | Medium |
| ISS-10 | Issuer key compromise drill | On fork, compromised issuer attests attacker | Attacker can mint only if issuer key is trusted; risk logged as governance/issuer risk | High |

---

# Phase 2 — CNF Issuance, Validity, Revocation

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| CNF-01 | User mints from valid attestation | A runs `ilal credential mint --attestation <uid>` | CNF minted, status valid | Critical |
| CNF-02 | Wrong recipient mint | C tries to mint from A's UID | Rejected | Critical |
| CNF-03 | Reused attestation | Reuse same UID after successful mint | Rejected | Critical |
| CNF-04 | Wrong schema | Mint from attestation with wrong schema | Rejected | Critical |
| CNF-05 | Wrong attester | Mint from untrusted attester | Rejected | Critical |
| CNF-06 | Expired attestation | Mint after expiration | Rejected | High |
| CNF-07 | Revoked attestation | Mint from revoked UID | Rejected | High |
| CNF-08 | Soulbound transfer | Try `transferFrom` / `safeTransferFrom` | Reverts | Critical |
| CNF-09 | Approval blocked | Try `approve` / `setApprovalForAll` | Reverts | High |
| CNF-10 | Owner revokes CNF | Owner revokes A | `isValid(A)` false immediately | Critical |
| CNF-11 | Revoked wallet renew attempt | A tries `renewWithEAS` / `renewWithProof` | Rejected by permanent ban | Critical |
| CNF-12 | Expired CNF E2E | Short TTL issuer; wait expiry; attempt swap | Hook rejects credential | Critical |

---

# Phase 3 — ZK Proving Path And Artifact Controls

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| ZK-01 | Hosted artifact flow | `credential prove` with empty local cache | Artifacts fetched/cached or clear documented error | High |
| ZK-02 | Offline artifact flow | `--offline --artifact-cache <path>` | Uses local artifacts only | Medium |
| ZK-03 | Missing offline cache | Empty cache + `--offline` | Fails clearly before tx | Medium |
| ZK-04 | Matching root proof | Proof generated for configured root | CNF mint succeeds | Critical |
| ZK-05 | Wrong root proof | Proof against unapproved tree | Rejected `InvalidMerkleRoot` | Critical |
| ZK-06 | Wrong wallet proof | B uses A's proof | Rejected by wallet hash binding | Critical |
| ZK-07 | Expired proof | `expiresAt <= now` | Rejected | High |
| ZK-08 | Malformed public inputs | Too few or reordered public inputs | Rejected | Critical |
| ZK-09 | Malformed proof bytes | Random/fuzzed proof bytes | Rejected | Critical |
| ZK-10 | Ceremony status disclosure | Review release docs | Production ceremony caveat is explicit | High |

---

# Phase 4 — Trading System Integration

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| TRD-01 | Institution swap happy path | A runs `ilal swap --amount-in 1 --token-in <TOKA>` | Tx confirms through ILALRouter | Critical |
| TRD-02 | External execution flow | A runs `session sign`, execution service runs `swap --hook-data` | Supplied hookData used; no re-sign | Critical |
| TRD-03 | Slippage floor | A swaps with impossible `--min-amount-out` | Reverts with slippage protection | High |
| TRD-04 | Price boundary handling | Repeated one-sided swaps push pool toward boundary | Error is price/liquidity-specific, not misleading compliance error | Medium |
| TRD-05 | Exact output unsupported | Submit positive `amountSpecified` path | Rejected as unsupported | Medium |
| TRD-06 | Bad private key format | Missing `0x` or wrong length | Clear local error | Low |
| TRD-07 | Insufficient token balance | A drains token then swaps | Preflight blocks before broadcast | High |
| TRD-08 | Insufficient allowance | A has CNF/balance but no allowance | CLI approves only required path, then executes or clearly asks | Medium |
| TRD-09 | RPC outage | Use broken `--rpc` | Fails clearly; no partial tx assumptions | Medium |
| TRD-10 | Multi-RPC consistency | Run status through two RPCs | Same chain state or documented lag | Medium |

---

# Phase 5 — Market Maker / Liquidity Provider Simulation

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| LP-01 | Valid LP adds liquidity | B runs `pool add-liquidity` | Tx confirms through hook | Critical |
| LP-02 | No-CNF LP attempt | C runs `pool add-liquidity` | Blocked before approve/broadcast | Critical |
| LP-03 | Funded no-CNF LP | C has tokens and approval but no CNF | Still rejected | Critical |
| LP-04 | Wrong action session | Use swap hookData for add/remove liquidity | Rejected | Critical |
| LP-05 | Wrong range / inactive liquidity | Add range away from current tick | No compliance bypass; economic state explained | Medium |
| LP-06 | Add spend exceeds signed maximum | Set `maxAmount0/1` below actual delta | Router reverts before settlement | Critical |
| LP-07 | Remove output below signed minimum | Set `minAmount0/1` above actual delta | Router reverts atomically | Critical |
| LP-06 | Huge liquidity amount | Amount exceeds available balances | Fails clearly | Medium |
| LP-07 | Remove liquidity happy path | B removes own position | Tx confirms | High |
| LP-08 | Remove using stale session | Wait expiry then remove | Rejected | High |
| LP-09 | Position salt behavior | Repeat add with same/different salts | Behavior matches v4 position expectations | Medium |
| LP-10 | Market-maker rebalance loop | Add liquidity, swap both directions, remove part | All actions require valid CNF/session | Critical |

---

# Phase 6 — Unauthorized Wallet And Access-Control Tests

| ID | Attack | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| ACC-01 | No CNF swap | C runs `swap` | Blocked before approve/broadcast | Critical |
| ACC-02 | No CNF add liquidity | C runs `pool add-liquidity` | Blocked before approve/broadcast | Critical |
| ACC-03 | Funded no CNF | C receives TOKA/TOKB then swaps | Still blocked | Critical |
| ACC-04 | Approved no CNF | C manually approves router then swaps | Rejected by credential check | Critical |
| ACC-05 | Wrong issuer CNF | Wallet has CNF from issuer A, pool requires issuer B | Rejected | Critical |
| ACC-06 | Wrong credential type | CNF valid but policy type differs | Rejected | Critical |
| ACC-07 | Disabled policy | Operator disables policy on fork; A swaps | Rejected | Critical |
| ACC-08 | Unregistered issuer policy set | Unregistered issuer self-service attempt | Rejected | High |
| ACC-09 | Registered issuer impersonation | Registered issuer tries to set policy for another issuer | Impossible; policy binds `msg.sender` | High |
| ACC-10 | Direct owner-only admin from wrong key | Wrong key calls registry/issuer admin | Rejected | High |

---

# Phase 7 — Session And Signature Attack Suite

| ID | Attack | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| SES-01 | Stolen hookData by no-CNF attacker | C submits A's hookData directly | Rejected `SessionUserMismatch` or equivalent | Critical |
| SES-02 | Stolen hookData by compliant attacker | D with valid CNF submits A's hookData | Rejected `SessionUserMismatch` | Critical |
| SES-03 | Replay | Submit same hookData twice | Second attempt rejected `NonceAlreadyUsed` | Critical |
| SES-04 | Wrong caller | Modify `authorizedCaller` | Rejected | Critical |
| SES-05 | Wrong hook | Modify `verifyingHook` | Rejected | Critical |
| SES-06 | Wrong pool | Modify `poolId` | Rejected | Critical |
| SES-07 | Wrong chain | Sign chain 8453, submit on 84532 | Rejected | Critical |
| SES-08 | Wrong action | Use add-liquidity session for swap | Rejected | Critical |
| SES-09 | Expired deadline | Submit after TTL | Rejected | High |
| SES-10 | High-s malleability | Construct `(r, n-s, v^1)` | Rejected by low-s enforcement | High |
| SES-11 | Invalid v | `v` not 27/28 | Rejected | High |
| SES-12 | Short signature | Signature length != 65 | Rejected | High |
| SES-13 | ERC-1271 accept | Smart wallet returns magic value | Accepted if CNF/policy valid | High |
| SES-14 | ERC-1271 reject | Smart wallet rejects signature | Rejected | High |
| SES-15 | Nonce bitmap collision | Same lower 8-bit index in same word after use | Used bit rejects replay, fresh bit succeeds | Critical |

---

# Phase 8 — Direct Contract And Router Bypass Tests

| ID | Attack | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| BYP-01 | Direct hook beforeSwap | EOA/cast calls hook directly | Reverts `OnlyPoolManager` | Critical |
| BYP-02 | Direct PoolManager without ILALRouter | Attempt swap through PoolManager path not using authorized router | Hook rejects router/caller | Critical |
| BYP-03 | Old router | Call through previous/unapproved router | Rejected `RouterNotAuthorized` | Critical |
| BYP-04 | Fake router contract | Deploy fake router with stolen hookData | Rejected by authorized router binding | Critical |
| BYP-05 | Direct CNFIssuer fake UID | `mintWithEAS(fake_uid)` | Rejected | Critical |
| BYP-06 | Direct CNFIssuer fake proof | `mintWithProof(fake_proof)` | Rejected | Critical |
| BYP-07 | Send ETH to router | Raw ETH transfer | Reverts `NativeNotSupported` | Medium |
| BYP-08 | Fee dust attack | Very small swap amount | Fee rounding documented; economic impact measured | Low |
| BYP-09 | Non-standard ERC20 false return | Fork/mock token returns false | Router reverts transfer failure | High |
| BYP-10 | Reentrancy probe | Malicious token callback/fork test | No unauthorized state change or credential bypass | High |

---

# Phase 9 — Admin, Governance, And Incident Simulation

Run destructive/admin tests on a local fork unless using a disposable deployment.

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| GOV-01 | Verifier proposal | Owner proposes new verifier | Pending verifier and activation timestamp emitted | High |
| GOV-02 | Early verifier activation | Activate before delay | Reverts `TooEarly` | Critical |
| GOV-03 | Verifier activation after delay | Warp/fork past 72h | Verifier updates and event emitted | High |
| GOV-04 | Merkle root proposal | Owner proposes root | Pending root and activation timestamp emitted | High |
| GOV-05 | Early root activation | Activate before 48h | Reverts `TooEarly` | Critical |
| GOV-06 | Root activation after delay | Warp/fork past 48h | Root updates and event emitted | High |
| GOV-07 | Root update monitoring | SOC observer detects proposal event | Alert created with proposer, root, ETA | High |
| GOV-08 | Verifier update monitoring | SOC observer detects proposal event | Alert created with verifier, ETA | High |
| GOV-09 | Policy disable incident | Disable policy on fork; run user swap | Swap blocked; runbook explains user impact | High |
| GOV-10 | Issuer compromise drill | Compromised issuer attests attacker | Incident documented as issuer trust-chain failure; mitigation requires issuer revocation/policy action | Critical |
| GOV-11 | Treasury sanity | Verify protocol fee treasury address | Matches release matrix and events | Medium |
| GOV-12 | Emergency comms | Draft customer-facing incident note | Clear distinction between testnet PoC and production controls | Medium |

---

# Phase 10 — Privacy And Data-Minimization Review

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| PRIV-01 | CNF metadata review | Inspect tokenURI/metadata behavior | No KYC PII leaked | Critical |
| PRIV-02 | Event review | Inspect emitted events | No PII beyond wallet/issuer/status fields | High |
| PRIV-03 | CLI logs | Run all flows with verbose output | No private key, raw KYC data, or seed material logged | Critical |
| PRIV-04 | Proof public inputs | Inspect public signals | Only intended walletHash/domain/root/expiry signals public | High |
| PRIV-05 | Attestation data | Inspect EAS data field | Demo/mock data non-sensitive; production schema guidance documented | High |
| PRIV-06 | Local files | Search `.ilal*`, cache, outputs | No private key or KYC PII stored unintentionally | Critical |
| PRIV-07 | Browser/website copy | Review website/pitch claims | Does not imply PII is public or fully anonymous beyond actual design | Medium |
| PRIV-08 | Data retention | Check docs for artifact/cache retention | User can clear cache; no hidden telemetry stated | Medium |

---

# Phase 11 — Supply Chain And Release Security

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| SUP-01 | npm package integrity | `npm view @ilalv3/cli dist.integrity version` | Version/integrity recorded | High |
| SUP-02 | CLI tarball inspection | `npm pack --dry-run` | Only expected `dist`, README, package metadata, license | High |
| SUP-03 | Build reproducibility | Clone/install/build CLI | `ilal --version` matches package version | High |
| SUP-04 | Lockfile consistency | `package-lock.json` name/version match package | Match | Medium |
| SUP-05 | SDK package audit | `cd sdk && npm audit --omit=dev` | 0 vulnerabilities | Medium |
| SUP-06 | Circuits audit disclosure | `cd circuits && npm audit --omit=dev` | Findings documented as offline toolchain, not hidden | Medium |
| SUP-07 | Secret scan | Search for private keys / seed phrases | No real secrets committed | Critical |
| SUP-08 | Release matrix | `RELEASE.md` exists and matches npm/deployment | Match | High |
| SUP-09 | Audit scope entry | `audit/ILAL_CURRENT_AUDIT_SCOPE.md` exists | Current scope clear | High |
| SUP-10 | Root repo traceability | Confirm release tag/commit strategy | If absent, document as release-governance gap | Medium |

---

# Phase 12 — Monitoring, Observability, And SOC Runbook

| ID | Scenario | Procedure | Expected Result | Severity If Fails |
|---|---|---|---|---|
| SOC-01 | Track successful swaps | Watch `SwapExecuted` | Events visible with pool/user/token amounts | Medium |
| SOC-02 | Track protocol fees | Watch `ProtocolFeePaid` | Treasury receipts match fee quote | Medium |
| SOC-03 | Track credential mints | Watch `CredentialMinted` | Mint events visible | Medium |
| SOC-04 | Track revocations | Watch `CredentialRevoked` | Revocation events visible | High |
| SOC-05 | Track root proposals | Watch `MerkleRootProposed` | Alert includes activation time | High |
| SOC-06 | Track verifier proposals | Watch `ZKVerifierProposed` | Alert includes activation time | High |
| SOC-07 | Track policy changes | Watch `PolicySet` / `PolicyDisabled` | Alerts generated | High |
| SOC-08 | Failed tx taxonomy | Collect common revert reasons | Dashboard distinguishes compliance, liquidity, slippage, RPC, allowance | Medium |
| SOC-09 | Pool health | Monitor price/tick/liquidity | Detect boundary conditions before demo/customer flow | Medium |
| SOC-10 | Incident drill | Simulate compromised issuer/root proposal | Runbook produces actions, owner, timeline, customer note | High |

---

# Phase 13 — Real Customer End-To-End Dress Rehearsal

This phase is the highest-value test because it simulates how a real issuer and institutional desk would actually use ILAL.

| Step | Actor | Action | Expected Result |
|---|---|---|---|
| 1 | Issuer | Creates issuer standard and records policy `credentialType` | Standard ID saved |
| 2 | Protocol/operator | Registers issuer / pool policy | Pool requires issuer CNF |
| 3 | Institution A | Starts with no CNF | `demo check` says wallet not ready |
| 4 | Issuer | Runs `issuer attest --wallet A` after KYC approval | UID returned |
| 5 | Institution A | Runs `credential mint --attestation <uid>` | CNF valid |
| 6 | Market maker B | Receives attestation and mints CNF | CNF valid |
| 7 | Market maker B | Adds liquidity | Tx succeeds |
| 8 | Institution A | Signs session locally | 0 gas hookData produced |
| 9 | Institution A trading backend | Executes swap with `--hook-data` | Tx succeeds once |
| 10 | Institution A trading backend | Replays same hookData | Rejected |
| 11 | Attacker C | Tries same swap without CNF | Blocked before tx |
| 12 | Rogue compliant D | Tries A's hookData | Rejected `SessionUserMismatch` |
| 13 | Operator | Revokes A on fork | A can no longer swap |
| 14 | SOC | Produces evidence pack | Commands, txs, blocks, errors, event logs complete |

Acceptance standard:

```text
The compliant institution and market maker can trade/provide liquidity.
The non-compliant wallet cannot approve or broadcast through CLI.
The rogue compliant wallet cannot reuse another institution's authorization.
The SOC can explain every success and failure from chain evidence.
```

---

# Final Acceptance Gates

| Gate | Required Outcome |
|---|---|
| Package | npm latest matches `RELEASE.md`; CLI version output matches package version |
| Demo stack | Seeded wallet readiness 100%; fresh wallet not tx-ready |
| Issuer flow | Issuer can attest; user can mint without ILAL team custody |
| Trading flow | Valid CNF wallet can swap and add liquidity |
| Negative flow | No-CNF wallet blocked before approve/broadcast |
| Session security | Replay, stolen hookData, wrong chain/pool/action/caller all fail |
| Contract security | Direct hook/router/CNF bypass attempts fail |
| Governance | Root/verifier timelocks behave correctly on fork |
| Privacy | No private key/KYC PII leaks in logs, metadata, or artifacts |
| Supply chain | CLI/SDK audits clean; circuits toolchain findings documented |
| Monitoring | Critical events are observable and mapped to incident responses |

## Final Enterprise Verdict Language

Use this exact phrasing after the plan passes:

```text
ILAL passed controlled enterprise cybersecurity validation for testnet PoC:
valid issuer credentials enable hook-gated swap/liquidity, non-compliant wallets are blocked, stolen sessions cannot be reused, and critical admin changes are timelocked and observable.

This result supports Demo Day and controlled institutional PoC.
It does not replace a third-party audit or authorize mainnet production capital.
```
