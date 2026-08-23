# `@ilalv3/cli`

Command-line tooling for ILAL credentials, sessions, policies, swaps, liquidity, deployment, and administrative Safe proposals.

## Which version should I use?

| Version | Distribution | Status |
|---|---|---|
| `0.4.0-v2-poc.5` | npm `next` preview | Atomic netting CLI plus V2 issuer integration kit; Base Sepolia candidates only, unaudited |
| `0.3.3` | npm stable | Active Base Sepolia v0.3.3 demo preset; Safe-controlled, MockEAS, unaudited |
| `0.3.2` | npm deprecated | Points at a deprecated Base Sepolia stack whose owner signer was exposed |
| `0.2.21` | npm legacy | Published historical old Router ABI; do not mix with v0.3 source or manifests |

The preview keeps the stable v0.3.3 deployment preset isolated while adding
institutional netting and issuer-operated V2 policy tooling for their recorded candidates. Install it with
`npm install -g @ilalv3/cli@next`. Published `0.2.21` remains a separate legacy
line; copying its commands or addresses into current releases will fail.

```bash
cd cli
npm ci
npm run build
node dist/index.js --version  # 0.4.0-v2-poc.5
npm test
```

`ilal init` selects only the active v0.3.3 manifest on Base Sepolia. Deprecated presets are never selected automatically.

## Atomic netting (Hookathon candidate)

Institutions sign exact-input orders locally; the JSON contains no private key.
The solver previews the canonical batch commitment and submits it permissionlessly:

```bash
ilal --keystore institution-a.json --password-file a.password \
  netting order sign --zero-for-one --amount-in 100000000 \
  --min-amount-out 99000000 --max-amm-input 30000000 -o order-a.json

ilal netting batch preview --orders order-a.json order-b.json

ilal --keystore solver.json --password-file solver.password \
  netting batch execute --orders order-a.json order-b.json

ilal --keystore institution-a.json --password-file a.password \
  netting nonce cancel --nonce 0x...
```

`preview` prints submitted gross, matched gross, residuals, exposure reduction
and `batchId`. Input file order is irrelevant: the CLI keeps each signature with
its order and sorts strict ascending `orderHash`, matching the Router and Hook.
Duplicate hashes are rejected. `execute` verifies the same preview on-chain
before broadcast and prints decoded Router settlement events and the transaction hash. See
[`../docs/HOOKATHON_NETTING.md`](../docs/HOOKATHON_NETTING.md).

## Signers

### Encrypted EOA keystore

```bash
chmod 600 ./password.txt
ilal --keystore ./wallet.json --password-file ./password.txt status
```

Web3 Secret Storage v3 keystores using AES-128-CTR with scrypt or PBKDF2 are supported. Omit `--password-file` for a hidden interactive prompt. The key and password are not placed in command output or config.
Deployment delegates directly to Foundry's keystore support, so the decrypted key is not copied into the Forge child environment.

### RPC-managed account

```bash
ilal --rpc-account 0xManagedAccount --rpc https://controlled-node.example ...
```

The CLI probes chain ID and `eth_accounts` before sending. Commands that need typed-data signing or transaction sending fail if the node lacks the required method. This mode means only “account managed by this RPC”; it does not imply Fireblocks, Copper, HSM, or custody-vendor support.

### Legacy testnet compatibility

```bash
PRIVATE_KEY=0xTestOnly ilal --unsafe-private-key swap ...
```

`PRIVATE_KEY` is rejected unless `--unsafe-private-key` is explicit and the configured chain is a known testnet. It is not an institutional signer path and must not be used for deployment.

## Safe administrative proposals

Generate an offline transaction proposal:

```bash
ilal \
  --safe 0xSafe \
  --safe-output ./proposal.json \
  safe propose \
  --to 0xPolicyRegistry \
  --data 0xEncodedCalldata \
  --value 0 \
  --operation 0 \
  --chain 84532
```

Before writing output, the CLI verifies RPC chain ID, Safe bytecode, owners, threshold, nonce, and the on-chain `getTransactionHash` result. The JSON displays chain ID, Safe, target, value, operation, calldata, nonce, threshold, owners, and transaction hash.

Submission is opt-in:

```bash
ilal \
  --safe 0xSafe \
  --safe-tx-service https://safe-service.example \
  --owner-keystore ./owner.json \
  --owner-password-file ./owner.password \
  --submit-safe-proposal \
  safe propose --to 0xTarget --data 0xCalldata --chain 84532
```

This signs and submits one owner proposal; it does not execute the Safe transaction or collect remaining confirmations. HSM/custody integrations require separate, tested adapters.

Configured policy management commands can use the same Safe proposal options. Safe proposal handling is for administrative transactions; it is not a swap-session multisig collector.

## V2 issuer integration kit

The issuer kit converts PII-free JSON or CSV decisions into an encrypted,
deterministic credential tree. Exact KYC tier, country, wallet records, and
Merkle paths remain in the issuer environment. Only policy commitments are
published on-chain.

```bash
ilal issuer tree init \
  --issuer "Partner Sandbox Issuer" \
  --schema institutional-kyc-v1 \
  --allow-countries 840,826,756 \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password

ilal issuer tree import \
  --file ./issuer-decisions.csv \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password

ilal issuer tree root \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password

ilal issuer tree export-witness \
  --wallet 0xInstitution \
  --out ./private/issuer-witness.json \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password
```

The encrypted store uses AES-256-GCM with a scrypt-derived key. Password,
store, policy export, and witness files must be managed as issuer secrets; the
CLI rejects group-readable password files and writes generated artifacts with
mode `600`. Provider references are domain-separated and hashed before being
stored. See the repository's `docs/ISSUER_INTEGRATION.md` for the data schema,
Safe policy publication, revocation, and sandbox acceptance workflow.

V2 swap and liquidity preflight pins policy and grant reads to one block. The
CLI rechecks the policy hash, revision, and grant immediately before broadcast,
so a newly published root rejects an old grant before the Router transaction is
sent. The Hook performs the same enforcement on-chain.

## ERC-1271 sessions

External `--hook-data` validation distinguishes EOAs from contract wallets. EOAs require canonical 65-byte low-s ECDSA. Contract wallets are validated on-chain with `isValidSignature(sessionDigest, signature)`, so an ERC-1271 signature is not forced into EOA length or recovery rules.

## Slippage and amount bounds

Live swaps require a positive raw `--min-amount-out`:

```bash
ilal --keystore ./wallet.json swap \
  --amount-in 1 \
  --token-in 0xToken \
  --min-amount-out 990000
```

Only controlled test environments may opt out with `--unsafe-no-slippage`. Adding liquidity similarly requires `--max-amount-0` and `--max-amount-1`; removing liquidity requires `--min-amount-0` and `--min-amount-1`.

## Deployment

```bash
ilal --keystore ./fresh-deployer.json deploy \
  --chain 84532 \
  --admin 0xAdminSafe \
  --treasury 0xTreasury \
  --mock
```

Mock deployment also performs ownership handoff. `ADMIN` and `TREASURY` are independent inputs. After deployment, the release process must verify every privileged holder and prove the deployer retains no undeclared role.

The active public v0.3.3 Base Sepolia demo is recorded in `deployments/base-sepolia/v0.3.3.json`. It uses MockEAS, has ZK disabled, is unaudited, and is not production-ready. Historical v0.3.2 addresses are deliberately omitted here.

## Release policy

Ordinary RC tags create GitHub prereleases only. Stable releases publish to
`latest`; explicitly versioned V2 PoC releases publish to `next`. Both npm
channels use GitHub OIDC Trusted Publishing, provenance, a protected
environment, and exact consistency across the Git tag, `package.json`, release
manifest, and the referenced active or candidate deployment. See the root
`RELEASE.md` and `docs/RELEASE_PROCESS.md`.

## License

Apache-2.0. See the monorepo `LICENSE`, `NOTICE`, and `THIRD_PARTY_LICENSES.md`.
