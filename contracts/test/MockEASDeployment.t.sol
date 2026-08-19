// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {MockEAS} from "../src/test/MockEAS.sol";

contract MockEASDeploymentTest is Test {
    function test_nextUidIsStableAcrossBlockTimeAndAdvancesWithNonce() public {
        MockEAS eas = new MockEAS();
        bytes32 schema = keccak256("schema");
        address recipient = makeAddr("recipient");
        address attester = makeAddr("attester");
        uint64 expiration = uint64(block.timestamp + 90 days);

        bytes32 first = eas.nextUID(schema, recipient, attester, expiration, "");
        vm.warp(block.timestamp + 1 hours);
        assertEq(eas.attest(schema, recipient, attester, expiration, ""), first);

        bytes32 second = eas.nextUID(schema, recipient, attester, expiration, "");
        assertNotEq(second, first);
        assertEq(eas.attest(schema, recipient, attester, expiration, ""), second);
    }
}
