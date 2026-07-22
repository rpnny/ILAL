// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev Minimal ERC-1271 smart wallet mock.
///      Owner set at construction; delegates isValidSignature to ECDSA of owner key.
contract MockERC1271Wallet {
    bytes4 private constant MAGIC = 0x1626ba7e;
    bytes4 private constant FAIL = 0xffffffff;

    address public immutable owner;
    bool public rejectAll;

    constructor(address _owner) {
        owner = _owner;
    }

    function setRejectAll(bool reject) external {
        rejectAll = reject;
    }

    function isValidSignature(bytes32 hash, bytes memory sig) external view returns (bytes4) {
        if (rejectAll) return FAIL;
        if (sig.length != 65) return FAIL;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        address recovered = ecrecover(hash, v, r, s);
        return recovered == owner ? MAGIC : FAIL;
    }
}
