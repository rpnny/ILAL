# ILAL v0.3.3 demo runbook

## Current gate

The local software is `0.3.3-rc.1`. There is no active deployment and no public end-to-end demo today. npm `0.3.2` is deprecated; `0.2.21` is a legacy old-ABI release. The archived v0.3.2 Base Sepolia addresses must not be used for authorization or copied into a demo.

Before a live Demo Day run, complete the stable deployment gate with a newly supplied Base Sepolia Safe, fresh encrypted deployer, independent `ADMIN`/`TREASURY` manifest fields, full role handoff, verified code hashes, funded pool, positive/negative swap evidence, and updated active preset.

## Local source verification

```bash
make verify

cd cli
node dist/index.js --version     # 0.3.3-rc.1
node dist/index.js init          # network settings only; no stale addresses
node dist/index.js demo --commands
```

`demo --commands` is a presentation preview, not proof of an active chain deployment.

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

## Demo sequence after activation

Only after the deployment manifest becomes active:

1. `ilal init` selects the new manifest.
2. Show the release status: Base Sepolia demo, MockEAS, ZK experimental/disabled, unaudited, not production-ready.
3. Show an uncredentialed wallet rejected.
4. Create a MockEAS attestation and mint the CNF using encrypted keystores.
5. Run `ilal status` and show exact contract/policy state.
6. Quote the swap and pass a positive raw `--min-amount-out`.
7. Execute a valid swap and show the explorer transaction.
8. Attempt replay or a fresh-wallet swap and show rejection.

Never use `--unsafe-no-slippage` in the primary demo command. Do not claim a public “5-second ZK proof” unless the shown deployment actually has a verified ZK verifier, root, domain, and matching proving artifacts.
