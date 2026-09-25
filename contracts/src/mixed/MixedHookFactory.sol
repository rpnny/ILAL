// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/// @notice Minimal CREATE2 deployer used to mine the permission bits encoded in a v4 Hook address.
/// @dev The owner restriction prevents another account from consuming a reviewed salt before deployment.
contract MixedHookFactory {
    address public immutable owner;

    constructor(address initialOwner) {
        require(initialOwner != address(0), "OWNER");
        owner = initialOwner;
    }

    function deploy(bytes32 salt, bytes memory creationCode) external returns (address deployed) {
        require(msg.sender == owner, "OWNER");
        assembly ("memory-safe") {
            deployed := create2(0, add(creationCode, 32), mload(creationCode), salt)
        }
        require(deployed != address(0), "CREATE2");
    }
}
