// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IPolicyRegistry {
    struct Policy {
        address cnfIssuer;
        bytes32 requiredCredentialType;
        bool enabled;
    }

    function setPolicy(bytes32 poolId, address cnfIssuer, bytes32 credentialType) external;
    function disablePolicy(bytes32 poolId) external;
    function getPolicy(bytes32 poolId) external view returns (Policy memory);
}
