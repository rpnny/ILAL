// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

library MixedTypes {
    uint8 internal constant BATCH_ORDER = 0;
    uint8 internal constant DIRECT_SWAP = 1;
    uint8 internal constant GRANT_ACTIVATION = 2;
    uint8 internal constant LP_ADD = 3;
    uint8 internal constant LP_EXIT = 4;
    uint8 internal constant LP_COLLECT = 5;
    bytes32 internal constant ORDER_TYPEHASH = keccak256(
        "MixedOrder(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint128 maxAmmInput,uint160 minSqrtPriceX96,uint160 maxSqrtPriceX96,uint64 deadline,bytes32 nonce)"
    );
    bytes32 internal constant DIRECT_TYPEHASH = keccak256(
        "MixedDirectSwap(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint128 maxAmmInput,uint160 minSqrtPriceX96,uint160 maxSqrtPriceX96,uint64 deadline,bytes32 nonce)"
    );
    bytes32 internal constant LP_TYPEHASH = keccak256(
        "MixedLiquidity(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,uint8 action,int24 tickLower,int24 tickUpper,int128 liquidityDelta,bytes32 userSalt,uint128 amount0Limit,uint128 amount1Limit,uint64 deadline,bytes32 nonce)"
    );
    bytes32 internal constant ACTIVATION_TYPEHASH = keccak256(
        "MixedActivation(address user,bytes32 poolId,bytes32 executionPolicyHash,uint64 policyRevision,uint8 source,uint256 acceptedRoot,uint64 rootEpoch,bytes32 evidenceHash,uint64 deadline,bytes32 nonce)"
    );
    bytes32 internal constant SET_TAG = keccak256("ILAL Mixed order set v1");

    struct Order {
        address user;
        bytes32 poolId;
        bytes32 executionPolicyHash;
        uint64 policyRevision;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint128 maxAmmInput;
        uint160 minSqrtPriceX96;
        uint160 maxSqrtPriceX96;
        uint64 deadline;
        bytes32 nonce;
    }

    struct LiquidityAuthorization {
        address user;
        bytes32 poolId;
        bytes32 executionPolicyHash;
        uint64 policyRevision;
        uint8 action;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
        bytes32 userSalt;
        uint128 amount0Limit;
        uint128 amount1Limit;
        uint64 deadline;
        bytes32 nonce;
    }

    struct Activation {
        address user;
        bytes32 poolId;
        bytes32 executionPolicyHash;
        uint64 policyRevision;
        uint8 source;
        uint256 acceptedRoot;
        uint64 rootEpoch;
        bytes32 evidenceHash;
        uint64 deadline;
        bytes32 nonce;
    }

    function hashOrder(Order memory o, bool direct) internal pure returns (bytes32) {
        return keccak256(abi.encode(direct ? DIRECT_TYPEHASH : ORDER_TYPEHASH, o));
    }

    function hashLiquidity(LiquidityAuthorization memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(LP_TYPEHASH, a));
    }

    function hashActivation(Activation memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(ACTIVATION_TYPEHASH, a));
    }

    function commitment(bytes32[] memory hashes, address hook, bytes32 poolId) internal view returns (bytes32) {
        for (uint256 i = 1; i < hashes.length; ++i) {
            require(hashes[i] > hashes[i - 1], "ORDER_SORT");
        }
        return keccak256(abi.encode(SET_TAG, block.chainid, hook, poolId, hashes.length, hashes));
    }

    function positionSalt(address user, bytes32 userSalt) internal pure returns (bytes32) {
        return keccak256(abi.encode(user, userSalt));
    }
}
