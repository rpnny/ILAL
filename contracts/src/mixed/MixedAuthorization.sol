// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

abstract contract MixedAuthorization is EIP712 {
    mapping(address => mapping(uint8 => mapping(uint256 => uint256))) private _nonces;
    error InvalidAuthorization();
    error NonceUsed();
    event NonceCancelled(address indexed user, uint8 indexed namespace, bytes32 indexed nonce);
    constructor(string memory name) EIP712(name, "1") {}

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function nonceUsed(address user, uint8 space, bytes32 nonce) public view returns (bool) {
        uint256 n = uint256(nonce);
        return _nonces[user][space][n >> 8] & (1 << (n & 255)) != 0;
    }

    function cancelNonce(uint8 space, bytes32 nonce) external {
        require(space <= 5, "NAMESPACE");
        _consume(msg.sender, space, nonce);
        emit NonceCancelled(msg.sender, space, nonce);
    }

    function _consume(address user, uint8 space, bytes32 nonce) internal {
        if (nonceUsed(user, space, nonce)) revert NonceUsed();
        uint256 n = uint256(nonce);
        _nonces[user][space][n >> 8] |= 1 << (n & 255);
    }

    function _authorize(address user, bytes32 hash, uint64 deadline, bytes memory signature) internal view {
        if (
            user == address(0) || block.timestamp > deadline
                || !SignatureChecker.isValidSignatureNow(user, _hashTypedDataV4(hash), signature)
        ) revert InvalidAuthorization();
    }
}
