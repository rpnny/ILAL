// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IEligibilityPolicyRegistryV2 {
    struct EligibilityPolicy {
        uint256 issuerHash;
        uint256 schemaHash;
        uint256 credentialRoot;
        uint256 jurisdictionRoot;
        uint256 policyHash;
        uint64 maxGrantTTL;
        uint64 revision;
        uint8 minKycLevel;
        bool enabled;
    }

    function getEligibilityPolicy(bytes32 poolId) external view returns (EligibilityPolicy memory);
}
