// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IPolicyGrantManagerV2 {
    function isPolicyGrantValid(bytes32 poolId, address user) external view returns (bool);
}
