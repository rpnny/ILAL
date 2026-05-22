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

```bash
# 1. Point CLI at the live demo deployment
ilal init

# 2. Check credential + pool status
ilal status

# 3. Mint a CNF via ZK proof
#    Requires the issuer root to already include your wallet.
PRIVATE_KEY=0x... ilal credential prove --wallet 0xYourWallet

# 4. Execute a compliant swap
PRIVATE_KEY=0x... ilal swap --amount-in 0.001 --token-in 0x2E0dEd1CF4ec6106079df4eF1200959c2a454f3A --min-amount-out 0
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

```bash
PRIVATE_KEY=0x... ilal credential prove --wallet 0xYourWallet
```

Generates a Groth16 proof locally (~5s), verifies it on-chain, and mints/renews your CNF without revealing identity. If the Merkle root does not match, the issuer/operator must queue the updated root with `ilal oracle propose-root --root <newRoot>` and activate it after the timelock.

## Command reference

| Command | Description |
|---|---|
| `ilal init` | Create `.ilal.json` with contract addresses |
| `ilal status` | Dashboard: credential · issuer config · pool policy |
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
| `ilal deploy` | Deploy full ILAL contract stack |

## Configuration

The CLI reads `.ilal.json` in the current directory. Run `ilal init` to create it, or pass flags directly:

```bash
ilal swap \
  --router    0xd0aF4D1EFF36CB2a1E88017eA398dCaDe1Ac0040 \
  --hook      0x6C57b50Ef9286b132066012B19b291FB120ACa80 \
  --issuer    0xB13AE2498Df62A85768a4b783109C05fCf5A264a \
  --pool-id   0x16b3e7a5c52216925f705673b3ab25db5e6025da530cf53b3bcb5affeb18d95f \
  --amount-in 0.001
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0xB13AE2498Df62A85768a4b783109C05fCf5A264a` |
| ComplianceHook | `0x6C57b50Ef9286b132066012B19b291FB120ACa80` |
| ILALRouter | `0xd0aF4D1EFF36CB2a1E88017eA398dCaDe1Ac0040` |
| PolicyRegistry | `0x19fD4eCF4359fCc8d5E79916691a28c24A22a9B4` |

## License

MIT
