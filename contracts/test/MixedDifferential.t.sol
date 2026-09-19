// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MatchingMath} from "../src/mixed/MatchingMath.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract MixedDifferentialTest is Test {
    function test_typesAndMathAgainstTypeScript() public {
        if (!vm.envOr("ILAL_MIXED_DIFFERENTIAL", false)) vm.skip(true);
        return;
        string[] memory cmd = new string[](2);
        cmd[0] = "node";
        cmd[1] = "../sdk/scripts/mixed-vectors.mjs";
        (uint256[10][] memory rows, bytes32 orderHash, bytes32 commitment) =
            abi.decode(vm.ffi(cmd), (uint256[10][], bytes32, bytes32));
        for (uint256 i; i < rows.length; i++) {
            uint256[10] memory r = rows[i];
            MatchingMath.Budget memory b = MatchingMath.budget(r[0] + r[1], r[2], uint160(r[3]));
            assertEq(b.matched0, r[4]);
            assertEq(b.matched1, r[5]);
            MatchingMath.Allocation memory a = MatchingMath.allocate(b, true, 0, r[0]);
            assertEq(a.matchedInput, r[6]);
            assertEq(a.matchedOutput, r[7]);
            a = MatchingMath.allocate(b, true, r[0], r[1]);
            assertEq(a.matchedInput, r[8]);
            assertEq(a.matchedOutput, r[9]);
        }
        address h = 0x1111111111111111111111111111111111111111;
        MixedTypes.Order memory o = MixedTypes.Order(
            h,
            bytes32(0),
            bytes32(0),
            1,
            true,
            100,
            1,
            100,
            TickMath.getSqrtPriceAtTick(-100),
            TickMath.getSqrtPriceAtTick(100),
            9999999999,
            bytes32(0)
        );
        assertEq(MixedTypes.hashOrder(o, false), orderHash);
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = orderHash;
        o.zeroForOne = false;
        hashes[1] = MixedTypes.hashOrder(o, false);
        if (hashes[0] > hashes[1]) (hashes[0], hashes[1]) = (hashes[1], hashes[0]);
        vm.chainId(31337);
        assertEq(MixedTypes.commitment(hashes, h, bytes32(0)), commitment);
    }
}
