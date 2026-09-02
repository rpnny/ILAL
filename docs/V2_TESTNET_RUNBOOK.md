# ILAL v2 Base Sepolia PoC runbook

This runbook turns the isolated v2 implementation into public testnet
evidence. The checked-in v2 verifier uses an unsafe development ceremony and
is suitable only for Base Sepolia. It must never secure mainnet or customer
assets.

## Latest reproducible public Base Sepolia flow

The `v0.4.0-v2-poc.7` CLI deployed and exercised a fresh isolated V2 stack on
2026-08-30 from commit `8e241398b22e`. It is separate from the SOEE netting
candidate: this flow demonstrates **Groth16 proof → cached Policy Grant →
one-time session → Hook-gated LP / swap** and does not perform atomic netting.

| Component | Address |
|---|---|
| ComplianceHookV2 | `0x9238103A1bd611461E1bDcB2084D166EB7AeCA80` |
| ILALRouter | `0x0F948da2f54D9d0Ab31169D854dc655eEB3D1472` |
| EligibilityPolicyRegistryV2 | `0x936afAca590957f446B1603DbA6eC3Af298a039a` |
| PolicyGrantManagerV2 | `0xeF0e54C22361fE567157f6302Ae0363474f6d4E3` |
| Groth16VerifierAdapterV2 | `0x3144B398057642252622266E840dAc8a2CC6Ac6E` |
| ILALPolicyVerifierV2 | `0x7C2ef9A7eBb263F3Dd1007a2Eb4068fde11AF39e` |
| V2B / currency0 | `0x4d55dd928dDF9cD79E128293a6FfD03197F0E4a2` |
| V2A / currency1 | `0x9388a5E1cF129015F86503D140B702C37801Ea85` |
| Pool ID | `0xdcf7ee831d054402ff0550b7a627f337dc60d24513928d082af777b6dd1c4405` |

Fresh public evidence:

- [Groth16 Policy Grant activation](https://sepolia.basescan.org/tx/0x863f7d8c7c43ae1089258627ac30fd93ff4536cd67dd7b65a6bb84547862a5fc)
- [automated Hook-gated liquidity add](https://sepolia.basescan.org/tx/0x4417844945fb34d9ae2203332234d0d10f44081faf81682bdb85b5d1a9b8bd1d)
- [automated Hook-gated swap](https://sepolia.basescan.org/tx/0x7696d1eec1d31f517cfcefb84d5f37fc184ce11c2098a34908c28dda2c5422e2)
- [manual Hook-gated liquidity add](https://sepolia.basescan.org/tx/0x7eaebb8ff4ec1d69f89c259087fb9a150939cf851feec1a18f06908ced2b1961)
- [manual V2 verified-flow swap](https://sepolia.basescan.org/tx/0xc828655de7a48fd8d10a324da81b1f532081729ed8349801b993dfe8329922f4)

The manual swap spent `0.001 V2A`, received
`0.000997007234157933 V2B`, emitted the 0.05% verified LP-fee decision plus
`ProtocolFeePaid` and `SwapRouted`, and used 194,724 gas. In this test deployment
the trader and protocol treasury are the same EOA, so the protocol-fee event is
evidence of code-path execution, not independent revenue transfer.

All six protocol contracts are Sourcify `exact_match` and BaseScan-native
verified, so BaseScan exposes their source, ABI, read/write surfaces and decoded
events. See the
[`public candidate manifest`](hookathon/v2-public-candidate-manifest.json) or
inspect the verified [`Hook`](https://sepolia.basescan.org/address/0x9238103A1bd611461E1bDcB2084D166EB7AeCA80#code),
[`Router`](https://sepolia.basescan.org/address/0x0F948da2f54D9d0Ab31169D854dc655eEB3D1472#code),
[`Registry`](https://sepolia.basescan.org/address/0x936afAca590957f446B1603DbA6eC3Af298a039a#code), and
[`GrantManager`](https://sepolia.basescan.org/address/0xeF0e54C22361fE567157f6302Ae0363474f6d4E3#code).
The reproducible verification command remains
`scripts/verify-v2-public-candidate.sh`.

## Historical public Base Sepolia candidate

The earlier `v0.4.0-v2-poc.1` candidate was deployed on 2026-08-07 from source commit
`a4f658db84aad3f16998380dbf212b3bff30b5b3`. It is public testnet evidence,
not the active v1 CLI preset and not a production deployment.

| Component | Address |
|---|---|
| ComplianceHookV2 | `0xD7E3280bf895C43BC74baA1FB190e775C5864A80` |
| ILALRouter | `0xcADfb9d8a468832A6B24b088c214178B00A3fD47` |
| EligibilityPolicyRegistryV2 | `0x48eB31FB6496058FEd112053EE07fAF557565325` |
| PolicyGrantManagerV2 | `0xb19121e6CE972A1d1f23910e3d22924D47e43C11` |
| Groth16VerifierAdapterV2 | `0xaa204E50309e41d33f60D7d23D070B796AeF7330` |
| ILALPolicyVerifierV2 | `0x97d495E891384b6BFB85ca8ABfB373aFfd606807` |
| V2A | `0x67b341da917749f97432aeEFe888CF7Fd229FD77` |
| V2B | `0xF494949d51a7285Eb082c1D8bFAFD56BfC471C37` |
| Pool ID | `0x524f781c2c66c8617f3b38c12ca2bf70e4639c3923fc0f63bdb315dda0a104a4` |

Public transaction evidence:

- [policy grant activation](https://sepolia.basescan.org/tx/0x1a0096ddf0518cc9e0dde92ecdfdf663c5f4e2466ce495714cfaaa9b88fd76d8)
- [hook-gated liquidity add](https://sepolia.basescan.org/tx/0x3023ea73bb88b53011e4ab8c7e499e1c75c37431dfd893e772cfe7edce14cc38)
- [hook-gated swap](https://sepolia.basescan.org/tx/0x531b0381d21e4e56e39aaf15d2c02cdffc3437e0b8a0378be3453d175efb1b60)

All newly deployed contracts are exact-matched on Sourcify. Constructor data,
bytecode hashes, policy evidence, roles, and proving-artifact hashes are in the
[`v2 candidate manifest`](../deployments/base-sepolia/v0.4.0-v2-poc.1.json).

## What the flow proves

```text
private tier + private country + issuer credential membership
                         |
                         v
                local Groth16 proof
                         |
                         v
              PolicyGrantManagerV2
                         |
              short-lived pool grant
                         |
                         v
       session -> ILALRouter -> ComplianceHookV2 -> Uniswap v4
```

The public inputs bind the wallet, issuer, schema, credential root, source
expiry, minimum KYC level, jurisdiction root, complete policy commitment, and
circuit version. The actual KYC tier and country remain private witness values.

## 1. Verify the source and proving artifacts

```bash
cd circuits
npm run test:v2
shasum -a 256 -c build-v2/SHA256SUMS

cd ../contracts
forge test --summary
```

If the development artifacts do not exist, recreate them explicitly:

```bash
cd circuits
ILAL_UNSAFE_DEV_CEREMONY=1 bash scripts/compile_v2.sh
```

## 2. Create a deployment keystore

Use a fresh Base Sepolia-only account. Do not put a private key in shell
history, process arguments, source control, or this document.

```bash
cast wallet import ilal-v2-deployer --interactive
cast wallet list
```

Fund the resulting address with Base Sepolia ETH and prepare a password file
with mode `600` if the CLI run is non-interactive.

## 3. Deploy the v2 stack

```bash
node cli/dist/index.js \
  --keystore "$HOME/.foundry/keystores/ilal-v2-deployer" \
  --password-file ./deployer.password \
  deploy \
  --v2 \
  --chain 84532 \
  --broadcast \
  --admin 0xAdminSafe \
  --treasury 0xTreasury \
  --wallet-to-seed 0xPolicyWallet \
  --contracts-dir ./contracts
```

The command generates and locally verifies a wallet-bound proof before Forge
deploys:

- `ILALPolicyVerifierV2`
- `Groth16VerifierAdapterV2`
- `EligibilityPolicyRegistryV2`
- `PolicyGrantManagerV2`
- `ILALRouter`
- a CREATE2-mined `ComplianceHookV2`
- two test ERC-20s
- a dynamic-fee Uniswap v4 pool with policy revision 1

Generated witness inputs stay under ignored `artifacts/v2-demo/`. They can
contain private attributes and must not be published.

The deployment also writes a machine-readable `deployment.json` next to the
proof. Treat it as a candidate manifest until every address and transaction is
verified against the public RPC.

## 4. Initialize the CLI configuration

Use the addresses and Pool ID printed by the deployment:

```bash
ilal init --force \
  --protocol-version 2 \
  --chain 84532 \
  --hook 0x9238103A1bd611461E1bDcB2084D166EB7AeCA80 \
  --registry 0x936afAca590957f446B1603DbA6eC3Af298a039a \
  --grant-manager 0xeF0e54C22361fE567157f6302Ae0363474f6d4E3 \
  --router 0x0F948da2f54D9d0Ab31169D854dc655eEB3D1472 \
  --treasury 0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58 \
  --token-a 0x4d55dd928dDF9cD79E128293a6FfD03197F0E4a2 \
  --token-b 0x9388a5E1cF129015F86503D140B702C37801Ea85 \
  --pool-id 0xdcf7ee831d054402ff0550b7a627f337dc60d24513928d082af777b6dd1c4405 \
  --fee 8388608 \
  --tick-spacing 60
```

## 5. Activate the ZK policy grant

An issuer or institution can generate a proof from its own complete circuit
input without using the deployment helper:

```bash
ilal policy proof generate \
  --input ./private/policy-input.json \
  --circuit-dir ./circuits/build-v2 \
  --out-dir ./artifacts/v2-proof
```

The input file is read locally and is not copied or uploaded. The policy wallet
then submits the proof generated for that exact address:

```bash
ilal --keystore ./policy-wallet.json \
  --password-file ./policy-wallet.password \
  policy grant activate \
  --proof ./artifacts/v2-proof/proof.json \
  --public ./artifacts/v2-proof/public.json

ilal policy grant status --wallet 0xPolicyWallet
```

Record the successful grant transaction and verify the emitted
`PolicyGrantActivated` event, policy hash, revision, wallet, and expiry.

## 6. Add liquidity and swap

```bash
ilal --keystore ./policy-wallet.json \
  --password-file ./policy-wallet.password \
  pool add-liquidity \
  --tick-lower -600 \
  --tick-upper 600 \
  --liquidity 1000000000000000000 \
  --max-amount-0 <positive-raw-cap> \
  --max-amount-1 <positive-raw-cap>

ilal --keystore ./policy-wallet.json \
  --password-file ./policy-wallet.password \
  swap \
  --amount-in 0.001 \
  --token-in 0xCurrency0 \
  --min-amount-out <positive-raw-quote>
```

The swap evidence must show the v2 grant, current policy revision, one-time
session bindings, dynamic 0.05% verified-flow LP fee, and confirmed transaction.

## 7. Operate and revoke policies

Policy changes and grant revocations support either a configured signer or an
offline Safe proposal via the global `--safe` options:

```bash
ilal --safe 0xAdminSafe policy admin set \
  --issuer-hash <field> \
  --schema-hash <field> \
  --credential-root <field> \
  --min-kyc-level 2 \
  --jurisdiction-root <field> \
  --policy-hash <field> \
  --max-grant-ttl 86400

ilal --safe 0xAdminSafe policy grant revoke --wallet 0xWallet
ilal --safe 0xAdminSafe policy admin disable
```

Every policy set increments its revision. Existing grants immediately become
stale even when the policy body is unchanged. Disabling a policy blocks new
swaps and liquidity additions; signed removal remains an exit path.

## 8. Negative evidence

Retain reproducible failures for:

1. a fresh wallet without a grant;
2. a proof generated for another wallet;
3. a low-tier witness;
4. a country outside the jurisdiction tree;
5. a proof moved to another issuer/schema domain;
6. a replayed session nonce;
7. an old grant/session after a policy revision;
8. an expired or explicitly revoked grant.

Tests are evidence of implemented behavior, not a substitute for an external
contract and circuit audit.

## 9. Reproduce the complete flow on a local fork

This command starts a fresh Base Sepolia fork and runs deployment, proof
activation, liquidity, swap, foreign-proof rejection, missing-grant rejection,
policy-revision invalidation, reactivation, revocation, and post-revocation
rejection:

```bash
./scripts/simulate-v2-fork.sh
```

Outputs are written under ignored `artifacts/v2-fork-simulation/`. Transaction
hashes from this run exist only on the local fork and must never be cited as
public Basescan evidence.
