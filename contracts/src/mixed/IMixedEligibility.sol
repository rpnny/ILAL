// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

interface IMixedEligibility {
    function isEligible(bytes32 poolId, address user, bytes32 executionPolicyHash, uint64 revision)
        external
        view
        returns (bool);
}
