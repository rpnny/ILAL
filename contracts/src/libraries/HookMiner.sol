// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title HookMiner
/// @notice Mines a CREATE2 salt such that the deployed hook address has the required
///         bit flags set in its lowest 14 bits (matching Uniswap v4 Hooks.Permissions).
library HookMiner {
    uint160 private constant ALL_HOOK_MASK = uint160((1 << 14) - 1);

    /// @notice Find a salt that produces a hook address with the required flags.
    /// @param deployer  The address that will call CREATE2 (typically a factory or this contract)
    /// @param flags     Required bits in the hook address (e.g. 0x0A80 for beforeSwap + beforeAdd/RemoveLiquidity)
    /// @param creationCode The contract creation bytecode (type(ComplianceHook).creationCode)
    /// @param constructorArgs ABI-encoded constructor arguments
    /// @return hookAddress The mined address
    /// @return salt        The salt to use in CREATE2
    function find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs)
        internal
        pure
        returns (address hookAddress, bytes32 salt)
    {
        bytes memory initCode = abi.encodePacked(creationCode, constructorArgs);
        bytes32 initCodeHash = keccak256(initCode);

        for (uint256 i = 0; i < 100_000; i++) {
            salt = bytes32(i);
            hookAddress = _computeAddress(deployer, salt, initCodeHash);
            if ((uint160(hookAddress) & ALL_HOOK_MASK) == flags) {
                return (hookAddress, salt);
            }
        }
        revert("HookMiner: could not find salt in 100_000 iterations");
    }

    function _computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) private pure returns (address addr) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash));
        addr = address(uint160(uint256(h)));
    }
}
