// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry internal registry;
    MockCNFIssuer internal issuerContract;

    address internal admin = makeAddr("admin");
    address internal issuerOperator = makeAddr("issuerOperator");

    bytes32 internal constant POOL_ID = keccak256("pool-1");
    bytes32 internal constant CRED_TYPE = keccak256("coinbase.kyc");

    function setUp() public {
        vm.prank(admin);
        registry = new PolicyRegistry();
        vm.prank(issuerOperator);
        issuerContract = new MockCNFIssuer();
    }

    function _registerIssuer(address operator, MockCNFIssuer cnfIssuer) internal {
        vm.prank(admin);
        registry.registerIssuer(operator, address(cnfIssuer));
    }

    function _newIssuer(address operator) internal returns (MockCNFIssuer cnfIssuer) {
        vm.prank(operator);
        cnfIssuer = new MockCNFIssuer();
    }

    function test_setPolicy_success() public {
        vm.prank(admin);
        registry.setPolicy(POOL_ID, address(issuerContract), CRED_TYPE);

        IPolicyRegistry.Policy memory p = registry.getPolicy(POOL_ID);
        assertEq(p.cnfIssuer, address(issuerContract));
        assertEq(p.requiredCredentialType, CRED_TYPE);
        assertTrue(p.enabled);
    }

    function test_setPolicy_revert_notOwner() public {
        vm.expectRevert();
        registry.setPolicy(POOL_ID, address(issuerContract), CRED_TYPE);
    }

    function test_setPolicy_revert_zeroIssuer() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.InvalidIssuer.selector);
        registry.setPolicy(POOL_ID, address(0), CRED_TYPE);
    }

    function test_setPolicy_revert_eoaIssuer() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.InvalidIssuer.selector);
        registry.setPolicy(POOL_ID, issuerOperator, CRED_TYPE);
    }

    function test_setPolicy_revert_incompatibleContract() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.InvalidIssuerInterface.selector);
        registry.setPolicy(POOL_ID, address(registry), CRED_TYPE);
    }

    function test_ownerPolicyUpdate_requiresDelay() public {
        address newOperator = makeAddr("newOperator");
        MockCNFIssuer newIssuer = _newIssuer(newOperator);
        vm.prank(admin);
        registry.setPolicy(POOL_ID, address(issuerContract), CRED_TYPE);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyRegistry.PolicyOwnedByAnotherIssuer.selector, address(issuerContract))
        );
        registry.setPolicy(POOL_ID, address(newIssuer), CRED_TYPE);

        vm.startPrank(admin);
        registry.proposePolicyUpdate(POOL_ID, address(newIssuer), CRED_TYPE);
        (,, uint64 activatesAt) = registry.pendingPolicies(POOL_ID);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.PolicyUpdateTooEarly.selector, activatesAt));
        registry.activatePolicyUpdate(POOL_ID);
        vm.warp(activatesAt);
        vm.stopPrank();

        registry.activatePolicyUpdate(POOL_ID);

        assertEq(registry.getPolicy(POOL_ID).cnfIssuer, address(newIssuer));
    }

    function test_disablePolicy_cancelsPendingUpdate() public {
        vm.startPrank(admin);
        registry.setPolicy(POOL_ID, address(issuerContract), CRED_TYPE);
        registry.proposePolicyUpdate(POOL_ID, address(issuerContract), keccak256("new.type"));
        registry.disablePolicy(POOL_ID);
        vm.stopPrank();

        (,, uint64 activatesAt) = registry.pendingPolicies(POOL_ID);
        assertEq(activatesAt, 0);
        vm.expectRevert(PolicyRegistry.NoPendingPolicy.selector);
        registry.activatePolicyUpdate(POOL_ID);
    }

    function test_disablePolicy_success() public {
        vm.startPrank(admin);
        registry.setPolicy(POOL_ID, address(issuerContract), CRED_TYPE);
        registry.disablePolicy(POOL_ID);
        vm.stopPrank();

        assertFalse(registry.getPolicy(POOL_ID).enabled);
    }

    function test_disablePolicy_revert_notFound() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.PolicyNotFound.selector);
        registry.disablePolicy(POOL_ID);
    }

    function test_getPolicy_unset_returnsEmpty() public view {
        IPolicyRegistry.Policy memory p = registry.getPolicy(keccak256("unknown"));
        assertEq(p.cnfIssuer, address(0));
        assertFalse(p.enabled);
    }

    // ─── Operator registration ───────────────────────────────────────────────

    function test_registerIssuer_bindsOperatorToContract() public {
        vm.prank(admin);
        vm.expectEmit(true, true, false, false);
        emit PolicyRegistry.IssuerRegistered(issuerOperator, address(issuerContract));
        registry.registerIssuer(issuerOperator, address(issuerContract));

        assertEq(registry.issuerForOperator(issuerOperator), address(issuerContract));
        assertEq(registry.operatorForIssuer(address(issuerContract)), issuerOperator);
        assertTrue(registry.registeredIssuers(issuerOperator));
    }

    function test_registerIssuer_revert_notOwner() public {
        vm.expectRevert();
        registry.registerIssuer(issuerOperator, address(issuerContract));
    }

    function test_registerIssuer_revert_zeroOperator() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.InvalidIssuerOperator.selector);
        registry.registerIssuer(address(0), address(issuerContract));
    }

    function test_registerIssuer_revert_operatorDoesNotOwnContract() public {
        address imposter = makeAddr("imposter");
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyRegistry.IssuerOperatorMismatch.selector, imposter, issuerOperator)
        );
        registry.registerIssuer(imposter, address(issuerContract));
    }

    function test_deregisterIssuer_success() public {
        vm.startPrank(admin);
        registry.registerIssuer(issuerOperator, address(issuerContract));
        vm.expectEmit(true, true, false, false);
        emit PolicyRegistry.IssuerDeregistered(issuerOperator, address(issuerContract));
        registry.deregisterIssuer(issuerOperator);
        vm.stopPrank();

        assertEq(registry.issuerForOperator(issuerOperator), address(0));
        assertEq(registry.operatorForIssuer(address(issuerContract)), address(0));
        assertFalse(registry.registeredIssuers(issuerOperator));
    }

    function test_deregisterIssuer_revert_notOwner() public {
        _registerIssuer(issuerOperator, issuerContract);
        vm.expectRevert();
        registry.deregisterIssuer(issuerOperator);
    }

    // ─── Self-service policy updates ─────────────────────────────────────────

    function test_selfServiceSetPolicy_usesIssuerContract() public {
        _registerIssuer(issuerOperator, issuerContract);

        vm.prank(issuerOperator);
        vm.expectEmit(true, true, false, true);
        emit PolicyRegistry.PolicySet(POOL_ID, address(issuerContract), CRED_TYPE);
        registry.setPolicy(POOL_ID, CRED_TYPE);

        IPolicyRegistry.Policy memory p = registry.getPolicy(POOL_ID);
        assertEq(p.cnfIssuer, address(issuerContract));
        assertEq(p.requiredCredentialType, CRED_TYPE);
        assertTrue(p.enabled);
    }

    function test_selfServiceSetPolicy_revert_notRegistered() public {
        vm.prank(issuerOperator);
        vm.expectRevert(PolicyRegistry.NotRegisteredIssuer.selector);
        registry.setPolicy(POOL_ID, CRED_TYPE);
    }

    function test_selfServiceSetPolicy_revert_afterDeregistration() public {
        vm.startPrank(admin);
        registry.registerIssuer(issuerOperator, address(issuerContract));
        registry.deregisterIssuer(issuerOperator);
        vm.stopPrank();

        vm.prank(issuerOperator);
        vm.expectRevert(PolicyRegistry.NotRegisteredIssuer.selector);
        registry.setPolicy(POOL_ID, CRED_TYPE);
    }

    function test_selfServiceSetPolicy_revert_afterIssuerOwnershipTransfer() public {
        _registerIssuer(issuerOperator, issuerContract);
        address newOwner = makeAddr("newOwner");
        vm.prank(issuerOperator);
        issuerContract.transferOwnership(newOwner);

        vm.prank(issuerOperator);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyRegistry.IssuerOperatorMismatch.selector, issuerOperator, newOwner)
        );
        registry.setPolicy(POOL_ID, CRED_TYPE);
    }

    function test_selfServicePolicyUpdate_requiresDelay() public {
        _registerIssuer(issuerOperator, issuerContract);
        bytes32 newCredType = keccak256("new.cred.type");

        vm.prank(issuerOperator);
        registry.setPolicy(POOL_ID, CRED_TYPE);

        vm.prank(issuerOperator);
        vm.expectRevert(PolicyRegistry.PolicyUpdateRequiresDelay.selector);
        registry.setPolicy(POOL_ID, newCredType);

        vm.prank(issuerOperator);
        registry.proposePolicyUpdate(POOL_ID, newCredType);
        (,, uint64 activatesAt) = registry.pendingPolicies(POOL_ID);
        vm.warp(activatesAt);
        registry.activatePolicyUpdate(POOL_ID);

        assertEq(registry.getPolicy(POOL_ID).requiredCredentialType, newCredType);
    }

    function test_cancelPolicyUpdate_revert_notOwner() public {
        _registerIssuer(issuerOperator, issuerContract);
        vm.prank(issuerOperator);
        registry.setPolicy(POOL_ID, CRED_TYPE);
        vm.prank(issuerOperator);
        registry.proposePolicyUpdate(POOL_ID, keccak256("new.type"));

        vm.prank(issuerOperator);
        vm.expectRevert();
        registry.cancelPolicyUpdate(POOL_ID);
    }

    function test_selfServiceSetPolicy_cannotOverwriteAnotherIssuerPool() public {
        address attackerOperator = makeAddr("attackerOperator");
        MockCNFIssuer attackerIssuer = _newIssuer(attackerOperator);
        _registerIssuer(issuerOperator, issuerContract);
        _registerIssuer(attackerOperator, attackerIssuer);

        vm.prank(issuerOperator);
        registry.setPolicy(POOL_ID, CRED_TYPE);

        vm.prank(attackerOperator);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyRegistry.PolicyOwnedByAnotherIssuer.selector, address(issuerContract))
        );
        registry.setPolicy(POOL_ID, keccak256("attacker.credential"));
    }

    function test_selfServiceSetPolicy_cannotClaimDisabledPolicy() public {
        address attackerOperator = makeAddr("attackerOperator");
        MockCNFIssuer attackerIssuer = _newIssuer(attackerOperator);
        _registerIssuer(issuerOperator, issuerContract);
        _registerIssuer(attackerOperator, attackerIssuer);

        vm.prank(issuerOperator);
        registry.setPolicy(POOL_ID, CRED_TYPE);
        vm.prank(admin);
        registry.disablePolicy(POOL_ID);

        vm.prank(attackerOperator);
        vm.expectRevert(
            abi.encodeWithSelector(PolicyRegistry.PolicyOwnedByAnotherIssuer.selector, address(issuerContract))
        );
        registry.setPolicy(POOL_ID, keccak256("attacker.credential"));

        assertFalse(registry.getPolicy(POOL_ID).enabled);
    }
}
