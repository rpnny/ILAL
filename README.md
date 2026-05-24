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
PRIVATE_KEY=0x... ilal swap --amount-in 1 --token-in 0x589dDBdf4Bd6d605bD809a540FF4BC1066f6895e --min-amount-out 0
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
  --router    0xf7DBe6721AE935FA25D963076cd202994E0D5e17 \
  --hook      0x1623276697B4e6609F8887C9Caa9dB6A6fa08A80 \
  --issuer    0x18EF418Ca1C81d37BD3247D34c19Adc42306535F \
  --pool-id   0xf32ae7435348041d4e979a24ce417bfe71d0f6642d2dcb2326e01acfe660fa0d \
  --amount-in 0.001
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0x18EF418Ca1C81d37BD3247D34c19Adc42306535F` |
| MockEAS | `0x1B1867e5A98EA90865E3E3a21b31c2edAdBA7c09` |
| ZKVerifierAdapter | `0x9C918604069CFA897606760E53aB854BA38303Ca` |
| ComplianceHook | `0x1623276697B4e6609F8887C9Caa9dB6A6fa08A80` |
| ILALRouter | `0xf7DBe6721AE935FA25D963076cd202994E0D5e17` |
| PolicyRegistry | `0xB2A94DE0432c1dEDfa941816A450002C6581B0aD` |
| Currency0 / TOKB | `0x589dDBdf4Bd6d605bD809a540FF4BC1066f6895e` |
| Currency1 / TOKA | `0xA9C0AB8e7Bc6a79649903EdE052E1B41585cCd08` |
| Pool ID | `0xf32ae7435348041d4e979a24ce417bfe71d0f6642d2dcb2326e01acfe660fa0d` |

Live proof:

- CNF ZK mint tx: `0x3e770104228abc547664df2958ce8f88ddd6d66dd11a78fa1ba1b3569a75a8dc`
- Add liquidity tx: `0x39f82fdc8e8a8aa6fe1d6cd98adac15f79fdce2b99cc82955dd35eedef89b9d0`
- Swap tx: `0x3ff5b22707eb4172816359d61b1d97f0086b08c47f396fd44ee1c68471a7b8cc`

## License

MIT
