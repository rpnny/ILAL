// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

library SessionLibV2 {
    bytes32 internal constant SESSION_TOKEN_TYPEHASH = keccak256(
        "SessionTokenV2(address user,address authorizedCaller,uint256 policyHash,uint64 policyRevision,uint256 chainId,address verifyingHook,bytes32 poolId,uint8 action,uint64 deadline,bytes32 nonce)"
    );

    uint8 internal constant ACTION_SWAP = 1;
    uint8 internal constant ACTION_ADD_LIQUIDITY = 2;
    uint8 internal constant ACTION_REMOVE_LIQUIDITY = 3;

    /// @dev The first two fields intentionally match SessionLib.SessionToken so
    ///      the Router can enforce user/caller binding across protocol versions.
    struct SessionTokenV2 {
        address user;
        address authorizedCaller;
        uint256 policyHash;
        uint64 policyRevision;
        uint256 chainId;
        address verifyingHook;
        bytes32 poolId;
        uint8 action;
        uint64 deadline;
        bytes32 nonce;
    }

    function structHash(SessionTokenV2 memory token) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                SESSION_TOKEN_TYPEHASH,
                token.user,
                token.authorizedCaller,
                token.policyHash,
                token.policyRevision,
                token.chainId,
                token.verifyingHook,
                token.poolId,
                token.action,
                token.deadline,
                token.nonce
            )
        );
    }

    function digest(SessionTokenV2 memory token, bytes32 domainSeparator) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash(token)));
    }
}
