// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IGroth16Verifier} from "../../src/interfaces/IGroth16Verifier.sol";

/// @dev Configurable mock verifier — owner can flip the return value.
contract MockGroth16Verifier is IGroth16Verifier {
    bool private _result = true;

    function setResult(bool result) external {
        _result = result;
    }

    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[] calldata)
        external
        view
        override
        returns (bool)
    {
        return _result;
    }
}
