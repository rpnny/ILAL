// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PilotAsset} from "../src/mocks/PilotAsset.sol";
import {PilotCNFIssuer} from "../src/mocks/PilotCNFIssuer.sol";

contract PilotSandboxTest is Test {
    address private issuer = makeAddr("issuer");
    address private cashOperator = makeAddr("cashOperator");
    address private institution = makeAddr("institution");

    function test_rolesControlOnlyTheirPilotAssetAndCredential() public {
        PilotAsset issuerAsset = new PilotAsset("Issuer Stablecoin", "iUSD", 6, issuer);
        PilotAsset cash = new PilotAsset("Sandbox Settlement Cash", "sUSD", 6, cashOperator);
        PilotCNFIssuer cnf = new PilotCNFIssuer(issuer, keccak256("ilal.pilot.issuer-eligible"));

        vm.prank(issuer);
        issuerAsset.mint(institution, 100e6);
        vm.prank(cashOperator);
        cash.mint(institution, 70e6);
        vm.prank(issuer);
        cnf.issue(institution, uint64(block.timestamp + 1 days));

        assertEq(issuerAsset.balanceOf(institution), 100e6);
        assertEq(cash.balanceOf(institution), 70e6);
        assertTrue(cnf.isValid(institution));

        vm.expectRevert();
        vm.prank(cashOperator);
        issuerAsset.mint(institution, 1);
        vm.prank(issuer);
        cnf.revoke(institution);
        assertFalse(cnf.isValid(institution));
    }
}
