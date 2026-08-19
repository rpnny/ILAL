// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Shared signed-order and batch summary types for institutional netting.
library NettingTypes {
    error OrdersNotStrictlySorted(uint256 index, bytes32 previousHash, bytes32 currentHash);

    bytes32 internal constant ORDER_TYPEHASH = keccak256(
        "NettingOrder(address user,bytes32 poolId,bool zeroForOne,uint128 amountIn,uint128 minAmountOut,uint128 maxAmmInput,uint64 deadline,bytes32 nonce)"
    );

    struct NettingOrder {
        address user;
        bytes32 poolId;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint128 maxAmmInput;
        uint64 deadline;
        bytes32 nonce;
    }

    struct BatchHeader {
        bytes32 batchId;
        uint8 orderCount;
        uint256 total0;
        uint256 total1;
        uint256 matchedEachSide;
        uint256 residual0;
        uint256 residual1;
        uint256 exposureReduction;
    }

    function hash(NettingOrder memory order) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                ORDER_TYPEHASH,
                order.user,
                order.poolId,
                order.zeroForOne,
                order.amountIn,
                order.minAmountOut,
                order.maxAmmInput,
                order.deadline,
                order.nonce
            )
        );
    }

    function preview(NettingOrder[] memory orders) internal pure returns (BatchHeader memory header) {
        uint256 length = orders.length;
        bytes32 commitment;
        bytes32 previousHash;
        for (uint256 i; i < length; ++i) {
            NettingOrder memory order = orders[i];
            bytes32 orderHash = hash(order);
            if (i != 0 && orderHash <= previousHash) {
                revert OrdersNotStrictlySorted(i, previousHash, orderHash);
            }
            if (order.zeroForOne) header.total0 += order.amountIn;
            else header.total1 += order.amountIn;
            commitment = keccak256(abi.encodePacked(commitment, orderHash));
            previousHash = orderHash;
        }

        header.batchId = commitment;
        header.orderCount = uint8(length);
        header.matchedEachSide = header.total0 < header.total1 ? header.total0 : header.total1;
        header.residual0 = header.total0 - header.matchedEachSide;
        header.residual1 = header.total1 - header.matchedEachSide;
        header.exposureReduction = header.matchedEachSide * 2;
    }
}
