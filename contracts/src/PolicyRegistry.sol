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
///           • Registered issuers — can self-service `setPolicy` only for their own issuer address.
///             This enables permissionless pool onboarding once an issuer has been vetted.
contract PolicyRegistry is IPolicyRegistry, Ownable {
    // ─── Errors ───────────────────────────────────────────────────────────────

    error PolicyNotFound();
    error InvalidIssuer();
    error NotRegisteredIssuer();
    error PolicyOwnedByAnotherIssuer(address currentIssuer);

    // ─── Events ───────────────────────────────────────────────────────────────

    event PolicySet(bytes32 indexed poolId, address indexed cnfIssuer, bytes32 credentialType);
    event PolicyDisabled(bytes32 indexed poolId);
    event IssuerRegistered(address indexed issuer);
    event IssuerDeregistered(address indexed issuer);

    // ─── Storage ──────────────────────────────────────────────────────────────

    mapping(bytes32 => Policy) private _policies;

    /// @notice Addresses approved to call the self-service `setPolicy(bytes32,bytes32)` overload.
    ///         An issuer sets msg.sender as cnfIssuer — they cannot impersonate other issuers.
    mapping(address => bool) public registeredIssuers;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Owner-only admin ─────────────────────────────────────────────────────

    /// @notice Full-control policy setter for the owner. Can set any cnfIssuer address.
    function setPolicy(bytes32 poolId, address cnfIssuer, bytes32 credentialType) external onlyOwner {
        if (cnfIssuer == address(0)) revert InvalidIssuer();
        _policies[poolId] = Policy({cnfIssuer: cnfIssuer, requiredCredentialType: credentialType, enabled: true});
        emit PolicySet(poolId, cnfIssuer, credentialType);
    }

    function disablePolicy(bytes32 poolId) external onlyOwner {
        if (!_policies[poolId].enabled) revert PolicyNotFound();
        _policies[poolId].enabled = false;
        emit PolicyDisabled(poolId);
    }

    /// @notice Approve an issuer address for self-service pool registration.
    function registerIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) revert InvalidIssuer();
        registeredIssuers[issuer] = true;
        emit IssuerRegistered(issuer);
    }

    /// @notice Revoke a previously registered issuer's self-service rights.
    ///         Does NOT retroactively disable their existing policies.
    function deregisterIssuer(address issuer) external onlyOwner {
        registeredIssuers[issuer] = false;
        emit IssuerDeregistered(issuer);
    }

    // ─── Self-service (registered issuers) ───────────────────────────────────

    /// @notice Registered issuers can claim an unconfigured pool or update a pool they already own.
    ///         Existing ownership survives policy disablement; only the protocol owner can migrate
    ///         a pool to another issuer through the owner-only overload above.
    function setPolicy(bytes32 poolId, bytes32 credentialType) external {
        if (!registeredIssuers[msg.sender]) revert NotRegisteredIssuer();
        address currentIssuer = _policies[poolId].cnfIssuer;
        if (currentIssuer != address(0) && currentIssuer != msg.sender) {
            revert PolicyOwnedByAnotherIssuer(currentIssuer);
        }
        _policies[poolId] = Policy({cnfIssuer: msg.sender, requiredCredentialType: credentialType, enabled: true});
        emit PolicySet(poolId, msg.sender, credentialType);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getPolicy(bytes32 poolId) external view returns (Policy memory) {
        return _policies[poolId];
    }
}
