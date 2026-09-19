// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MixedPolicyRegistry} from "../src/mixed/MixedPolicyRegistry.sol";
import {MixedGrantManager} from "../src/mixed/MixedGrantManager.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";

contract MixedGrantTest is Test {
    MixedPolicyRegistry internal registry;
    MixedGrantManager internal grants;
    MockCNFIssuer internal cnf;
    MockGroth16Verifier internal verifier;
    address internal user;
    uint256 constant USER_KEY = 0xA11CE;
    bytes32 constant POOL = keccak256("pool");

    function setUp() public {
        vm.warp(1000);
        user = vm.addr(USER_KEY);
        registry = new MixedPolicyRegistry(address(this));
        cnf = new MockCNFIssuer();
        verifier = new MockGroth16Verifier();
        grants = new MixedGrantManager(registry, verifier);
        cnf.setValid(user, true);
    }

    function _config(MixedPolicyRegistry.Mode mode) internal view returns (MixedPolicyRegistry.Config memory) {
        return MixedPolicyRegistry.Config(mode, address(cnf), cnf.defaultCredentialType(), 11, 22, 33, 44, 55, 2, 3600);
    }

    function _proof() internal view returns (bytes memory proof, uint256[] memory inputs) {
        inputs = new uint256[](9);
        inputs[0] = uint256(keccak256(abi.encodePacked(user))) >> 4;
        inputs[1] = 11;
        inputs[2] = 22;
        inputs[3] = block.timestamp + 5000;
        inputs[4] = 33;
        inputs[5] = 2;
        inputs[6] = 44;
        inputs[7] = 55;
        inputs[8] = 2;
        proof = abi.encode([uint256(0), 0], [[uint256(0), 0], [uint256(0), 0]], [uint256(0), 0]);
    }

    function _activation(uint8 source, uint256 nonce)
        internal
        view
        returns (MixedTypes.Activation memory a, bytes memory sig, bytes memory proof, uint256[] memory inputs)
    {
        if (source & 2 != 0) {
            (proof, inputs) = _proof();
        } else {
            proof = "";
            inputs = new uint256[](0);
        }
        MixedPolicyRegistry.Policy memory p = registry.getPolicy(POOL);
        a = MixedTypes.Activation(
            user,
            POOL,
            p.executionPolicyHash,
            p.revision,
            source,
            p.config.acceptedRoot,
            p.rootEpoch,
            keccak256(abi.encode(proof, inputs)),
            uint64(block.timestamp + 100),
            bytes32(nonce)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_KEY, grants.activationDigest(a));
        sig = abi.encodePacked(r, s, v);
    }

    function _activate(uint8 source, uint256 nonce) internal {
        (MixedTypes.Activation memory a, bytes memory s, bytes memory p, uint256[] memory i) =
            _activation(source, nonce);
        grants.activate(a, s, p, i);
    }

    function _eligible() internal view returns (bool) {
        MixedPolicyRegistry.Policy memory p = registry.getPolicy(POOL);
        return grants.isEligible(POOL, user, p.executionPolicyHash, p.revision);
    }

    function test_allFourModesAndWrongSource() public {
        for (uint8 mode = 1; mode <= 4; mode++) {
            uint256 snap = vm.snapshotState();
            registry.configure(POOL, _config(MixedPolicyRegistry.Mode(mode)));
            uint8 source = mode == 1 ? 1 : mode == 4 ? 3 : 2;
            _activate(source, mode);
            assertTrue(_eligible());
            uint8 wrong = mode == 1 ? 2 : mode == 4 ? 1 : 3;
            (MixedTypes.Activation memory a, bytes memory s, bytes memory p, uint256[] memory i) =
                _activation(wrong, 100);
            vm.expectRevert("SOURCE");
            grants.activate(a, s, p, i);
            assertFalse(grants.nonceUsed(user, 2, a.nonce));
            vm.revertToState(snap);
        }
    }

    function test_cnfRecheckedAndNoSourceFallback() public {
        registry.configure(POOL, _config(MixedPolicyRegistry.Mode.EITHER));
        _activate(1, 1);
        assertTrue(_eligible());
        cnf.revoke(user);
        assertFalse(_eligible());
        registry.ban(POOL, user);
        (MixedTypes.Activation memory a, bytes memory s, bytes memory p, uint256[] memory i) = _activation(2, 2);
        vm.expectRevert("ROOT_OR_BAN");
        grants.activate(a, s, p, i);
    }

    function test_rootRetiredInvalidatesCachedGrantAndOldProof() public {
        registry.configure(POOL, _config(MixedPolicyRegistry.Mode.ZK_ONLY));
        _activate(2, 1);
        registry.invalidateRoot(POOL);
        assertFalse(_eligible());
        (MixedTypes.Activation memory a, bytes memory s, bytes memory p, uint256[] memory i) = _activation(2, 2);
        vm.expectRevert("ROOT_DISABLED");
        grants.activate(a, s, p, i);
        MixedPolicyRegistry.Config memory c = _config(MixedPolicyRegistry.Mode.ZK_ONLY);
        vm.expectRevert("RETIRED_ROOT");
        registry.configure(POOL, c);
    }

    function test_timelockPolicyAndUnban() public {
        registry.configure(POOL, _config(MixedPolicyRegistry.Mode.BOTH));
        _activate(3, 1);
        MixedPolicyRegistry.Config memory c = _config(MixedPolicyRegistry.Mode.BOTH);
        c.acceptedRoot = 66;
        c.zkPolicyHash = 77;
        registry.configure(POOL, c);
        vm.expectRevert("TIMELOCK");
        registry.activate(POOL);
        vm.warp(block.timestamp + 48 hours);
        registry.activate(POOL);
        assertFalse(_eligible());
        registry.ban(POOL, user);
        registry.proposeUnban(POOL, user);
        vm.expectRevert("TIMELOCK");
        registry.activateUnban(POOL, user);
        vm.warp(block.timestamp + 48 hours);
        registry.activateUnban(POOL, user);
        assertFalse(registry.banned(POOL, user));
        assertFalse(_eligible());
    }

    function test_evidenceTamperingAndVerifierFailureRollback() public {
        registry.configure(POOL, _config(MixedPolicyRegistry.Mode.ZK_ONLY));
        (MixedTypes.Activation memory a, bytes memory s, bytes memory p, uint256[] memory i) = _activation(2, 1);
        i[4] = 999;
        vm.expectRevert("EVIDENCE");
        grants.activate(a, s, p, i);
        assertFalse(grants.nonceUsed(user, 2, a.nonce));
        (a, s, p, i) = _activation(2, 1);
        verifier.setResult(false);
        vm.expectRevert("PROOF_INVALID");
        grants.activate(a, s, p, i);
        assertFalse(grants.nonceUsed(user, 2, a.nonce));
    }

    function test_expiryAndWrongType() public {
        registry.configure(POOL, _config(MixedPolicyRegistry.Mode.CNF_ONLY));
        cnf.setCredentialState(user, uint64(block.timestamp + 20), false);
        _activate(1, 1);
        vm.warp(block.timestamp + 20);
        assertFalse(_eligible());
        cnf.setCredentialState(user, uint64(block.timestamp + 1000), false);
        cnf.setCredentialType(user, bytes32(uint256(999)));
        (MixedTypes.Activation memory a, bytes memory s, bytes memory p, uint256[] memory i) = _activation(1, 2);
        vm.expectRevert("CNF_TYPE");
        grants.activate(a, s, p, i);
    }
}
