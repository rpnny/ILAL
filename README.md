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
PRIVATE_KEY=0x... ilal swap --amount-in 1 --token-in 0x582362E608F36850F6f641510d5D19C1EaB4cb27 --min-amount-out 0
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
| `ilal deploy --mock` | Deploy a seeded testnet demo stack with MockEAS, tokens, router, hook, and policy |
| `ilal demo faucet` | Mint mock demo TOKA/TOKB to a wallet |
| `ilal deploy` | Deploy full ILAL contract stack |

## Configuration

The CLI reads `.ilal.json` in the current directory. Run `ilal init` to create it, or pass flags directly:

```bash
ilal swap \
  --router    0x7727F0f3EBe99A558487394D001950ee6B33BB86 \
  --hook      0xF5066ad9c25F3f54cfb19609A60187C48C184A80 \
  --issuer    0xc4E032A7574016bd0e3d1a5BbFdE886af09CeD9A \
  --pool-id   0xc1c8f29d6f03b5cd18bf2b862d48f45cc338022a154945b89c4bcb0a3e11e87f \
  --amount-in 0.001
```

## Base Sepolia demo deployment

| Contract | Address |
|---|---|
| CNFIssuer | `0xc4E032A7574016bd0e3d1a5BbFdE886af09CeD9A` |
| ComplianceHook | `0xF5066ad9c25F3f54cfb19609A60187C48C184A80` |
| ILALRouter | `0x7727F0f3EBe99A558487394D001950ee6B33BB86` |
| PolicyRegistry | `0x910a3efDc426f3216738106dd0DC6EA696477233` |
| TokenA / TOKA | `0x582362E608F36850F6f641510d5D19C1EaB4cb27` |
| TokenB / TOKB | `0x6eBBdAC70EC422C512727B25c7F0D9120ed101Ff` |
| Pool ID | `0xc1c8f29d6f03b5cd18bf2b862d48f45cc338022a154945b89c4bcb0a3e11e87f` |

Live proof:

- CNF mint tx: `0x676ca67698eb8fed6c905c2b3a9536d4d056e89c199c41c44085a29db8b4d462`
- Add liquidity tx: `0x531fac3678878e4855471318b8ea39b2b2f3ced3d890d9d7c40721af296084ca`
- Swap tx: `0xdaf4136d305e546d6936715cc0101efb4dc88abcb779add9ee03591fdf555a5a`

## License

MIT
