// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {IPolicyRegistry} from "../src/interfaces/IPolicyRegistry.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry internal registry;

    address internal admin = makeAddr("admin");
    address internal issuer = makeAddr("issuer");

    bytes32 internal constant POOL_ID = keccak256("pool-1");
    bytes32 internal constant CRED_TYPE = keccak256("coinbase.kyc");

    function setUp() public {
        vm.prank(admin);
        registry = new PolicyRegistry();
    }

    function test_setPolicy_success() public {
        vm.prank(admin);
        registry.setPolicy(POOL_ID, issuer, CRED_TYPE);

        IPolicyRegistry.Policy memory p = registry.getPolicy(POOL_ID);
        assertEq(p.cnfIssuer, issuer);
        assertEq(p.requiredCredentialType, CRED_TYPE);
        assertTrue(p.enabled);
    }

    function test_setPolicy_revert_notOwner() public {
        vm.expectRevert();
        registry.setPolicy(POOL_ID, issuer, CRED_TYPE);
    }

    function test_setPolicy_revert_zeroIssuer() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.InvalidIssuer.selector);
        registry.setPolicy(POOL_ID, address(0), CRED_TYPE);
    }

    function test_setPolicy_canUpdate() public {
        vm.prank(admin);
        registry.setPolicy(POOL_ID, issuer, CRED_TYPE);

        address newIssuer = makeAddr("newIssuer");
        vm.prank(admin);
        registry.setPolicy(POOL_ID, newIssuer, CRED_TYPE);

        assertEq(registry.getPolicy(POOL_ID).cnfIssuer, newIssuer);
    }

    function test_disablePolicy_success() public {
        vm.prank(admin);
        registry.setPolicy(POOL_ID, issuer, CRED_TYPE);

        vm.prank(admin);
        registry.disablePolicy(POOL_ID);

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

    // ─── registerIssuer / deregisterIssuer ───────────────────────────────────

    function test_registerIssuer_success() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, false);
        emit PolicyRegistry.IssuerRegistered(issuer);
        registry.registerIssuer(issuer);

        assertTrue(registry.registeredIssuers(issuer));
    }

    function test_registerIssuer_revert_notOwner() public {
        vm.expectRevert();
        registry.registerIssuer(issuer);
    }

    function test_registerIssuer_revert_zeroAddress() public {
        vm.prank(admin);
        vm.expectRevert(PolicyRegistry.InvalidIssuer.selector);
        registry.registerIssuer(address(0));
    }

    function test_deregisterIssuer_success() public {
        vm.startPrank(admin);
        registry.registerIssuer(issuer);
        vm.expectEmit(true, false, false, false);
        emit PolicyRegistry.IssuerDeregistered(issuer);
        registry.deregisterIssuer(issuer);
        vm.stopPrank();

        assertFalse(registry.registeredIssuers(issuer));
    }

    function test_deregisterIssuer_revert_notOwner() public {
        vm.prank(admin);
        registry.registerIssuer(issuer);

        vm.expectRevert();
        registry.deregisterIssuer(issuer);
    }

    // ─── Self-service setPolicy ───────────────────────────────────────────────

    function test_selfServiceSetPolicy_success() public {
        vm.prank(admin);
        registry.registerIssuer(issuer);

        vm.prank(issuer);
        vm.expectEmit(true, true, false, true);
        emit PolicyRegistry.PolicySet(POOL_ID, issuer, CRED_TYPE);
        registry.setPolicy(POOL_ID, CRED_TYPE);

        IPolicyRegistry.Policy memory p = registry.getPolicy(POOL_ID);
        assertEq(p.cnfIssuer, issuer);
        assertEq(p.requiredCredentialType, CRED_TYPE);
        assertTrue(p.enabled);
    }

    function test_selfServiceSetPolicy_revert_notRegistered() public {
        vm.prank(issuer);
        vm.expectRevert(PolicyRegistry.NotRegisteredIssuer.selector);
        registry.setPolicy(POOL_ID, CRED_TYPE);
    }

    function test_selfServiceSetPolicy_revert_afterDeregistration() public {
        vm.startPrank(admin);
        registry.registerIssuer(issuer);
        registry.deregisterIssuer(issuer);
        vm.stopPrank();

        vm.prank(issuer);
        vm.expectRevert(PolicyRegistry.NotRegisteredIssuer.selector);
        registry.setPolicy(POOL_ID, CRED_TYPE);
    }

    function test_selfServiceSetPolicy_cannotImpersonateOtherIssuer() public {
        // Even a registered issuer's self-service policy always binds msg.sender
        address otherIssuer = makeAddr("otherIssuer");
        vm.prank(admin);
        registry.registerIssuer(issuer);

        vm.prank(issuer);
        registry.setPolicy(POOL_ID, CRED_TYPE);

        // The policy cnfIssuer must be `issuer`, not `otherIssuer`
        assertEq(registry.getPolicy(POOL_ID).cnfIssuer, issuer);
        assertTrue(registry.getPolicy(POOL_ID).cnfIssuer != otherIssuer);
    }

    function test_selfServiceSetPolicy_canUpdateOwnPool() public {
        vm.prank(admin);
        registry.registerIssuer(issuer);

        bytes32 newCredType = keccak256("new.cred.type");
        vm.startPrank(issuer);
        registry.setPolicy(POOL_ID, CRED_TYPE);
        registry.setPolicy(POOL_ID, newCredType);
        vm.stopPrank();

        assertEq(registry.getPolicy(POOL_ID).requiredCredentialType, newCredType);
    }

    function test_selfServiceSetPolicy_cannotOverwriteAnotherIssuerPool() public {
        address attackerIssuer = makeAddr("attackerIssuer");
        vm.startPrank(admin);
        registry.registerIssuer(issuer);
        registry.registerIssuer(attackerIssuer);
        vm.stopPrank();

        vm.prank(issuer);
        registry.setPolicy(POOL_ID, CRED_TYPE);

        vm.prank(attackerIssuer);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.PolicyOwnedByAnotherIssuer.selector, issuer));
        registry.setPolicy(POOL_ID, keccak256("attacker.credential"));

        assertEq(registry.getPolicy(POOL_ID).cnfIssuer, issuer);
        assertEq(registry.getPolicy(POOL_ID).requiredCredentialType, CRED_TYPE);
    }

    function test_selfServiceSetPolicy_cannotClaimDisabledPolicy() public {
        address attackerIssuer = makeAddr("attackerIssuer");
        vm.startPrank(admin);
        registry.registerIssuer(issuer);
        registry.registerIssuer(attackerIssuer);
        vm.stopPrank();

        vm.prank(issuer);
        registry.setPolicy(POOL_ID, CRED_TYPE);
        vm.prank(admin);
        registry.disablePolicy(POOL_ID);

        vm.prank(attackerIssuer);
        vm.expectRevert(abi.encodeWithSelector(PolicyRegistry.PolicyOwnedByAnotherIssuer.selector, issuer));
        registry.setPolicy(POOL_ID, keccak256("attacker.credential"));

        IPolicyRegistry.Policy memory policy = registry.getPolicy(POOL_ID);
        assertEq(policy.cnfIssuer, issuer);
        assertFalse(policy.enabled);
    }

    function test_ownerCanMigratePoolToAnotherIssuer() public {
        address newIssuer = makeAddr("newIssuer");
        vm.prank(admin);
        registry.setPolicy(POOL_ID, issuer, CRED_TYPE);

        vm.prank(admin);
        registry.setPolicy(POOL_ID, newIssuer, keccak256("new.credential"));

        assertEq(registry.getPolicy(POOL_ID).cnfIssuer, newIssuer);
    }
}
