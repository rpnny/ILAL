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

# 3. Mint a CNF via ZK proof (adds your wallet to the Merkle tree)
PRIVATE_KEY=0x... ilal credential prove --wallet 0xYourWallet --update-root

# 4. Execute a compliant swap
PRIVATE_KEY=0x... ilal swap --amount-in 0.001 --token-in 0x60Fa08963dD59724a188A37C7239fA89F97DB17D
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
PRIVATE_KEY=0x... ilal credential prove --wallet 0xYourWallet --update-root
```

Generates a Groth16 proof locally (~5s), verifies it on-chain, and mints/renews your CNF without revealing identity.

## Command reference

| Command | Description |
|---|---|
| `ilal init` | Create `.ilal.json` with contract addresses |
| `ilal status` | Dashboard: credential · issuer config · pool policy |
| `ilal credential prove` | ZK proof → mint or renew CNF (all-in-one) |
| `ilal credential mint` | Mint CNF via Coinbase EAS attestation |
| `ilal credential renew` | Renew CNF via EAS attestation |
| `ilal swap` | Compliant swap via ILALRouter |
| `ilal pool add-liquidity` | Add liquidity to a compliant pool |
| `ilal pool remove-liquidity` | Remove liquidity from a compliant pool |
| `ilal pool policy set` | Register compliance policy for a pool |
| `ilal pool policy get` | Read pool compliance policy |
| `ilal session sign` | Sign a standalone SessionToken |
| `ilal proof mint` | Mint CNF from existing proof.json + public.json |
| `ilal deploy` | Deploy full ILAL contract stack |

## Configuration

The CLI reads `.ilal.json` in the current directory. Run `ilal init` to create it, or pass flags directly:

```bash
ilal swap \
  --router    0x35fE5eE12C102e78f5AbfD24cfe803Ad5824ca7F \
  --hook      0x6a1e3d7441fE8610fB5e2d2066912326457e8A80 \
  --issuer    0x319c0F1cb46c85B42E051251c4db04BA6BD265a2 \
  --pool-id   0xab4f3b0242cd9c33e6564b8a63d21eec62b570e7df9e5ce01e88d26b8223fb59 \
  --amount-in 0.001
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0x319c0F1cb46c85B42E051251c4db04BA6BD265a2` |
| ComplianceHook | `0x6a1e3d7441fE8610fB5e2d2066912326457e8A80` |
| ILALRouter | `0x35fE5eE12C102e78f5AbfD24cfe803Ad5824ca7F` |
| PolicyRegistry | `0x72A425672c1D0FA95C75F5073e6DAf72194A1E0F` |

## License

MIT
