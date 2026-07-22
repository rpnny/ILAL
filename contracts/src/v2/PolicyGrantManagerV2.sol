// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IGroth16Verifier} from "../interfaces/IGroth16Verifier.sol";
import {IEligibilityPolicyRegistryV2} from "./IEligibilityPolicyRegistryV2.sol";
import {IPolicyGrantManagerV2} from "./IPolicyGrantManagerV2.sol";

/// @notice Verifies a pool-specific v2 eligibility proof once and caches a
///         short-lived grant for cheap Hook reads on subsequent actions.
/// @dev This is an isolated v2 prototype and is not wired into the v1 Hook.
contract PolicyGrantManagerV2 is IPolicyGrantManagerV2, Ownable {
    uint256 private constant PI_WALLET_HASH = 0;
    uint256 private constant PI_ISSUER_HASH = 1;
    uint256 private constant PI_SCHEMA_HASH = 2;
    uint256 private constant PI_EXPIRES_AT = 3;
    uint256 private constant PI_CREDENTIAL_ROOT = 4;
    uint256 private constant PI_MIN_KYC_LEVEL = 5;
    uint256 private constant PI_JURISDICTION_ROOT = 6;
    uint256 private constant PI_POLICY_HASH = 7;
    uint256 private constant PI_CIRCUIT_VERSION = 8;
    uint256 private constant PUBLIC_INPUT_COUNT = 9;
    uint256 public constant CIRCUIT_VERSION = 2;

    struct Grant {
        uint256 policyHash;
        uint64 expiresAt;
        uint64 policyRevision;
    }

    error InvalidAddress();
    error PolicyNotEnabled();
    error InvalidPublicInputs();
    error PolicyInputMismatch();
    error ProofExpired();
    error ProofVerificationFailed();
    error GrantRevokedForPolicyRevision();

    event PolicyGrantActivated(
        bytes32 indexed poolId,
        address indexed user,
        uint256 indexed policyHash,
        uint64 expiresAt,
        uint64 policyRevision
    );
    event PolicyGrantRevoked(bytes32 indexed poolId, address indexed user);

    IGroth16Verifier public immutable verifier;
    IEligibilityPolicyRegistryV2 public immutable policyRegistry;
    mapping(bytes32 => mapping(address => Grant)) public grants;
    mapping(bytes32 => mapping(address => uint64)) public revokedPolicyRevision;

    constructor(address admin, IGroth16Verifier _verifier, IEligibilityPolicyRegistryV2 _policyRegistry)
        Ownable(admin)
    {
        if (address(_verifier) == address(0) || address(_policyRegistry) == address(0)) {
            revert InvalidAddress();
        }
        verifier = _verifier;
        policyRegistry = _policyRegistry;
    }

    function activatePolicyGrant(bytes32 poolId, bytes calldata proof, uint256[] calldata publicInputs)
        external
        returns (uint64 grantExpiresAt)
    {
        if (publicInputs.length != PUBLIC_INPUT_COUNT) revert InvalidPublicInputs();

        IEligibilityPolicyRegistryV2.EligibilityPolicy memory policy = policyRegistry.getEligibilityPolicy(poolId);
        if (!policy.enabled || policy.revision == 0) revert PolicyNotEnabled();
        if (revokedPolicyRevision[poolId][msg.sender] == policy.revision) revert GrantRevokedForPolicyRevision();

        uint256 expectedWalletHash = uint256(keccak256(abi.encodePacked(msg.sender))) >> 4;
        if (publicInputs[PI_WALLET_HASH] != expectedWalletHash) revert InvalidPublicInputs();
        if (
            publicInputs[PI_ISSUER_HASH] != policy.issuerHash || publicInputs[PI_SCHEMA_HASH] != policy.schemaHash
                || publicInputs[PI_CREDENTIAL_ROOT] != policy.credentialRoot
                || publicInputs[PI_MIN_KYC_LEVEL] != policy.minKycLevel
                || publicInputs[PI_JURISDICTION_ROOT] != policy.jurisdictionRoot
                || publicInputs[PI_POLICY_HASH] != policy.policyHash
                || publicInputs[PI_CIRCUIT_VERSION] != CIRCUIT_VERSION
        ) revert PolicyInputMismatch();

        uint256 sourceExpiresAt = publicInputs[PI_EXPIRES_AT];
        if (sourceExpiresAt <= block.timestamp || sourceExpiresAt > type(uint64).max) revert ProofExpired();

        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        if (!verifier.verifyProof(a, b, c, publicInputs)) revert ProofVerificationFailed();

        uint256 ttlExpiresAt = block.timestamp + policy.maxGrantTTL;
        grantExpiresAt = uint64(sourceExpiresAt < ttlExpiresAt ? sourceExpiresAt : ttlExpiresAt);
        grants[poolId][msg.sender] =
            Grant({policyHash: policy.policyHash, expiresAt: grantExpiresAt, policyRevision: policy.revision});
        emit PolicyGrantActivated(poolId, msg.sender, policy.policyHash, grantExpiresAt, policy.revision);
    }

    function revokePolicyGrant(bytes32 poolId, address user) external onlyOwner {
        IEligibilityPolicyRegistryV2.EligibilityPolicy memory policy = policyRegistry.getEligibilityPolicy(poolId);
        if (policy.revision == 0) revert PolicyNotEnabled();
        revokedPolicyRevision[poolId][user] = policy.revision;
        delete grants[poolId][user];
        emit PolicyGrantRevoked(poolId, user);
    }

    function isPolicyGrantValid(bytes32 poolId, address user) external view override returns (bool) {
        Grant memory grant = grants[poolId][user];
        if (grant.expiresAt <= block.timestamp) return false;

        IEligibilityPolicyRegistryV2.EligibilityPolicy memory policy = policyRegistry.getEligibilityPolicy(poolId);
        return policy.enabled && grant.policyRevision == policy.revision && grant.policyHash == policy.policyHash;
    }
}
