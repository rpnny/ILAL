// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ICNFIssuer} from "../../src/interfaces/ICNFIssuer.sol";

contract MockCNFIssuer is ICNFIssuer {
    mapping(address => bool) private _valid;
    mapping(address => uint256) private _tokenId;
    mapping(uint256 => Credential) private _credentials;
    uint256 private _nextTokenId;

    bytes32 public defaultCredentialType = keccak256("coinbase.kyc");

    function setValid(address wallet, bool valid) external {
        _valid[wallet] = valid;
        if (valid && _tokenId[wallet] == 0) {
            uint256 tokenId = ++_nextTokenId;
            _tokenId[wallet] = tokenId;
            _credentials[tokenId] = Credential(
                wallet, address(this), defaultCredentialType, uint64(block.timestamp), type(uint64).max, false
            );
        }
    }

    function setCredentialType(address wallet, bytes32 credentialType) external {
        if (_tokenId[wallet] == 0) {
            uint256 tokenId = ++_nextTokenId;
            _tokenId[wallet] = tokenId;
        }
        _credentials[_tokenId[wallet]] =
            Credential(wallet, address(this), credentialType, uint64(block.timestamp), type(uint64).max, false);
    }

    function isValid(address wallet) external view returns (bool) {
        return _valid[wallet];
    }

    function mintWithEAS(bytes32) external pure returns (uint256) {
        return 0;
    }
    function renewWithEAS(bytes32) external pure {}

    function mintWithProof(bytes calldata, uint256[] calldata) external pure returns (uint256) {
        return 0;
    }
    function renewWithProof(bytes calldata, uint256[] calldata) external pure {}
    function revoke(address) external pure {}

    function credentialOf(address wallet) external view returns (uint256) {
        return _tokenId[wallet];
    }

    function getCredential(uint256 tokenId) external view returns (Credential memory) {
        return _credentials[tokenId];
    }
}
