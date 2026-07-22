// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Groth16VerifierAdapterV2, IILALPolicyVerifierV2} from "../src/v2/Groth16VerifierAdapterV2.sol";

contract MockPolicyVerifierV2 is IILALPolicyVerifierV2 {
    bool public result = true;
    uint256 public expectedPolicyHash;

    function setResult(bool value) external {
        result = value;
    }

    function setExpectedPolicyHash(uint256 value) external {
        expectedPolicyHash = value;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[9] calldata publicSignals
    ) external view returns (bool) {
        return result && publicSignals[7] == expectedPolicyHash;
    }
}

contract Groth16VerifierAdapterV2Test is Test {
    MockPolicyVerifierV2 internal fixedVerifier;
    Groth16VerifierAdapterV2 internal adapter;

    function setUp() public {
        fixedVerifier = new MockPolicyVerifierV2();
        fixedVerifier.setExpectedPolicyHash(55);
        adapter = new Groth16VerifierAdapterV2(fixedVerifier);
    }

    function _inputs(uint256 length) internal pure returns (uint256[] memory inputs) {
        inputs = new uint256[](length);
        if (length > 7) inputs[7] = 55;
    }

    function test_forwardsExactlyNinePublicInputs() public view {
        assertTrue(
            adapter.verifyProof(
                [uint256(1), uint256(2)],
                [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
                [uint256(7), uint256(8)],
                _inputs(9)
            )
        );
    }

    function test_returnsUnderlyingVerifierResult() public {
        fixedVerifier.setResult(false);
        assertFalse(
            adapter.verifyProof(
                [uint256(1), uint256(2)],
                [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
                [uint256(7), uint256(8)],
                _inputs(9)
            )
        );
    }

    function test_rejectsWrongPublicInputCount() public {
        vm.expectRevert(Groth16VerifierAdapterV2.InvalidPublicInputCount.selector);
        adapter.verifyProof(
            [uint256(1), uint256(2)],
            [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
            [uint256(7), uint256(8)],
            _inputs(8)
        );
    }

    function test_constructorRejectsZeroVerifier() public {
        vm.expectRevert(Groth16VerifierAdapterV2.InvalidVerifier.selector);
        new Groth16VerifierAdapterV2(IILALPolicyVerifierV2(address(0)));
    }
}
