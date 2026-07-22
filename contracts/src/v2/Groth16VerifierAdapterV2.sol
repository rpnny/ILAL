// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IGroth16Verifier} from "../interfaces/IGroth16Verifier.sol";

interface IILALPolicyVerifierV2 {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[9] calldata publicSignals
    ) external view returns (bool);
}

/// @notice Fixed-nine-signal adapter for `circuits/v2/ilal_policy.circom`.
contract Groth16VerifierAdapterV2 is IGroth16Verifier {
    error InvalidVerifier();
    error InvalidPublicInputCount();

    IILALPolicyVerifierV2 public immutable verifier;

    constructor(IILALPolicyVerifierV2 _verifier) {
        if (address(_verifier) == address(0)) revert InvalidVerifier();
        verifier = _verifier;
    }

    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view returns (bool) {
        if (publicInputs.length != 9) revert InvalidPublicInputCount();
        uint256[9] memory fixedInputs;
        for (uint256 i = 0; i < 9; i++) {
            fixedInputs[i] = publicInputs[i];
        }
        return verifier.verifyProof(a, b, c, fixedInputs);
    }
}
