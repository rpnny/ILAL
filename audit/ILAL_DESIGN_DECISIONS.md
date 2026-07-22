# ILAL v0.2.5 Design Decisions for Auditors

This document explains intentional choices that may otherwise look like omissions during review.

## 1. User-Signed Sessions, Not Issuer-Signed Sessions

Session authorizations are signed by the trader/user wallet. The issuer does not sign swap sessions.

Reason:

- The issuer decides eligibility by issuing/revoking CNF credentials.
- The trader decides which pool/action/caller/deadline/nonce to authorize.
- The hook checks both: valid user signature and live CNF validity.

Audit implication:

- "Session signer key management" is user wallet/HSM custody, not issuer key custody.
- Issuer key risk is concentrated in CNFIssuer ownership and PolicyRegistry ownership.

## 2. `block.timestamp` for Credential Expiry and Session TTL

ILAL uses `block.timestamp` for:

- Credential expiry checks.
- Session deadline checks.
- Timelock activation checks.

Reason:

- Credential validity is day/month scale.
- Session TTL is minutes, and minor validator timestamp drift does not create a meaningful financial edge.
- Timelocks are measured in 48-72 hours.

Audit implication:

- This is not a price oracle or auction deadline with sub-second sensitivity.
- Auditors should still check boundary behavior at equality and expiry transitions.

## 3. Constructor-Initialized ZK Verifier and Root

CNFIssuer supports initial verifier/root configuration during deployment, then timelocks future changes:

- Initial verifier/root: constructor-only bootstrap for fresh issuer deployment.
- Future verifier update: 72-hour proposal/activation delay.
- Future Merkle root update: 48-hour proposal/activation delay.

Reason:

- A fresh demo or issuer launch should not require waiting 48-72 hours before first use.
- After deployment, verifier/root changes need monitoring windows.

Audit implication:

- Review constructor bootstrap as part of deployment ceremony.
- Mainnet deployment should publish initial verifier/root artifact hashes before broadcast.

## 4. ZK Proof Reuse and Nullifier Scope

The current design prevents repeated proof minting by enforcing one CNF per wallet.

Reason:

- The CNF is address-bound and soulbound.
- A repeated proof cannot mint a second CNF for the same wallet.
- Revoked wallets are permanently banned from both EAS and ZK renewal paths.

Known design note:

- The same valid proof may be usable to renew the same wallet until the proof's public expiry. This does not create multiple credentials and does not bypass revocation.

Audit implication:

- If future product requirements need "one proof use ever", add explicit nullifier tracking.
- Current threat model is "no duplicate credential / no unauthorized wallet", not "no repeated renewal with same proof".

## 5. Registry Deregistration Does Not Disable Existing Pools

`PolicyRegistry.deregisterIssuer(issuer)` removes future self-service rights, but does not automatically disable existing policies.

Reason:

- Existing pool shutdown is a separate operational decision.
- Owner can call `disablePolicy(poolId)` for affected pools.

Audit implication:

- Mainnet operations need a documented incident runbook:
  - deregister issuer
  - enumerate affected pools
  - disable or migrate policies
  - notify LPs/traders

## 6. No Proxy Upgradeability

ILAL v0.2.5 does not use UUPS or TransparentUpgradeableProxy.

Reason:

- Uniswap v4 hook address bits are part of pool identity.
- Upgradeability can create audit and governance complexity for hook-gated pools.

Audit implication:

- No proxy initializer-lock issue.
- Bug fixes require redeploying a new hook/router/issuer stack and migrating pool usage.

## 7. Router Treasury and Fee Are Immutable

`ILALRouter` stores treasury and protocol fee as immutable constructor values.

Reason:

- Users and auditors can inspect the fee path without hidden admin mutability.
- Protocol fee is capped at 0.10%; current demo uses 0.005%.

Audit implication:

- Fee changes require a new router deployment.
- Mainnet treasury should be a multisig or audited treasury contract.

## 8. Native ETH Is Disabled

`ILALRouter` rejects native ETH pools and direct ETH receives.

Reason:

- The MVP targets ERC-20 institutional pools.
- Rejecting native ETH avoids stuck-ETH and settlement edge cases.

Audit implication:

- Native ETH support should be treated as a future feature with separate review.

## 9. Issuer Metadata Is Issuer-Level Only

CNFIssuer exposes issuer name, jurisdiction, credential standard, and URI.

Reason:

- Institutions need to know what trust domain a pool relies on.
- This metadata describes the issuer, not the trader.

Audit implication:

- No per-token identity data is stored in CNF metadata.
- Mainnet issuer metadata URI should point to a stable policy/standard document.

