// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library SessionLib {
    error InvalidSignatureLength();

    // secp256k1n / 2. Rejecting larger s values removes the ECDSA
    // malleability accepted by raw ecrecover, matching EIP-2/OZ ECDSA.
    uint256 constant SECP256K1_HALF_ORDER = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    bytes32 constant SESSION_TOKEN_TYPEHASH = keccak256(
        "SessionToken(address user,address authorizedCaller,address cnfIssuer,uint256 chainId,address verifyingHook,bytes32 poolId,uint8 action,uint64 deadline,bytes32 nonce)"
    );

    uint8 constant ACTION_SWAP = 1;
    uint8 constant ACTION_ADD_LIQUIDITY = 2;
    uint8 constant ACTION_REMOVE_LIQUIDITY = 3;

    struct SessionToken {
        address user;
        address authorizedCaller;
        address cnfIssuer;
        uint256 chainId;
        address verifyingHook;
        bytes32 poolId;
        uint8 action;
        uint64 deadline;
        bytes32 nonce;
    }

    function structHash(SessionToken memory token) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SESSION_TOKEN_TYPEHASH,
                token.user,
                token.authorizedCaller,
                token.cnfIssuer,
                token.chainId,
                token.verifyingHook,
                token.poolId,
                token.action,
                token.deadline,
                token.nonce
            )
        );
    }

    function digest(SessionToken memory token, bytes32 domainSeparator) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash(token)));
    }

    function recover(SessionToken memory token, bytes32 domainSeparator, bytes memory sig)
        internal
        pure
        returns (address)
    {
        return recoverFromDigest(digest(token, domainSeparator), sig);
    }

    function recoverFromDigest(bytes32 h, bytes memory sig) internal pure returns (address) {
        if (sig.length != 65) revert InvalidSignatureLength();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (uint256(s) > SECP256K1_HALF_ORDER) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(h, v, r, s);
    }
}
