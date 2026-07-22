// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title IGroth16Verifier
/// @notice Interface for the Groth16 proof verifier generated from the ILAL Circom circuit.
///         The current circuit proves membership in an issuer-curated Merkle set while
///         keeping the committed KYC tier and country code private. Issuer policy decides
///         which records enter that set; this circuit version does not independently
///         enforce a per-pool jurisdiction or minimum-tier rule.
///
///         Public inputs layout (subject to circuit design):
///           [0] walletHash   — keccak256(wallet) >> 4 (field-safe)
///           [1] issuerHash   — Poseidon(uint160(issuer))
///           [2] schemaHash   — Poseidon(schemaUID_lo, schemaUID_hi)
///           [3] expiresAt    — credential expiry (unix timestamp)
///           [4] revealFlags  — must be zero in circuit v1
///           [5] merkleRoot   — issuer-curated eligibility tree root
interface IGroth16Verifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view returns (bool);
}
