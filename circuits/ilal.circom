pragma circom 2.1.6;

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";
include "keccak256-circom/circuits/keccak.circom";
include "./helpers/merkle_proof.circom";

/*
 * ILALEligibility — proves a wallet holds a valid compliance credential
 * without revealing the wallet address or which specific attestation it used.
 *
 * ─── How it works ─────────────────────────────────────────────────────────────
 *
 * The ILAL operator maintains an off-chain Poseidon Merkle tree (depth 20)
 * of attested wallets.  Each leaf:
 *
 *   leaf = Poseidon(walletField, kycLevel, countryCode, expiresAt)
 *
 * The operator publishes the Merkle root on-chain (CNFIssuer.merkleRoot).
 * To mint a CNF anonymously, the user generates a Groth16 proof of:
 *
 *   1. They know a wallet whose keccak256 hash equals walletHash (binds to
 *      msg.sender in the contract, so only the actual wallet can use the proof).
 *   2. That wallet is a leaf in the approved attestation Merkle tree.
 *   3. expiresAt is the timestamp recorded in the attestation.
 *
 * ─── Public signals (match PI_* constants in CNFIssuer.sol) ──────────────────
 *
 *   [0] walletHash  — keccak256(wallet_bytes) >> 4  (BN254 field-safe)
 *   [1] issuerHash  — Poseidon(issuerAddress)        (deployment constant)
 *   [2] schemaHash  — Poseidon(schemaUID_lo, schemaUID_hi) (protocol constant)
 *   [3] expiresAt   — credential expiry (unix timestamp from attestation)
 *   [4] revealFlags — bitmask (0 = reveal nothing extra)
 *   [5] merkleRoot  — root of the approved attestation Merkle tree
 *
 * DEPTH = 20 supports 2^20 ≈ 1 M eligible wallets.
 */
template ILALEligibility(DEPTH) {

    // ─── Private inputs ───────────────────────────────────────────────────────

    // wallet address as a BN254 field element (uint160 always fits)
    signal input walletField;

    // Same address as 160 bits, LSB-first (walletBits[0] = bit 0 = LSB).
    // Used to compute keccak256 without revealing the value.
    signal input walletBits[160];

    signal input kycLevel;    // KYC tier: 0=none 1=basic 2=advanced 3=institutional
    signal input countryCode; // ISO 3166-1 numeric (e.g., 840 = USA)

    signal input merklePathElements[DEPTH];
    signal input merklePathIndices[DEPTH];

    // ─── Public inputs ────────────────────────────────────────────────────────
    // Declared as inputs (not outputs) so we control their index ordering.
    // The circuit adds equality constraints to bind them to private values.

    signal input walletHash;   // PI[0]
    signal input issuerHash;   // PI[1] — checked by CNFIssuer, not constrained here
    signal input schemaHash;   // PI[2] — checked by CNFIssuer, not constrained here
    signal input expiresAt;    // PI[3]
    signal input revealFlags;  // PI[4] — must be 0 (no extra reveals)
    signal input merkleRoot;   // PI[5] — must match CNFIssuer.merkleRoot on-chain

    // ─── 1. Verify walletBits encodes walletField ─────────────────────────────
    // Bits2Num expects bits[0]=LSB — matches our walletBits convention.
    component bits2num = Bits2Num(160);
    for (var i = 0; i < 160; i++) {
        bits2num.in[i] <== walletBits[i];
    }
    bits2num.out === walletField;

    // ─── 2. walletHash = keccak256(wallet_20_bytes) >> 4 ─────────────────────
    // keccak256-circom uses LSB-first within each byte, bytes in big-endian order.
    // keccak.in[b*8+j] = bit j (0=LSB) of address byte b (b=0 is MSB byte).
    //
    // walletBits[k] = bit k of walletField (0=LSB of full 160-bit number).
    // bit j of address byte b = walletBits[(19-b)*8 + j].
    // For keccak input index i: b=i\8, j=i%8 → walletBits[(19-i\8)*8 + i%8]
    //   = walletBits[152 - i + 2*(i%8)]
    component keccak = Keccak(160, 256);
    for (var i = 0; i < 160; i++) {
        keccak.in[i] <== walletBits[152 - i + 2*(i%8)];
    }

    // keccak.out[b*8+j] = bit j (0=LSB) of hash byte b.
    // hash >> 4 as a 252-bit number: bit k (0=LSB) = hash bit (k+4).
    // hash bit (k+4) is at keccak.out index (31-(k+4)\8)*8 + (k+4)%8
    //   = 244 - k + 2*((k+4)%8)
    component hashNum = Bits2Num(252);
    for (var k = 0; k < 252; k++) {
        hashNum.in[k] <== keccak.out[244 - k + 2*((k+4)%8)];
    }
    walletHash === hashNum.out;

    // ─── 3. Compute Merkle leaf ───────────────────────────────────────────────
    component leaf = Poseidon(4);
    leaf.inputs[0] <== walletField;
    leaf.inputs[1] <== kycLevel;
    leaf.inputs[2] <== countryCode;
    leaf.inputs[3] <== expiresAt;

    // ─── 4. Verify Merkle inclusion ───────────────────────────────────────────
    component merkle = MerkleProof(DEPTH);
    merkle.leaf <== leaf.out;
    for (var i = 0; i < DEPTH; i++) {
        merkle.pathElements[i] <== merklePathElements[i];
        merkle.pathIndices[i]  <== merklePathIndices[i];
    }
    merkleRoot === merkle.root;

    // ─── 5. Policy constraints ────────────────────────────────────────────────
    // kycLevel must be in [0, 3]
    component kycLt = LessThan(4);
    kycLt.in[0] <== kycLevel;
    kycLt.in[1] <== 4;
    kycLt.out   === 1;

    // expiresAt must be non-zero (a real expiry was set)
    component expiryGt = GreaterThan(64);
    expiryGt.in[0] <== expiresAt;
    expiryGt.in[1] <== 0;
    expiryGt.out   === 1;

    // revealFlags must be 0 — no extra attributes revealed in this version
    revealFlags === 0;
}

// Public input ordering (must match PI_* constants in CNFIssuer.sol):
//   [0]=walletHash  [1]=issuerHash  [2]=schemaHash
//   [3]=expiresAt   [4]=revealFlags [5]=merkleRoot
component main {
    public [walletHash, issuerHash, schemaHash, expiresAt, revealFlags, merkleRoot]
} = ILALEligibility(20);
