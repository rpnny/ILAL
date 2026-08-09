# ILAL v2 issuer integration kit

This guide is for an RWA protocol, regulated DeFi application, fund manager,
or credential issuer evaluating ILAL on a sandbox network. It does not require
the issuer to send PII, KYC documents, API keys, or private keys to ILAL.

## Responsibility boundary

```text
KYC provider                  Issuer                         ILAL
identity checks  ->  PII-free decision  ->  encrypted Merkle tree
                                                 |
                                      policy root through Safe
                                                 |
institution <- private wallet witness <- issuer operator
      |
local Groth16 proof -> short-lived grant -> Uniswap v4 Hook
```

The KYC provider decides whether its checks passed. The issuer owns the trust
domain, credential tree, policy, and revocation process. ILAL proves and
enforces the issuer's decision without becoming the identity custodian.

## Data contract

ILAL accepts JSON or CSV decisions. The canonical JSON schema is
[`issuer-credential-decisions.schema.json`](schemas/issuer-credential-decisions.schema.json).
Example payloads are under [`docs/examples`](examples/).

Required decision fields:

| Field | Meaning |
|---|---|
| `wallet` | Wallet that will activate the grant |
| `kycLevel` | Private issuer-defined tier from 0 to 3 |
| `countryCode` | Private ISO 3166-1 numeric code |
| `status` | Approved/active or rejected/revoked |
| `expiresAt` | Source credential expiry; an import default may be used |
| `verificationId` | Optional provider reference; only its hash is retained |

Do not put names, addresses, document identifiers, tax identifiers, or raw KYC
payloads into these files. The CLI rejects undocumented JSON/CSV fields rather
than silently accepting possible PII. The source decision file remains
issuer-controlled.

## 1. Create the encrypted issuer store

Create a dedicated password file and restrict it before invoking the CLI:

```bash
openssl rand -base64 32 > issuer-store.password
chmod 600 issuer-store.password

ilal issuer tree init \
  --issuer "Partner Sandbox Issuer" \
  --schema "institutional-kyc-v1" \
  --allow-countries 840,826,756 \
  --min-kyc-level 2 \
  --max-grant-ttl 86400 \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password
```

The store is AES-256-GCM encrypted with a scrypt-derived key and written with
mode `600`. It contains wallet-level credential attributes, but no PII fields.
Back it up using the issuer's normal encrypted secrets process.

## 2. Import KYC decisions

Use a provider export, a webhook-to-file adapter, or the supplied examples:

```bash
ilal issuer tree import \
  --file ./issuer-decisions.json \
  --default-expires-in-days 365 \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password
```

CSV uses these headers:

```text
wallet,kycLevel,countryCode,expiresAt,status,verificationId
```

The tree is deterministic: the same active records and policy produce the same
credential root regardless of import order. Rejected records that were never
active are ignored. A rejected or revoked active wallet is removed from the
next root.

## 3. Review and publish the policy commitment

```bash
ilal issuer tree root \
  --out ./artifacts/issuer-policy.json \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password
```

The command prints a complete `ilal policy admin set` command containing:

- issuer and schema hashes;
- credential and jurisdiction roots;
- minimum KYC tier;
- complete policy hash;
- maximum grant TTL.

Run that command with `--safe 0xIssuerSafe` to produce a reviewable Safe
proposal. Every successful policy set increments the on-chain revision and
invalidates every grant from the previous revision.

## 4. Export a wallet-bound private witness

```bash
ilal issuer tree export-witness \
  --wallet 0xInstitutionWallet \
  --out ./private/issuer-witness-a.json \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password
```

Export fails when the credential is revoked, expired, below the policy tier,
or outside the jurisdiction tree. The witness is mode `600` and contains the
private KYC tier, country, and Merkle paths. Deliver it only to the wallet owner
over an authenticated encrypted channel. Never upload it to a public proving
service or commit it to source control.

The institution then runs locally:

```bash
ilal policy proof generate \
  --input ./private/issuer-witness-a.json \
  --circuit-dir ./circuits/build-v2 \
  --out-dir ./artifacts/v2-proof

ilal --keystore ./institution-wallet.json \
  --password-file ./institution-wallet.password \
  policy grant activate \
  --proof ./artifacts/v2-proof/proof.json \
  --public ./artifacts/v2-proof/public.json
```

## 5. Revoke and rotate

Remove a wallet from future proofs:

```bash
ilal issuer tree revoke \
  --wallet 0xInstitutionWallet \
  --store ./private/issuer.enc.json \
  --store-password-file ./issuer-store.password
```

Publish the resulting policy root through the Safe. The revision change
invalidates all prior grants, including the revoked wallet's grant. For an
immediate single-wallet response before root publication, the Grant Manager
owner can also execute:

```bash
ilal --safe 0xIssuerSafe policy grant revoke --wallet 0xInstitutionWallet
```

## Provider webhook mapping

A provider-specific service should map only the final decision into the ILAL
schema and call `ilal issuer tree import`. Keep webhook authentication,
provider payloads, retries, and PII inside the issuer's environment. ILAL does
not require or operate a hosted identity API.

Recommended operational sequence:

1. authenticate and verify the provider webhook signature;
2. persist the original event in the issuer's regulated system of record;
3. map the final decision to the PII-free ILAL schema;
4. import the decision into the encrypted tree;
5. review the root delta;
6. submit the new policy through the issuer Safe;
7. send the wallet witness through an authenticated encrypted channel;
8. retain the policy revision, transaction, and provider-reference hash for audit.

## Sandbox acceptance

Use four unrelated Base Sepolia wallets: issuer Safe/Admin, institution A,
market maker B, and non-eligible control C. The sandbox passes when:

- A independently proves and swaps;
- B independently proves and adds liquidity;
- funded C is blocked before approval or broadcast;
- A cannot use B's proof or session;
- a grant revoke blocks the next action;
- a policy revision invalidates all old grants;
- policy disable stops new swaps and liquidity additions.

This kit is testnet PoC software. Production use still requires a production
ceremony, independent security review, issuer governance, key-management
controls, and jurisdiction-specific legal analysis.
