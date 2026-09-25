// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MixedHookFactory} from "../src/mixed/MixedHookFactory.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract MixedHookFactoryTest is Test {
    function test_ownerControlsDeterministicDeploymentAndSaltCannotReplay() external {
        MixedHookFactory factory = new MixedHookFactory(address(this));
        bytes32 salt = keccak256("reviewed-salt");
        bytes memory creationCode = abi.encodePacked(type(MockERC20).creationCode, abi.encode("USD", "USD", 6));
        address expected = vm.computeCreate2Address(salt, keccak256(creationCode), address(factory));

        vm.prank(address(0xB0B));
        vm.expectRevert("OWNER");
        factory.deploy(salt, creationCode);

        assertEq(factory.deploy(salt, creationCode), expected);
        assertGt(expected.code.length, 0);
        vm.expectRevert("CREATE2");
        factory.deploy(salt, creationCode);
    }
}
