// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEligibilityPolicyRegistryV2} from "./IEligibilityPolicyRegistryV2.sol";

/// @notice Versioned policy registry for the isolated policy-grant v2 design.
/// @dev This contract is not wired into the current v1 ComplianceHook.
contract EligibilityPolicyRegistryV2 is IEligibilityPolicyRegistryV2, Ownable {
    uint256 public constant SNARK_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint64 public constant MAX_GRANT_TTL = 7 days;

    error InvalidFieldElement();
    error InvalidKycLevel();
    error InvalidGrantTTL();
    error PolicyNotFound();

    event EligibilityPolicySet(bytes32 indexed poolId, uint256 indexed policyHash, uint64 revision);
    event EligibilityPolicyDisabled(bytes32 indexed poolId, uint64 revision);

    mapping(bytes32 => EligibilityPolicy) private _policies;

    constructor(address admin) Ownable(admin) {}

    function setEligibilityPolicy(
        bytes32 poolId,
        uint256 issuerHash,
        uint256 schemaHash,
        uint256 credentialRoot,
        uint8 minKycLevel,
        uint256 jurisdictionRoot,
        uint256 policyHash,
        uint64 maxGrantTTL
    ) external onlyOwner {
        _requireField(issuerHash);
        _requireField(schemaHash);
        _requireField(credentialRoot);
        _requireField(jurisdictionRoot);
        _requireField(policyHash);
        if (minKycLevel > 3) revert InvalidKycLevel();
        if (maxGrantTTL == 0 || maxGrantTTL > MAX_GRANT_TTL) revert InvalidGrantTTL();

        uint64 revision = _policies[poolId].revision + 1;
        _policies[poolId] = EligibilityPolicy({
            issuerHash: issuerHash,
            schemaHash: schemaHash,
            credentialRoot: credentialRoot,
            jurisdictionRoot: jurisdictionRoot,
            policyHash: policyHash,
            maxGrantTTL: maxGrantTTL,
            revision: revision,
            minKycLevel: minKycLevel,
            enabled: true
        });
        emit EligibilityPolicySet(poolId, policyHash, revision);
    }

    function disableEligibilityPolicy(bytes32 poolId) external onlyOwner {
        EligibilityPolicy storage policy = _policies[poolId];
        if (policy.revision == 0) revert PolicyNotFound();
        policy.enabled = false;
        policy.revision += 1;
        emit EligibilityPolicyDisabled(poolId, policy.revision);
    }

    function getEligibilityPolicy(bytes32 poolId) external view returns (EligibilityPolicy memory) {
        return _policies[poolId];
    }

    function _requireField(uint256 value) private pure {
        if (value == 0 || value >= SNARK_SCALAR_FIELD) revert InvalidFieldElement();
    }
}
