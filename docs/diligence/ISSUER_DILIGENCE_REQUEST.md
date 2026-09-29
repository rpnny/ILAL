# Real Asset A issuer pilot — diligence request

The issuer pilot reuses the already verified `.3` lifecycle with an independently generated verifier and an Asset A controlled by the participating issuer. ILAL does not ask the issuer to delegate production keys or disclose KYC/KYB records.

## Public or hash-bound inputs

- issuer organization reference and jurisdiction;
- Asset A test-network contract, symbol, decimals and issuance-controller address;
- issuer-controlled policy-administrator address;
- issuer-approved settlement asset and operator;
- seven distinct pilot role addresses;
- issuer/schema identifiers, credential root, jurisdiction root and public policy hash;
- on-chain transaction hashes and fixed-block evidence;
- SHA-256 digests of the issuer acceptance and supporting private documents.

## Private data-room inputs

- legal-entity and authorized-signer evidence;
- controller/Safe ownership evidence for Asset A and the policy administrator;
- identity-provider relationship and data-processing boundary;
- internal approval to conduct the testnet pilot;
- signed acknowledgement of the product and responsibility boundaries;
- incident and key-compromise contacts.

No identity records, private witnesses, customer lists, signing keys or personal data belong in the public repository.

## Issuer decisions

The issuer selects Asset A, approves Asset B, defines eligibility, authorizes policy-root publication, chooses its controller and policy Safe, approves LP participation and decides whether the completed evidence is acceptable for further diligence.

## Technical acceptance

The fresh run must prove real source-2 grants, 170/140/30 execution, issuer-triggered root retirement, unchanged state and nonces on the stale-order revert, nonzero LP fee collection, full LP exit, zero transient inventory and independent historical verification. Acceptance is recorded with `real-issuer-pilot-acceptance-v1`.
