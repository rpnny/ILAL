# ILAL Eligibility Policy Circuit v2

This directory is an isolated design candidate. It does not replace the live
v1 circuit, verifier, CNFIssuer ABI, or Base Sepolia deployment.

The v2 circuit proves that a wallet belongs to an issuer/schema-bound
credential tree, has a private KYC tier at or above the pool minimum, and has a
private country code in the pool's jurisdiction tree. The actual tier and
country are not public signals.

## Public Inputs

| Index | Signal | Purpose |
|---|---|---|
| 0 | `walletHash` | Binds the proof to the calling wallet |
| 1 | `issuerHash` | Issuer trust domain |
| 2 | `schemaHash` | Credential schema trust domain |
| 3 | `expiresAt` | Source credential expiry |
| 4 | `credentialRoot` | Issuer credential tree |
| 5 | `minKycLevel` | Pool's public minimum tier |
| 6 | `jurisdictionRoot` | Pool's allowed-country set commitment |
| 7 | `policyHash` | Commitment to version/domain/roots/minimum |
| 8 | `circuitVersion` | Fixed to `2` |

`policyHash` is constrained as:

```text
Poseidon(2, issuerHash, schemaHash, credentialRoot, minKycLevel, jurisdictionRoot)
```

Credential leaves are domain-bound:

```text
Poseidon(wallet, kycLevel, countryCode, expiresAt, issuerHash, schemaHash)
```

This closes the v1 domain-portability gap where issuer/schema values were
checked by the contract but were not part of a circuit constraint.

## Constraint Test

```bash
cd circuits
npm run test:v2
```

The test accepts one valid witness and rejects:

- a credential below the pool's minimum KYC tier;
- a country outside the jurisdiction tree;
- a credential proof moved to another issuer domain;
- a modified policy commitment.

No production zkey or verifier is created by this test. A production Phase-2
ceremony and a v2 verifier/issuer adapter are separate launch gates.

## Base Sepolia verifier build

An explicitly unsafe development ceremony is available for end-to-end
testnet validation:

```bash
cd circuits
ILAL_UNSAFE_DEV_CEREMONY=1 bash scripts/compile_v2.sh
```

This produces `build-v2/` artifacts and
`contracts/src/verifier/ILALPolicyVerifierV2.sol`. The zero-beacon development
zkey is never suitable for mainnet or customer assets. Production requires a
reviewed multi-party Phase-2 ceremony and a retained transcript.
