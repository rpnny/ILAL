# Threat model

## Assets and boundaries

- User funds and token approvals handled by `ILALRouter`.
- Credential validity, revocation, issuer policy, and ZK configuration.
- Session signatures and one-time nonce state.
- Administrative ownership and Safe proposals.
- Release provenance, deployment addresses, package integrity, and proving artifacts.
- Sensitive off-chain data: keys, passwords, witnesses, identity/KYC material, and ceremony entropy. These must remain outside the repository.

## Trusted components

The configured PoolManager, immutable Router/Hook bindings, credential or policy contracts, configured attestation source, chain RPC, Safe owners/service, npm/GitHub release controls, and pinned build toolchain each form an explicit trust boundary. MockEAS is a test-only trust source.

## Principal threats and controls

| Threat | Current control | Residual risk |
|---|---|---|
| Direct hook/router bypass | Immutable authorized Router and caller-bound sessions | Contract review still unaudited |
| Replay or cross-context signature | Chain, hook, pool, action, caller, deadline, nonce binding | Compromised signer can create fresh sessions |
| EOA signature malleability | 65-byte, low-s, recovery-id validation | Wallet implementation risk |
| Contract-wallet signature rejection/bypass | On-chain ERC-1271 `isValidSignature` | Wallet-specific semantics require integration tests |
| Swap/LP price bounds omitted | CLI requires output/spend/receipt bounds | Low-level integrations can choose unsafe bounds |
| Admin key compromise | Safe proposal path and release role verification | Safe address/owners not yet supplied for v0.3.3 |
| RPC account mismatch | Chain and `eth_accounts` capability checks | RPC-managed signing remains operator trust |
| Malicious Safe proposal | Offline JSON shows full fields; on-chain hash comparison | Owners must independently review calldata |
| Supply-chain substitution | Pinned contract deps, lockfiles, SHA-pinned Actions, SBOM/checksums plan | Toolchain dependencies remain a review surface |
| ZK toxic waste or witness disclosure | No witness publication; provenance hashes and non-production ceremony label | Current setup is not production ceremony |
| Stale deployment copied by users | No active preset; v0.3.2 explicitly deprecated | Historical third-party copies cannot be revoked |

## Out of scope for v0.3.3

Native custody/HSM vendor adapters, Safe collection of swap-session multisig approvals, production KYC/KYB operations, privacy guarantees for public transaction metadata, formal verification, and independent audit are not claimed.
