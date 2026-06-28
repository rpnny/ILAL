# @ilalv3/cli

**ILAL Protocol CLI** — compliant swaps and credential management for Uniswap v4.

ILAL gates swaps and liquidity operations behind on-chain compliance credentials (CNF tokens). The CLI wraps the full flow: ZK proof generation, credential minting, session signing, and execution through `ILALRouter` on any EVM chain.

## Install

```bash
npm install -g @ilalv3/cli
ilal --version   # 0.2.18 or newer
```

Or run without installing:

```bash
npx @ilalv3/cli <command>
```

## Quick start (Base Sepolia demo)

`ilal init` points at the current seeded Base Sepolia demo stack. The demo issuer
uses MockEAS, so reviewers can verify the full path without waiting for a real
Coinbase attestation. The seeded reviewer wallet already has CNF + TOKA/TOKB;
for your own wallet, deploy a mock stack with `ilal deploy --mock`.

```bash
# 1. Point CLI at the live demo deployment
ilal init

# 2. Check credential + pool status for the seeded reviewer wallet
ilal status --wallet 0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58

# 3. Full readiness verdict
ilal demo check --wallet 0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58

# 4. Execute a compliant swap with the seeded reviewer key
PRIVATE_KEY=0x... ilal swap --amount-in 1 --token-in 0x8C38061e31FB02df445576685975d85F01D8686d --min-amount-out 0
```

For a fully seeded local/testnet demo, deploy mock EAS + demo pool pieces:

```bash
PRIVATE_KEY=0x... ilal deploy \
  --chain 84532 \
  --mock \
  --wallet-to-seed 0xYourWallet \
  --broadcast

# Then mint the seeded CNF from the printed AttestationUID:
PRIVATE_KEY=0x... ilal credential mint \
  --issuer <CNFIssuer> \
  --attestation <AttestationUID> \
  --chain 84532

# Or, with the MockEAS owner key, create a fresh test attestation:
PRIVATE_KEY=0x... ilal issuer attest --wallet 0xYourWallet
PRIVATE_KEY=0xYourWalletKey ilal credential mint --attestation <uid>

# If the wallet needs more demo tokens:
PRIVATE_KEY=0x... ilal demo faucet --wallet 0xYourWallet
```

## Getting a CNF credential

### Path A — Coinbase Verifications (EAS)

1. Complete KYC at **https://coinbase.com/onchain-verify**
2. Find your attestation UID on the EAS Explorer:
   - Base mainnet: https://base.easscan.org
   - Base Sepolia: https://base-sepolia.easscan.org
   - Filter by Attester: `0x357458739F90461b99789350868CD7CF330Dd7EE`
3. Mint your CNF:
   ```bash
   PRIVATE_KEY=0x... ilal credential mint --attestation <uid>
   ```

### Path B — ZK proof (privacy-preserving)

Operator prepares the active Merkle root. For a fresh demo deployment this root
can be passed into the CNFIssuer constructor as `INITIAL_MERKLE_ROOT`, avoiding a
48-hour wait while still keeping future root updates timelocked.

```bash
ilal credential zk-root \
  --wallet 0xYourWallet \
  --expires-at 1800000000
```

Trader proves against the same expiry:

```bash
PRIVATE_KEY=0x... ilal credential prove \
  --wallet 0xYourWallet \
  --expires-at 1800000000
```

The CLI automatically prepares proving artifacts:

1. Use `--circuit-dir` when a local `circuits/build` directory exists.
2. Otherwise use the local cache at `~/.ilal/artifacts/ilal-v1`.
3. If the cache is empty, download hosted artifacts from the ILAL release CDN.

No institution needs to compile Circom in its backend. The flow generates a Groth16 proof locally (~5s), verifies it on-chain, and mints/renews your CNF without revealing identity. If the Merkle root does not match, the issuer/operator must queue the updated root with `ilal oracle propose-root --root <newRoot>` and activate it after the timelock.

Advanced artifact controls:

```bash
# Use a custom enterprise artifact mirror
PRIVATE_KEY=0x... ilal credential prove \
  --wallet 0xYourWallet \
  --artifact-url https://zk-artifacts.yourdomain.example/ilal-v1

# Pre-seeded/offline mode
PRIVATE_KEY=0x... ilal credential prove \
  --wallet 0xYourWallet \
  --artifact-cache /opt/ilal/artifacts/ilal-v1 \
  --offline
```

Equivalent environment variables:

```bash
ILAL_ARTIFACT_BASE_URL=https://zk-artifacts.yourdomain.example/ilal-v1
ILAL_ARTIFACT_CACHE=/opt/ilal/artifacts/ilal-v1
```

## Command reference

| Command | Description |
|---|---|
| `ilal init` | Create `.ilal.json` with contract addresses |
| `ilal status` | Dashboard: credential · issuer config · pool policy |
| `ilal credential zk-root` | Operator helper: compute the ZK Merkle root for a demo wallet/expiry |
| `ilal credential prove` | Trader flow: hosted/cached ZK artifacts → local proof → mint or renew CNF |
| `ilal credential mint` | Mint CNF via the issuer-configured EAS schema |
| `ilal credential renew` | Renew CNF via EAS attestation |
| `ilal issuer create` | Create issuer standard profile and return `standard_id` |
| `ilal issuer set-jurisdiction` | Set allowed jurisdictions |
| `ilal issuer set-type` | Set accredited-only requirement |
| `ilal issuer get` | Read standard profile and `credentialType` |
| `ilal issuer attest` | Issuer backend command: create an EAS attestation for a wallet |
| `ilal swap` | Compliant swap via ILALRouter with optional `--min-amount-out` |
| `ilal pool add-liquidity` | Add liquidity to a compliant pool |
| `ilal pool remove-liquidity` | Remove liquidity from a compliant pool |
| `ilal pool policy set` | Register compliance policy for a pool |
| `ilal pool policy get` | Read pool compliance policy |
| `ilal oracle propose-root` | Operator flow: queue a new Merkle root behind the 48h timelock |
| `ilal oracle activate-root` | Operator flow: activate the pending Merkle root after timelock |
| `ilal oracle propose-verifier` | Operator flow: queue a new ZK verifier behind the 72h timelock |
| `ilal oracle activate-verifier` | Operator flow: activate the pending ZK verifier after timelock |
| `ilal session sign` | Sign a standalone SessionToken |
| `ilal proof mint` | Mint CNF from existing proof.json + public.json |
| `ilal deploy --mock` | Deploy a seeded testnet demo stack with MockEAS, tokens, router, hook, and policy |
| `ilal demo attest` | Legacy testnet alias for MockEAS attestation |
| `ilal demo faucet` | Mint mock demo TOKA/TOKB to a wallet |
| `ilal deploy` | Deploy full ILAL contract stack |

Session note: ILAL hookData is a one-time EIP-712 authorization with a deadline and nonce. The expensive compliance step is the CNF issuance or renewal; swaps do not verify a fresh ZK proof. Use `ilal session sign` to export hookData, and `ilal swap --hook-data <hex>` to execute with an externally signed authorization.

## Issuer standards

External issuers can define a compliance standard and use its `standard_id` as the on-chain `credentialType` for pool policy registration:

```bash
ilal issuer create --standard "Goldfinch Accredited Investor"
ilal issuer set-jurisdiction --allow US,EU,SG
ilal issuer set-type --accredited-only true
ilal issuer get
```

Profiles are stored in `.ilal-issuer-standards.json`. Pools enforce the returned `standard_id` through `PolicyRegistry.requiredCredentialType`.

## Issuer attestation flow

For issuer pilots, the intended integration is:

```text
issuer KYC/KYB pipeline -> ilal issuer attest -> user credential mint -> verified swap/liquidity
```

The issuer owns the attestation key and decides who is eligible. The user mints their own CNF from the returned attestation UID and trades from their own wallet.

```bash
# Issuer backend
PRIVATE_KEY=0xIssuerKey ilal issuer attest \
  --wallet 0xUserWallet \
  --expires-in-days 365

# User wallet
PRIVATE_KEY=0xUserKey ilal credential mint --attestation <uid>
PRIVATE_KEY=0xUserKey ilal swap --amount-in 1 --token-in 0x8C38061e31FB02df445576685975d85F01D8686d --min-amount-out 0
```

For production, replace MockEAS with the issuer's configured EAS/schema or KYC attestation contract.

## Configuration

The CLI reads `.ilal.json` in the current directory. Run `ilal init` to create it, or pass flags directly:

```bash
ilal swap \
  --router    0xA571F7f41c8abC19F20ABAe648e26a75fbe1F434 \
  --hook      0x4847B222d11938A70073292d97cDB98ff8D64a80 \
  --issuer    0x33541301e35d33eDf554c4DFba1e04d04FCc52F4 \
  --pool-id   0x426925fe1ebecf2da7184f9749622ab1a4b8870c888d75da10332aee2080c86f \
  --amount-in 0.001
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0x33541301e35d33eDf554c4DFba1e04d04FCc52F4` |
| MockEAS | `0x6A98096DF6F54DBF40498dC5525d84AEA840663A` |
| ZKVerifierAdapter | `0x9467ED8d962221e3C1865a387481B862B1b5bE95` |
| ComplianceHook | `0x4847B222d11938A70073292d97cDB98ff8D64a80` |
| ILALRouter | `0xA571F7f41c8abC19F20ABAe648e26a75fbe1F434` |
| PolicyRegistry | `0x83d8111B415E97bA91eaAe717c2D9Ae6f0DD19d4` |
| Currency0 / TOKA | `0x8C38061e31FB02df445576685975d85F01D8686d` |
| Currency1 / TOKB | `0xD0e6467D562829d215dB48CDfF4C289095D90B6B` |
| Pool ID | `0x426925fe1ebecf2da7184f9749622ab1a4b8870c888d75da10332aee2080c86f` |

Live proof:

- CNF ZK mint tx: `0xb9aa16c9604a575c8b2281cbfe9ba24fedbf205283a7b05638fbc413ed78de41`
- Add liquidity tx: `0x1ffd6b1546b3f3846d8f86fc21ec059a83a02f23130390c1b9343733d3a9776f`
- Swap tx: `0x36427e232b323e4a8c310286d0312dbf1f4ecde86d58245a81713aafe4df0720`
- Router bypass fix verified: `ComplianceHook.authorizedRouter()` returns `0xA571F7f41c8abC19F20ABAe648e26a75fbe1F434`

## License

MIT
