# ILAL v0.3.3 demo runbook

## Current gate

The software is `0.3.3` and the Safe-controlled Base Sepolia demo is active. npm `0.3.2` is deprecated; `0.2.21` is a legacy old-ABI release. The archived v0.3.2 addresses must not be used or copied into a demo.

The active manifest records the Safe, independent `ADMIN`/`TREASURY` fields, role handoff, code hashes, funded pool, and positive/negative swap evidence. This remains a MockEAS, unaudited, non-production testnet demo.

## Local source verification

```bash
make verify

cd cli
node dist/index.js --version     # 0.3.3
node dist/index.js init          # selects the v0.3.3 Base Sepolia preset
node dist/index.js demo --commands
```

`demo --commands` is a presentation preview; the versioned manifest and explorer transactions are the chain evidence.

## Deployment rehearsal

Use a fresh Web3 v3 keystore and a Safe address. Do not use `PRIVATE_KEY` compatibility for deployment.

```bash
chmod 600 ./deployer.password

node cli/dist/index.js \
  --keystore ./fresh-deployer.json \
  --password-file ./deployer.password \
  deploy \
  --chain 84532 \
  --mock \
  --admin 0xAdminSafe \
  --treasury 0xTreasury \
  --wallet-to-seed 0xDemoTrader
```

After deployment, do not immediately switch the preset. First record and verify every contract address, transaction, block, Pool ID, constructor argument, source/runtime/ABI hash, `owner()`, `treasury()`, `authorizedRouter()`, and PoolManager binding. Confirm the deployer holds no undeclared privilege.

## Administrative Safe proposal

```bash
node cli/dist/index.js \
  --safe 0xAdminSafe \
  --safe-output ./policy-proposal.json \
  safe propose \
  --to 0xPolicyRegistry \
  --data 0xEncodedPolicyCalldata \
  --chain 84532
```

Review the JSON target, calldata, value, operation, nonce, threshold, owners, and Safe transaction hash. Offline proposal is the default; execution and additional confirmations remain in the Safe workflow.

## Demo sequence

1. `ilal init` selects the new manifest.
2. Show the release status: Base Sepolia demo, MockEAS, ZK experimental/disabled, unaudited, not production-ready.
3. Show an uncredentialed wallet rejected.
4. Create a MockEAS attestation and mint the CNF using encrypted keystores.
5. Run `ilal status` and show exact contract/policy state.
6. Quote the swap and pass a positive raw `--min-amount-out`.
7. Execute a valid swap and show the explorer transaction.
8. Attempt replay or a fresh-wallet swap and show rejection.

Never use `--unsafe-no-slippage` in the primary demo command. Do not claim a public “5-second ZK proof” unless the shown deployment actually has a verified ZK verifier, root, domain, and matching proving artifacts.
