# ILAL ZK_ONLY issuer pilot

This is a separate Base Sepolia experiment for the same issuer-liquidity scenario. It does not replace the CNF issuer pilot or change its deployment.

The issuer builds one private credential tree for the liquidity provider and two institutions. Each participant receives a Groth16 witness and produces a proof whose nine public inputs bind the participant wallet, issuer domain, schema, expiry, credential root, minimum KYC tier, jurisdiction root, policy hash and circuit version. Private KYC tier, country and Merkle paths are not published.

The candidate starts directly in `ZK_ONLY` mode. Each participant signs a source-2 grant activation and submits a real Groth16 proof to `MixedGrantManager`. After liquidity is added, the pilot executes the canonical 100/70 case and proves from settlement and PoolManager events that 170 gross flow becomes 140 internally matched flow and 30 public AMM input.

The issuer then calls `invalidateRoot`. The prior root is retired immediately, the policy revision and root epoch advance, cached ZK grants become ineligible, and the same already-signed orders revert atomically without consuming their nonces or changing balances. The LP must still collect nonzero fees and fully exit after root retirement.

Generate the private witnesses and proof bundle:

```sh
node scripts/pilot/prepare-zk-pilot.mjs \
  /path/to/0600-wallets.json \
  artifacts/pilot/zk \
  artifacts/pilot/zk-config.json \
  1.0.0-issuer-pilot-testnet.3
```

Prepare and review the deployment, then use the existing resumable broadcaster. Run the lifecycle with:

```sh
node scripts/pilot/rehearse-zk.mjs \
  deployments/base-sepolia/v1.0.0-issuer-pilot-testnet.3.json \
  "$BASE_SEPOLIA_RPC" \
  /path/to/0600-wallets.json \
  artifacts/pilot/zk/proof-bundle.json \
  artifacts/pilot/zk-journal.json \
  artifacts/pilot/zk-evidence.json
```

An independent process verifies the historical blocks, receipts, calldata, EIP-712 signatures, Groth16 proofs, flow events, root retirement, atomic rollback, LP exit and zero Router/Hook inventory:

```sh
node scripts/pilot/verify-zk-evidence.mjs artifacts/pilot/zk-evidence.json "$BASE_SEPOLIA_RPC"
```

The current proving key and verifier use an unsafe development ceremony. This package is unaudited, testnet-only and not production-ready. The issuer inputs are synthetic eligibility attributes for the sandbox; they are not KYC/KYB attestations. Production use requires an independently reviewed ceremony, audit, production governance and real identity-provider integration.

## Public Base Sepolia result

Candidate `1.0.0-issuer-pilot-testnet.3` completed at block `47436852`. The versioned manifest is `deployments/base-sepolia/v1.0.0-issuer-pilot-testnet.3.json`; its SHA-256-bound evidence is `deployments/base-sepolia/evidence/v1.0.0-issuer-pilot-testnet.3.json`.

- Atomic 100/70 execution: `0x09c0efd86c9e78bc68a69eb5c6bdd16e372047ca9b038ec66aca622f075457bf`
- Root retirement: `0x79a96bbb192c4178b52977a015279aafc892114e2ec2dbdff5cab15dfbe07987`
- Same signed orders reverted after retirement: `0x4fc312400f5d339f20c963bb621b0e9e654637f6b10e821fdda359c216709934`
- Nonzero fee collection: `0xab690cce26628e747cad754e3591dcbfa7d4ec7489cbd040a1e31bde317b1d63`
- Full LP exit: `0x72d8b0a6edff2cdbeb68cdbc78ac2cd10d996fcc018d870159171242d509d9b1`
