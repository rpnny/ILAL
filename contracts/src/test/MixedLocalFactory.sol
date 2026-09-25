// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/// @dev Local test fixture only. Production deployment must use its reviewed CREATE2 deployer.
contract MixedLocalFactory {
    address public immutable owner = msg.sender;

    function deploy(bytes32 salt, bytes memory code) external returns (address deployed) {
        require(msg.sender == owner, "OWNER");
        assembly ("memory-safe") { deployed := create2(0, add(code, 32), mload(code), salt) }
        require(deployed != address(0), "CREATE2");
    }
}
