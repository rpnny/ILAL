// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {MixedExecutionFixture} from "./MixedExecution.t.sol";
import {MixedPolicyRegistry} from "../src/mixed/MixedPolicyRegistry.sol";
import {MixedGrantManager} from "../src/mixed/MixedGrantManager.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {IMixedEligibility} from "../src/mixed/IMixedEligibility.sol";
import {ILALPolicyVerifierV2} from "../src/verifier/ILALPolicyVerifierV2.sol";
import {Groth16VerifierAdapterV2, IILALPolicyVerifierV2} from "../src/v2/Groth16VerifierAdapterV2.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";

contract MixedRealProofTest is MixedExecutionFixture {
    MixedPolicyRegistry private registry;
    MixedGrantManager private grants;
    MockCNFIssuer private cnf;
    bytes[2] private proofs;
    uint256[][2] private signals;

    function setUp() public override {
        if (!vm.envOr("ILAL_MIXED_REAL_PROOF", false)) {
            vm.skip(true);
            return;
        }
        registry = new MixedPolicyRegistry(address(this));
        cnf = new MockCNFIssuer();
        grants = new MixedGrantManager(
            registry, new Groth16VerifierAdapterV2(IILALPolicyVerifierV2(address(new ILALPolicyVerifierV2())))
        );
        string memory json = vm.readFile("../artifacts/mixed/proofs/fixture.json");
        for (uint256 i; i < 2; ++i) {
            string memory path = string.concat(".proofs[", vm.toString(i), "]");
            proofs[i] = vm.parseJsonBytes(json, string.concat(path, ".proof"));
            string[] memory values = vm.parseJsonStringArray(json, string.concat(path, ".inputs"));
            for (uint256 j; j < values.length; ++j) {
                signals[i].push(vm.parseUint(values[j]));
            }
        }
        _setup(0);
    }

    function _eligibilityProvider() internal override returns (IMixedEligibility) {
        return grants;
    }

    function _executionPolicyHash() internal view override returns (bytes32) {
        return registry.getPolicy(poolId).executionPolicyHash;
    }

    function _policyRevision() internal view override returns (uint64) {
        return registry.getPolicy(poolId).revision;
    }

    function _config(MixedPolicyRegistry.Mode mode) private view returns (MixedPolicyRegistry.Config memory) {
        uint256[] storage p = signals[0];
        return MixedPolicyRegistry.Config(
            mode, address(cnf), cnf.defaultCredentialType(), p[1], p[2], p[4], p[6], p[7], uint8(p[5]), 3600
        );
    }

    function _beforeInitialLiquidity() internal override {
        cnf.setValid(alice, true);
        cnf.setValid(bob, true);
        registry.configure(poolId, _config(MixedPolicyRegistry.Mode.BOTH));
        _activate(0, 3, 1);
        _activate(1, 3, 1);
    }

    function _activate(uint256 i, uint8 source, uint256 nonce) private {
        MixedPolicyRegistry.Policy memory p = registry.getPolicy(poolId);
        address user = i == 0 ? alice : bob;
        bytes memory proof = source & 2 != 0 ? proofs[i] : bytes("");
        uint256[] memory inputs = source & 2 != 0 ? signals[i] : new uint256[](0);
        MixedTypes.Activation memory a = MixedTypes.Activation(
            user,
            poolId,
            p.executionPolicyHash,
            p.revision,
            source,
            p.config.acceptedRoot,
            p.rootEpoch,
            keccak256(abi.encode(proof, inputs)),
            uint64(block.timestamp + 3600),
            bytes32(nonce)
        );
        grants.activate(a, _sign(i == 0 ? AK : BK, grants.activationDigest(a)), proof, inputs);
    }

    function test_realProofAllModesThroughSettlementAndExit() public {
        for (uint8 mode = 1; mode <= 4; mode++) {
            registry.configure(poolId, _config(MixedPolicyRegistry.Mode(mode)));
            vm.warp(block.timestamp + 48 hours);
            registry.activate(poolId);
            uint8 source = mode == 1 ? 1 : mode == 4 ? 3 : 2;
            _activate(0, source, mode + 10);
            _activate(1, source, mode + 10);
            (MixedTypes.Order[] memory orders, bytes[] memory sig) = _batch(100e6, 70e6, mode + 100);
            router.executeBatch(key, orders, sig);
            _closed();
        }
        registry.invalidateRoot(poolId);
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(100e6, 70e6, 200);
        vm.expectRevert();
        router.executeBatch(key, o, s);
        assertFalse(hook.nonceUsed(alice, 0, o[0].nonce));
        registry.disable(poolId);
        MixedTypes.LiquidityAuthorization memory a = _lp(MixedTypes.LP_EXIT, -5e13, 300);
        bytes memory sig = _sign(AK, hook.liquidityDigest(a));
        vm.prank(alice);
        lp.modify(key, a, sig);
        a = _lp(MixedTypes.LP_COLLECT, 0, 300);
        sig = _sign(AK, hook.liquidityDigest(a));
        vm.prank(alice);
        lp.modify(key, a, sig);
        _closed();
    }

    function activateTampered() external {
        _activate(0, 3, 400);
    }

    function test_realProofTamperedPublicSignalRejected() public {
        signals[0][0]++;
        vm.expectRevert("PROOF_DOMAIN");
        this.activateTampered();
    }
}
