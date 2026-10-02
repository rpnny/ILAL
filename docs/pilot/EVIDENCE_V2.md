# Independently verified issuer-pilot evidence v2

V2 verifies historical state, signed calldata, receipts and events. A COMPLETE file is a claim until the read-only verifier returns VERIFIED against an archive-capable RPC. V1 records remain historical, limited evidence; they are never upgraded implicitly.

```bash
node scripts/pilot/verify-evidence.mjs evidence-v2.json "$RPC_URL"
```

Without an RPC this command only validates static structure. The verifier never falls back to latest state. It pins every state read, rechecks canonical checkpoint hashes, replays historical quotes, verifies signed execution calldata, and derives 170/140/30 from Router and PoolManager events. PoolManager transfers include settlement; they are not the AMM input measure. The fully matched order can emit a zero-delta Swap event.

The canonical cases are revision activation after a real 48-hour proposal, isolated CNF revocation, one successful 100/70 batch, and nonzero fee collection before full LP exit under revoked credentials and disabled policy. Quote, grants and order deadlines are fresh **after** the waiting period, avoiding an expiry confound. Reverted transactions must preserve token balances, nonces, pool price/liquidity/fee-growth and position state; ETH gas payment is not covered by this unchanged-state claim.

For a new Base Sepolia candidate, set `candidateVersion` to `1.0.0-issuer-pilot-testnet.2` in the existing pilot configuration and prepare/broadcast normally. Do not overwrite a previous deployment or evidence file. Then run:

```bash
node scripts/pilot/rehearse-v2.mjs candidate.json "$BASE_SEPOLIA_RPC" \
  /secure/external-test-wallets.json artifacts/pilot/public-v2-journal.json \
  artifacts/pilot/public-evidence-v2.json
```

The external wallet file is mode 0600 and contains `[role,address,privateKey]` rows for all seven roles. The script validates account ownership and Base Sepolia chain ID. It proposes a grant TTL change from 3600 to 1800 seconds and returns WAITING_TIMELOCK with the actual ready timestamp. Run the same command after that time. Do not leave a shell asleep for 48 hours.

The journal binds chain, contracts and roles. It persists the signed transaction hash and serialized bytes before broadcasting; retries rebroadcast identical bytes or read the existing receipt. It contains replayable signed test transactions, so keep its mode 0600, do not publish it, and keep wallets available securely until the second phase completes. It contains no private keys. An expired signed authorization or changed external state fails closed; investigate before making a fresh candidate rather than silently replacing signed intent.

After VERIFIED, copy evidence to a versioned repository path and run `record-evidence.mjs` with the candidate, evidence path and RPC. The recorder only completes new evidence records after v2 verification. Until then operationalEvidence remains incomplete and the current deployment pointer must not change.

Public oracle evidence is a read-only invalid-price probe. Mutable oracle failure is tested only on the local fixture and is reported separately. Test assets remain synthetic, the protocol remains unaudited, and flow compression is not net economic return.

## Local validation

`make pilot-test` runs both legacy compatibility and v2 on isolated Anvil, independently verifies v2 while the chain is alive, resumes a completed journal without broadcasting, and rejects tampered checkpoint hashes, signatures, quote outputs, targets, failed nonce state, AMM input claims and LP collection data. Local time advancement is allowed only on chain 31337; public runs wait the real timelock.

A historical RPC outage, missing receipt or reorg fails verification. The supported fixture uses an isolated pool and position; before/after checkpoint comparisons deliberately reject unrelated changes in the observed state instead of attributing those changes to the tested transaction. Operational use may require richer transaction-level tracing for shared-state workloads.

## Public candidate progress (2026-09-28)

Candidate `.2` has been deployed from clean source commit `6f7a05a`. Its policy proposal is confirmed; activation is allowed from **2026-09-30 07:59:24 UTC (15:59:24 Asia/Shanghai)**. The candidate remains evidence-incomplete. `protocol.json` still selects `.1`; it will only move after successful v2 historical verification.

Proposal transaction: [Base Sepolia receipt](https://sepolia.basescan.org/tx/0x49596102e18dd4c8958508cbc77bc4152ac4946294bbe9e38e4b23ff5c2d7018).
