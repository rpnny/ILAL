// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";
import {EligibilityPolicyRegistryV2} from "../src/v2/EligibilityPolicyRegistryV2.sol";
import {IEligibilityPolicyRegistryV2} from "../src/v2/IEligibilityPolicyRegistryV2.sol";
import {PolicyGrantManagerV2} from "../src/v2/PolicyGrantManagerV2.sol";

contract PolicyGrantManagerV2Test is Test {
    bytes32 internal constant POOL_ID = keccak256("v2-pool");
    uint256 internal constant ISSUER_HASH = 11;
    uint256 internal constant SCHEMA_HASH = 22;
    uint256 internal constant CREDENTIAL_ROOT = 33;
    uint256 internal constant JURISDICTION_ROOT = 44;
    uint256 internal constant POLICY_HASH = 55;

    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    EligibilityPolicyRegistryV2 internal registry;
    PolicyGrantManagerV2 internal manager;
    MockGroth16Verifier internal verifier;

    function setUp() public {
        registry = new EligibilityPolicyRegistryV2(admin);
        verifier = new MockGroth16Verifier();
        manager = new PolicyGrantManagerV2(admin, verifier, registry);
        _setPolicy(POLICY_HASH, 1 days);
    }

    function _setPolicy(uint256 policyHash, uint64 ttl) internal {
        vm.prank(admin);
        registry.setEligibilityPolicy(
            POOL_ID, ISSUER_HASH, SCHEMA_HASH, CREDENTIAL_ROOT, 2, JURISDICTION_ROOT, policyHash, ttl
        );
    }

    function _proof() internal pure returns (bytes memory) {
        return abi.encode(
            [uint256(1), uint256(2)], [[uint256(3), uint256(4)], [uint256(5), uint256(6)]], [uint256(7), uint256(8)]
        );
    }

    function _inputs(address user, uint256 expiresAt) internal pure returns (uint256[] memory inputs) {
        inputs = new uint256[](9);
        inputs[0] = uint256(keccak256(abi.encodePacked(user))) >> 4;
        inputs[1] = ISSUER_HASH;
        inputs[2] = SCHEMA_HASH;
        inputs[3] = expiresAt;
        inputs[4] = CREDENTIAL_ROOT;
        inputs[5] = 2;
        inputs[6] = JURISDICTION_ROOT;
        inputs[7] = POLICY_HASH;
        inputs[8] = 2;
    }

    function test_activatePolicyGrant_successAndCapsTTL() public {
        uint256 sourceExpiry = block.timestamp + 30 days;
        vm.prank(alice);
        uint64 expiresAt = manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, sourceExpiry));

        assertEq(expiresAt, block.timestamp + 1 days);
        assertTrue(manager.isPolicyGrantValid(POOL_ID, alice));
    }

    function test_activatePolicyGrant_capsToSourceExpiry() public {
        uint256 sourceExpiry = block.timestamp + 2 hours;
        vm.prank(alice);
        uint64 expiresAt = manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, sourceExpiry));
        assertEq(expiresAt, sourceExpiry);
    }

    function test_activatePolicyGrant_revert_walletMismatch() public {
        vm.prank(alice);
        vm.expectRevert(PolicyGrantManagerV2.InvalidPublicInputs.selector);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(makeAddr("other"), block.timestamp + 1 days));
    }

    function test_activatePolicyGrant_revert_wrongPolicyField() public {
        uint256[] memory inputs = _inputs(alice, block.timestamp + 1 days);
        inputs[6] += 1;
        vm.prank(alice);
        vm.expectRevert(PolicyGrantManagerV2.PolicyInputMismatch.selector);
        manager.activatePolicyGrant(POOL_ID, _proof(), inputs);
    }

    function test_activatePolicyGrant_revert_wrongVersion() public {
        uint256[] memory inputs = _inputs(alice, block.timestamp + 1 days);
        inputs[8] = 1;
        vm.prank(alice);
        vm.expectRevert(PolicyGrantManagerV2.PolicyInputMismatch.selector);
        manager.activatePolicyGrant(POOL_ID, _proof(), inputs);
    }

    function test_activatePolicyGrant_revert_expiredProof() public {
        vm.prank(alice);
        vm.expectRevert(PolicyGrantManagerV2.ProofExpired.selector);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp));
    }

    function test_activatePolicyGrant_revert_invalidProof() public {
        verifier.setResult(false);
        vm.prank(alice);
        vm.expectRevert(PolicyGrantManagerV2.ProofVerificationFailed.selector);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));
    }

    function test_policyRevisionInvalidatesExistingGrant() public {
        vm.prank(alice);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));
        assertTrue(manager.isPolicyGrantValid(POOL_ID, alice));

        _setPolicy(POLICY_HASH + 1, 1 days);
        assertFalse(manager.isPolicyGrantValid(POOL_ID, alice));
    }

    function test_disablePolicyInvalidatesExistingGrant() public {
        vm.prank(alice);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));

        vm.prank(admin);
        registry.disableEligibilityPolicy(POOL_ID);
        assertFalse(manager.isPolicyGrantValid(POOL_ID, alice));
    }

    function test_adminCanRevokeSingleGrant() public {
        vm.prank(alice);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));

        vm.prank(admin);
        manager.revokePolicyGrant(POOL_ID, alice);
        assertFalse(manager.isPolicyGrantValid(POOL_ID, alice));
    }

    function test_revokedUserCannotReactivateUnderSamePolicyRevision() public {
        vm.prank(alice);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));

        vm.prank(admin);
        manager.revokePolicyGrant(POOL_ID, alice);

        vm.prank(alice);
        vm.expectRevert(PolicyGrantManagerV2.GrantRevokedForPolicyRevision.selector);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));
    }

    function test_revokedUserCanReproveAfterPolicyRevisionChanges() public {
        vm.prank(alice);
        manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 1 days));
        vm.prank(admin);
        manager.revokePolicyGrant(POOL_ID, alice);

        _setPolicy(POLICY_HASH + 1, 1 days);
        uint256[] memory revisedInputs = _inputs(alice, block.timestamp + 1 days);
        revisedInputs[7] = POLICY_HASH + 1;
        vm.prank(alice);
        manager.activatePolicyGrant(POOL_ID, _proof(), revisedInputs);
        assertTrue(manager.isPolicyGrantValid(POOL_ID, alice));
    }

    function test_grantExpires() public {
        vm.prank(alice);
        uint64 expiry = manager.activatePolicyGrant(POOL_ID, _proof(), _inputs(alice, block.timestamp + 2 hours));
        vm.warp(expiry);
        assertFalse(manager.isPolicyGrantValid(POOL_ID, alice));
    }

    function test_registryRejectsInvalidPolicyParameters() public {
        vm.startPrank(admin);
        vm.expectRevert(EligibilityPolicyRegistryV2.InvalidKycLevel.selector);
        registry.setEligibilityPolicy(keccak256("bad-tier"), 1, 2, 3, 4, 5, 6, 1 days);

        vm.expectRevert(EligibilityPolicyRegistryV2.InvalidGrantTTL.selector);
        registry.setEligibilityPolicy(keccak256("bad-ttl"), 1, 2, 3, 2, 5, 6, 8 days);

        vm.expectRevert(EligibilityPolicyRegistryV2.InvalidFieldElement.selector);
        registry.setEligibilityPolicy(keccak256("zero-root"), 1, 2, 0, 2, 5, 6, 1 days);
        vm.stopPrank();
    }

    function test_registryRevisionIsMonotonic() public {
        IEligibilityPolicyRegistryV2.EligibilityPolicy memory first = registry.getEligibilityPolicy(POOL_ID);
        _setPolicy(POLICY_HASH + 1, 1 days);
        IEligibilityPolicyRegistryV2.EligibilityPolicy memory second = registry.getEligibilityPolicy(POOL_ID);
        assertEq(second.revision, first.revision + 1);
    }
}
