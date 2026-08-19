// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";

/// @title PolicyRegistry
/// @notice Stores per-pool compliance policies. Each pool references one CNFIssuer
///         and one required credential type. The ComplianceHook reads this on every action.
///
///         Two-tier permission model:
///           • Owner (protocol admin) — registers/deregisters issuers and can set any policy.
///           • Registered issuer operators — can self-service `setPolicy` only for the
///             CNFIssuer contract they own.
///             This enables permissionless pool onboarding once an issuer has been vetted.
contract PolicyRegistry is IPolicyRegistry, Ownable {
    // ─── Errors ───────────────────────────────────────────────────────────────

    error PolicyNotFound();
    error InvalidIssuer();
    error InvalidIssuerInterface();
    error InvalidIssuerOperator();
    error NotRegisteredIssuer();
    error IssuerOperatorMismatch(address operator, address issuerOwner);
    error PolicyOwnedByAnotherIssuer(address currentIssuer);
    error PolicyUpdateRequiresDelay();
    error PendingPolicyExists();
    error NoPendingPolicy();
    error PolicyUpdateTooEarly(uint256 activatesAt);

    // ─── Events ───────────────────────────────────────────────────────────────

    event PolicySet(bytes32 indexed poolId, address indexed cnfIssuer, bytes32 credentialType);
    event PolicyDisabled(bytes32 indexed poolId);
    event IssuerRegistered(address indexed operator, address indexed cnfIssuer);
    event IssuerDeregistered(address indexed operator, address indexed cnfIssuer);
    event PolicyUpdateProposed(
        bytes32 indexed poolId, address indexed cnfIssuer, bytes32 credentialType, uint256 activatesAt
    );
    event PolicyUpdateCancelled(bytes32 indexed poolId);

    // ─── Storage ──────────────────────────────────────────────────────────────

    mapping(bytes32 => Policy) private _policies;

    /// @notice CNFIssuer contract assigned to each self-service operator.
    mapping(address => address) public issuerForOperator;

    /// @notice Current self-service operator for each CNFIssuer contract.
    mapping(address => address) public operatorForIssuer;

    struct PendingPolicy {
        address cnfIssuer;
        bytes32 requiredCredentialType;
        uint64 activatesAt;
    }

    uint64 public constant POLICY_UPDATE_DELAY = 48 hours;
    mapping(bytes32 => PendingPolicy) public pendingPolicies;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Owner-only admin ─────────────────────────────────────────────────────

    /// @notice Configure a pool that has never had a policy. Existing policy changes
    ///         must use proposePolicyUpdate/activatePolicyUpdate.
    function setPolicy(bytes32 poolId, address cnfIssuer, bytes32 credentialType) external onlyOwner {
        _validateIssuerContract(cnfIssuer);
        _setInitialPolicy(poolId, cnfIssuer, credentialType);
    }

    function disablePolicy(bytes32 poolId) external onlyOwner {
        if (!_policies[poolId].enabled) revert PolicyNotFound();
        if (pendingPolicies[poolId].activatesAt != 0) {
            delete pendingPolicies[poolId];
            emit PolicyUpdateCancelled(poolId);
        }
        _policies[poolId].enabled = false;
        emit PolicyDisabled(poolId);
    }

    /// @notice Bind an operator to the CNFIssuer contract it owns.
    /// @dev The ownership check is repeated on every self-service policy update, so a
    ///      transferred issuer cannot retain privileges through a stale registration.
    function registerIssuer(address operator, address cnfIssuer) external onlyOwner {
        if (operator == address(0)) revert InvalidIssuerOperator();
        _validateIssuerContract(cnfIssuer);
        address issuerOwner = _issuerOwner(cnfIssuer);
        if (issuerOwner != operator) revert IssuerOperatorMismatch(operator, issuerOwner);

        address previousIssuer = issuerForOperator[operator];
        if (previousIssuer != address(0) && operatorForIssuer[previousIssuer] == operator) {
            delete operatorForIssuer[previousIssuer];
        }
        address previousOperator = operatorForIssuer[cnfIssuer];
        if (previousOperator != address(0) && previousOperator != operator) {
            delete issuerForOperator[previousOperator];
        }

        issuerForOperator[operator] = cnfIssuer;
        operatorForIssuer[cnfIssuer] = operator;
        emit IssuerRegistered(operator, cnfIssuer);
    }

    /// @notice Revoke a previously registered issuer's self-service rights.
    ///         Does NOT retroactively disable their existing policies.
    function deregisterIssuer(address operator) external onlyOwner {
        address cnfIssuer = issuerForOperator[operator];
        delete issuerForOperator[operator];
        if (operatorForIssuer[cnfIssuer] == operator) delete operatorForIssuer[cnfIssuer];
        emit IssuerDeregistered(operator, cnfIssuer);
    }

    /// @notice Queue an issuer migration, credential-type change, or re-enable.
    function proposePolicyUpdate(bytes32 poolId, address cnfIssuer, bytes32 credentialType) external onlyOwner {
        _validateIssuerContract(cnfIssuer);
        _proposePolicyUpdate(poolId, cnfIssuer, credentialType);
    }

    /// @notice Cancel a queued policy change before it is activated.
    function cancelPolicyUpdate(bytes32 poolId) external onlyOwner {
        if (pendingPolicies[poolId].activatesAt == 0) revert NoPendingPolicy();
        delete pendingPolicies[poolId];
        emit PolicyUpdateCancelled(poolId);
    }

    /// @notice Activate a queued policy change after the review delay. Permissionless
    ///         execution avoids making the owner key an availability dependency.
    function activatePolicyUpdate(bytes32 poolId) external {
        PendingPolicy memory pending = pendingPolicies[poolId];
        if (pending.activatesAt == 0) revert NoPendingPolicy();
        if (block.timestamp < pending.activatesAt) revert PolicyUpdateTooEarly(pending.activatesAt);
        delete pendingPolicies[poolId];
        _setPolicy(poolId, pending.cnfIssuer, pending.requiredCredentialType);
    }

    // ─── Self-service (registered issuers) ───────────────────────────────────

    /// @notice Registered issuers can claim an unconfigured pool. Existing policy
    ///         changes must use the delayed self-service proposal overload below.
    function setPolicy(bytes32 poolId, bytes32 credentialType) external {
        address cnfIssuer = _registeredIssuerFor(msg.sender);
        _setInitialPolicy(poolId, cnfIssuer, credentialType);
    }

    /// @notice Queue a delayed credential-type change or re-enable for a pool owned
    ///         by the caller's registered CNFIssuer contract.
    function proposePolicyUpdate(bytes32 poolId, bytes32 credentialType) external {
        address cnfIssuer = _registeredIssuerFor(msg.sender);
        address currentIssuer = _policies[poolId].cnfIssuer;
        if (currentIssuer != cnfIssuer) revert PolicyOwnedByAnotherIssuer(currentIssuer);
        _proposePolicyUpdate(poolId, cnfIssuer, credentialType);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPolicy(bytes32 poolId) external view returns (Policy memory) {
        return _policies[poolId];
    }

    /// @notice Backwards-compatible registration view for existing integrations.
    function registeredIssuers(address operator) external view returns (bool) {
        return issuerForOperator[operator] != address(0);
    }

    function _validateIssuerContract(address cnfIssuer) internal view {
        if (cnfIssuer == address(0) || cnfIssuer.code.length == 0) revert InvalidIssuer();

        (bool validOk, bytes memory validData) =
            cnfIssuer.staticcall(abi.encodeWithSignature("isValid(address)", address(0)));
        (bool tokenOk, bytes memory tokenData) =
            cnfIssuer.staticcall(abi.encodeWithSignature("credentialOf(address)", address(0)));
        (bool credentialOk, bytes memory credentialData) =
            cnfIssuer.staticcall(abi.encodeWithSignature("getCredential(uint256)", uint256(0)));
        if (
            !validOk || validData.length != 32 || !tokenOk || tokenData.length != 32 || !credentialOk
                || credentialData.length < 192
        ) revert InvalidIssuerInterface();
    }

    function _issuerOwner(address cnfIssuer) internal view returns (address issuerOwner) {
        (bool ok, bytes memory data) = cnfIssuer.staticcall(abi.encodeWithSignature("owner()"));
        if (!ok || data.length != 32) revert InvalidIssuerInterface();
        issuerOwner = abi.decode(data, (address));
    }

    function _registeredIssuerFor(address operator) internal view returns (address cnfIssuer) {
        cnfIssuer = issuerForOperator[operator];
        if (cnfIssuer == address(0)) revert NotRegisteredIssuer();
        address issuerOwner = _issuerOwner(cnfIssuer);
        if (issuerOwner != operator) revert IssuerOperatorMismatch(operator, issuerOwner);
    }

    function _setInitialPolicy(bytes32 poolId, address cnfIssuer, bytes32 credentialType) internal {
        address currentIssuer = _policies[poolId].cnfIssuer;
        if (currentIssuer != address(0)) {
            if (currentIssuer != cnfIssuer) revert PolicyOwnedByAnotherIssuer(currentIssuer);
            revert PolicyUpdateRequiresDelay();
        }
        if (pendingPolicies[poolId].activatesAt != 0) revert PendingPolicyExists();
        _setPolicy(poolId, cnfIssuer, credentialType);
    }

    function _proposePolicyUpdate(bytes32 poolId, address cnfIssuer, bytes32 credentialType) internal {
        if (_policies[poolId].cnfIssuer == address(0)) revert PolicyNotFound();
        if (pendingPolicies[poolId].activatesAt != 0) revert PendingPolicyExists();
        uint64 activatesAt = uint64(block.timestamp + POLICY_UPDATE_DELAY);
        pendingPolicies[poolId] =
            PendingPolicy({cnfIssuer: cnfIssuer, requiredCredentialType: credentialType, activatesAt: activatesAt});
        emit PolicyUpdateProposed(poolId, cnfIssuer, credentialType, activatesAt);
    }

    function _setPolicy(bytes32 poolId, address cnfIssuer, bytes32 credentialType) internal {
        _policies[poolId] = Policy({cnfIssuer: cnfIssuer, requiredCredentialType: credentialType, enabled: true});
        emit PolicySet(poolId, cnfIssuer, credentialType);
    }
}
