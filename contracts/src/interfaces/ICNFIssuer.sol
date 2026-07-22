// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface ICNFIssuer {
    struct Credential {
        address holder;
        address issuer;
        bytes32 credentialType;
        uint64 issuedAt;
        uint64 expiresAt;
        bool revoked;
    }

    // ─── EAS path (MVP A) ─────────────────────────────────────────────────────

    function mintWithEAS(bytes32 attestationUID) external returns (uint256 tokenId);
    function renewWithEAS(bytes32 attestationUID) external;

    // ─── ZK proof path (MVP B) ────────────────────────────────────────────────

    function mintWithProof(bytes calldata proof, uint256[] calldata publicInputs) external returns (uint256 tokenId);
    function renewWithProof(bytes calldata proof, uint256[] calldata publicInputs) external;

    // ─── Management ───────────────────────────────────────────────────────────

    function revoke(address wallet) external;

    // ─── Views ────────────────────────────────────────────────────────────────

    function isValid(address wallet) external view returns (bool);
    function credentialOf(address wallet) external view returns (uint256 tokenId);
    function getCredential(uint256 tokenId) external view returns (Credential memory);
}
