pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "keccak256-circom/circuits/keccak.circom";
include "../helpers/merkle_proof.circom";

/*
 * ILALEligibilityPolicyV2
 *
 * Proves all of the following without revealing the wallet's actual KYC tier
 * or country code:
 *
 *   1. The prover controls the wallet represented by walletHash.
 *   2. The wallet's issuer/schema-bound credential is in credentialRoot.
 *   3. The private KYC tier is at least the pool's public minimum tier.
 *   4. The private country code is a member of the pool's jurisdiction tree.
 *   5. Every public policy field is bound into policyHash.
 *
 * Public signal layout:
 *   [0] walletHash
 *   [1] issuerHash
 *   [2] schemaHash
 *   [3] expiresAt
 *   [4] credentialRoot
 *   [5] minKycLevel
 *   [6] jurisdictionRoot
 *   [7] policyHash
 *   [8] circuitVersion (= 2)
 *
 * The credential leaf includes issuerHash and schemaHash. This prevents a
 * proof from being moved to another trust domain merely because two issuers
 * happen to publish the same wallet/attribute set.
 */
template ILALEligibilityPolicyV2(CREDENTIAL_DEPTH, JURISDICTION_DEPTH) {
    // Private credential attributes.
    signal input walletField;
    signal input walletBits[160];
    signal input kycLevel;
    signal input countryCode;

    signal input credentialPathElements[CREDENTIAL_DEPTH];
    signal input credentialPathIndices[CREDENTIAL_DEPTH];
    signal input jurisdictionPathElements[JURISDICTION_DEPTH];
    signal input jurisdictionPathIndices[JURISDICTION_DEPTH];

    // Public wallet, trust-domain, expiry, and pool-policy values.
    signal input walletHash;
    signal input issuerHash;
    signal input schemaHash;
    signal input expiresAt;
    signal input credentialRoot;
    signal input minKycLevel;
    signal input jurisdictionRoot;
    signal input policyHash;
    signal input circuitVersion;

    // walletBits must encode walletField.
    component bits2num = Bits2Num(160);
    for (var i = 0; i < 160; i++) {
        bits2num.in[i] <== walletBits[i];
    }
    bits2num.out === walletField;

    // walletHash = keccak256(wallet bytes) >> 4, matching CNFIssuer.
    component keccak = Keccak(160, 256);
    for (var i = 0; i < 160; i++) {
        keccak.in[i] <== walletBits[152 - i + 2*(i%8)];
    }

    component hashNum = Bits2Num(252);
    for (var k = 0; k < 252; k++) {
        hashNum.in[k] <== keccak.out[244 - k + 2*((k+4)%8)];
    }
    walletHash === hashNum.out;

    // Domain-bound credential leaf.
    component credentialLeaf = Poseidon(6);
    credentialLeaf.inputs[0] <== walletField;
    credentialLeaf.inputs[1] <== kycLevel;
    credentialLeaf.inputs[2] <== countryCode;
    credentialLeaf.inputs[3] <== expiresAt;
    credentialLeaf.inputs[4] <== issuerHash;
    credentialLeaf.inputs[5] <== schemaHash;

    component credentialMerkle = MerkleProof(CREDENTIAL_DEPTH);
    credentialMerkle.leaf <== credentialLeaf.out;
    for (var i = 0; i < CREDENTIAL_DEPTH; i++) {
        credentialMerkle.pathElements[i] <== credentialPathElements[i];
        credentialMerkle.pathIndices[i] <== credentialPathIndices[i];
    }
    credentialRoot === credentialMerkle.root;

    // KYC tiers and the pool minimum are restricted to [0, 3].
    component tierRange = LessThan(3);
    tierRange.in[0] <== kycLevel;
    tierRange.in[1] <== 4;
    tierRange.out === 1;

    component minimumRange = LessThan(3);
    minimumRange.in[0] <== minKycLevel;
    minimumRange.in[1] <== 4;
    minimumRange.out === 1;

    component tierEligible = GreaterEqThan(3);
    tierEligible.in[0] <== kycLevel;
    tierEligible.in[1] <== minKycLevel;
    tierEligible.out === 1;

    // ISO 3166-1 numeric codes are nonzero three-digit values.
    component countryPositive = GreaterThan(10);
    countryPositive.in[0] <== countryCode;
    countryPositive.in[1] <== 0;
    countryPositive.out === 1;

    component countryRange = LessThan(10);
    countryRange.in[0] <== countryCode;
    countryRange.in[1] <== 1000;
    countryRange.out === 1;

    // Domain-separated country leaf. The constant prevents a raw country code
    // from being confused with a node or with another Merkle-tree leaf type.
    component jurisdictionLeaf = Poseidon(2);
    jurisdictionLeaf.inputs[0] <== countryCode;
    jurisdictionLeaf.inputs[1] <== 2;

    component jurisdictionMerkle = MerkleProof(JURISDICTION_DEPTH);
    jurisdictionMerkle.leaf <== jurisdictionLeaf.out;
    for (var i = 0; i < JURISDICTION_DEPTH; i++) {
        jurisdictionMerkle.pathElements[i] <== jurisdictionPathElements[i];
        jurisdictionMerkle.pathIndices[i] <== jurisdictionPathIndices[i];
    }
    jurisdictionRoot === jurisdictionMerkle.root;

    component expiryPositive = GreaterThan(64);
    expiryPositive.in[0] <== expiresAt;
    expiryPositive.in[1] <== 0;
    expiryPositive.out === 1;

    circuitVersion === 2;

    // Commit the complete public policy domain. A verifier adapter / issuer
    // must check this hash against the policy registered for the target pool.
    component policyCommitment = Poseidon(6);
    policyCommitment.inputs[0] <== circuitVersion;
    policyCommitment.inputs[1] <== issuerHash;
    policyCommitment.inputs[2] <== schemaHash;
    policyCommitment.inputs[3] <== credentialRoot;
    policyCommitment.inputs[4] <== minKycLevel;
    policyCommitment.inputs[5] <== jurisdictionRoot;
    policyHash === policyCommitment.out;
}

component main {
    public [
        walletHash,
        issuerHash,
        schemaHash,
        expiresAt,
        credentialRoot,
        minKycLevel,
        jurisdictionRoot,
        policyHash,
        circuitVersion
    ]
} = ILALEligibilityPolicyV2(20, 8);
