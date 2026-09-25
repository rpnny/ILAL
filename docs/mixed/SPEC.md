# ILAL Mixed v1 executable specification

Status: local implementation candidate, unaudited, not deployed and not published. This version is wire-incompatible with the legacy Session, V2 PoC and Hookathon netting candidates.

Execution is one transaction / one unlock. No escrow, saved quote, or cross-transaction execution context exists. Order signature and ERC-20 allowance are separate authorizations. Matched flow crosses at the pre-fee execution reference price; protocol fee is zero; only residual pays the pool fee.

Types: `MixedTypes.sol` is the wire contract, SDK typed data must match it byte-for-byte. Domain names: `ILAL Mixed Hook`, `ILAL Mixed Grant`; version `1`. Current chain ID is always used. Independent nonce namespaces 0..5: batch, direct, grant, LP add, exit, collect. Canonical struct hashes are strictly ascending; set commitment is `abi.encode(SET_TAG, chainId, hook, poolId, length, hashes)`. Signatures and quotes are not part of the set commitment.

The execution router is bound once to its canonical Hook. `quoteBatch` is an `eth_call` path that performs the complete settlement calculation and then always reverts with `QuoteResult`; all balance, nonce and context changes therefore roll back. It may omit order signatures only while this forced-revert quote flag is active. A quote is never execution authorization.

Math: MatchingMath and SDK model use Q192 with floor division. Input and output budgets are allocated cumulatively per direction. Both sides can have residual dust. Positive matched input with zero matched output is invalid. Every batch total is int128 bounded. Supported reference price is sqrt at ticks [-100,100].

Ownership: PoolManager owner is the canonical Liquidity Router, position salt is keccak256(abi.encode(user,userSalt)). User-owned positions and fees cannot be transferred, delegated, or withdrawn by an administrator. ADD requires a current grant; EXIT and COLLECT require ownership authorization but never a current grant or functioning oracle. Zero liquidity delta is COLLECT, never EXIT.

Authorization: a grant is live only while its policy hash/revision, user epoch and source state remain current. CNF is re-read on every use. ZK grants bind the accepted root and root epoch; replacing or invalidating a root immediately invalidates cached grants. A pool-level user ban applies to every source. Policy changes and unbans wait 48 hours; disabling, banning and retiring roots are immediate.

Acceptance order: math/encoding/state machine -> complete execution -> economic protection -> Mixed authorization and LP. No deployment or publish in this implementation task.
