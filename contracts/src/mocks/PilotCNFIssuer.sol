// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ICNFIssuer} from "../interfaces/ICNFIssuer.sol";

/// @notice Testnet-only CNF source for an issuer-controlled pilot. It is not a KYC provider.
contract PilotCNFIssuer is ICNFIssuer, Ownable {
    bytes32 public immutable credentialType;
    uint256 private nextTokenId;
    mapping(address => uint256) private tokenByWallet;
    mapping(uint256 => Credential) private credentials;

    event PilotCredentialIssued(address indexed wallet, uint256 indexed tokenId, uint64 expiresAt);
    event PilotCredentialRevoked(address indexed wallet, uint256 indexed tokenId);

    constructor(address issuer, bytes32 credentialType_) Ownable(issuer) {
        require(issuer != address(0) && credentialType_ != bytes32(0), "PILOT_ISSUER_CONFIG");
        credentialType = credentialType_;
    }

    function issue(address wallet, uint64 expiresAt) external onlyOwner returns (uint256 tokenId) {
        require(wallet != address(0) && expiresAt > block.timestamp && tokenByWallet[wallet] == 0, "PILOT_CREDENTIAL");
        tokenId = ++nextTokenId;
        tokenByWallet[wallet] = tokenId;
        credentials[tokenId] =
            Credential(wallet, address(this), credentialType, uint64(block.timestamp), expiresAt, false);
        emit PilotCredentialIssued(wallet, tokenId, expiresAt);
    }

    function revoke(address wallet) external onlyOwner {
        uint256 tokenId = tokenByWallet[wallet];
        require(tokenId != 0 && !credentials[tokenId].revoked, "PILOT_CREDENTIAL");
        credentials[tokenId].revoked = true;
        emit PilotCredentialRevoked(wallet, tokenId);
    }

    function isValid(address wallet) external view returns (bool) {
        Credential storage credential = credentials[tokenByWallet[wallet]];
        return credential.holder == wallet && !credential.revoked && credential.expiresAt > block.timestamp;
    }

    function credentialOf(address wallet) external view returns (uint256) {
        return tokenByWallet[wallet];
    }

    function getCredential(uint256 tokenId) external view returns (Credential memory) {
        return credentials[tokenId];
    }

    function mintWithEAS(bytes32) external pure returns (uint256) {
        revert("PILOT_DIRECT_ISSUE_ONLY");
    }

    function renewWithEAS(bytes32) external pure {
        revert("PILOT_DIRECT_ISSUE_ONLY");
    }

    function mintWithProof(bytes calldata, uint256[] calldata) external pure returns (uint256) {
        revert("PILOT_DIRECT_ISSUE_ONLY");
    }

    function renewWithProof(bytes calldata, uint256[] calldata) external pure {
        revert("PILOT_DIRECT_ISSUE_ONLY");
    }
}
