# @ilalv3/cli

**ILAL Protocol CLI** — compliant swaps and credential management for Uniswap v4.

ILAL gates swaps and liquidity operations behind on-chain compliance credentials (CNF tokens). The CLI wraps the full flow: ZK proof generation, credential minting, session signing, and execution through `ILALRouter` on any EVM chain.

## Install

```bash
npm install -g @ilalv3/cli
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
PRIVATE_KEY=0x... ilal swap --amount-in 1 --token-in 0x3a7d58fAc623B4C30D7735B01DcE036EfF46e079 --min-amount-out 0
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
PRIVATE_KEY=0x... ilal demo attest --wallet 0xYourWallet
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

Generates a Groth16 proof locally (~5s), verifies it on-chain, and mints/renews your CNF without revealing identity. If the Merkle root does not match, the issuer/operator must queue the updated root with `ilal oracle propose-root --root <newRoot>` and activate it after the timelock.

## Command reference

| Command | Description |
|---|---|
| `ilal init` | Create `.ilal.json` with contract addresses |
| `ilal status` | Dashboard: credential · issuer config · pool policy |
| `ilal credential zk-root` | Operator helper: compute the ZK Merkle root for a demo wallet/expiry |
| `ilal credential prove` | Trader flow: local ZK proof → mint or renew CNF |
| `ilal credential mint` | Mint CNF via Coinbase EAS attestation |
| `ilal credential renew` | Renew CNF via EAS attestation |
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
| `ilal demo attest` | Create a MockEAS test attestation so a wallet can mint CNF |
| `ilal demo faucet` | Mint mock demo TOKA/TOKB to a wallet |
| `ilal deploy` | Deploy full ILAL contract stack |

Session note: ILAL hookData is a one-time EIP-712 authorization with a deadline and nonce. The expensive compliance step is the CNF issuance or renewal; swaps do not verify a fresh ZK proof. Use `ilal session sign` to export hookData, and `ilal swap --hook-data <hex>` to execute with an externally signed authorization.

## Configuration

The CLI reads `.ilal.json` in the current directory. Run `ilal init` to create it, or pass flags directly:

```bash
ilal swap \
  --router    0xEfB2F179F6Ce44d7af66d3e3FF792563033C9b7e \
  --hook      0xaCD0fccDDd96471f7De9b3f015C5ebFaADe70a80 \
  --issuer    0x108fA8db11616d73ccB67725B44C535Ddcaac5a9 \
  --pool-id   0x0decaeb998563be8faf6e6b66d4a0c32025a166e35bae97b8ec62ded1b04be1b \
  --amount-in 0.001
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0x108fA8db11616d73ccB67725B44C535Ddcaac5a9` |
| MockEAS | `0xE46d87960b8740585010ae5158193D67da7dd807` |
| ZKVerifierAdapter | `0xb77BB4566d5D1e81370E159bb0251467e4a2fcfa` |
| ComplianceHook | `0xaCD0fccDDd96471f7De9b3f015C5ebFaADe70a80` |
| ILALRouter | `0xEfB2F179F6Ce44d7af66d3e3FF792563033C9b7e` |
| PolicyRegistry | `0xC2Be4887aF9218b4B617F7125924737413292160` |
| Currency0 / TOKA | `0x3a7d58fAc623B4C30D7735B01DcE036EfF46e079` |
| Currency1 / TOKB | `0x7BC67f7Fd3892fBE6AcC4F10bc3df95b64c2eD80` |
| Pool ID | `0x0decaeb998563be8faf6e6b66d4a0c32025a166e35bae97b8ec62ded1b04be1b` |

Live proof:

- CNF ZK mint tx: `0x8c0ca35cb666d839b7070ed8103d12379b12ccb399283fcacaf5caa8b86e4542`
- Current-stack add liquidity / swap: pending re-run after local RPC/TLS instability clears; router happy path is covered by the Solidity integration tests.

## License

MIT
