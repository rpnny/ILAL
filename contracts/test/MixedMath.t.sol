// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MatchingMath} from "../src/mixed/MatchingMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

contract MixedMathTest is Test {
    function test_parAndTick90() public pure {
        MatchingMath.Budget memory b = MatchingMath.budget(100e6, 70e6, uint160(1 << 96));
        assertEq(b.matched0, 70e6);
        assertEq(b.matched1, 70e6);
        b = MatchingMath.budget(100e6, 70e6, TickMath.getSqrtPriceAtTick(90));
        assertEq(b.matched0, 69372857);
        assertEq(b.matched1, 69999999);
    }

    function testFuzz_partitionConserves(uint64 a, uint64 c, uint64 other, int24 tick) public pure {
        uint256 x = bound(a, 1e6, 1e9);
        uint256 y = bound(c, 1e6, 1e9);
        uint256 z = bound(other, 1e6, 1e9);
        tick = int24(bound(tick, -100, 100));
        MatchingMath.Budget memory b = MatchingMath.budget(x + y, z, TickMath.getSqrtPriceAtTick(tick));
        MatchingMath.Allocation memory p = MatchingMath.allocate(b, true, 0, x);
        MatchingMath.Allocation memory q = MatchingMath.allocate(b, true, x, y);
        MatchingMath.Allocation memory r = MatchingMath.allocate(b, false, 0, z);
        assertEq(p.matchedInput + q.matchedInput, r.matchedOutput);
        assertEq(p.matchedOutput + q.matchedOutput, r.matchedInput);
        assertEq(p.residual + q.residual + b.matched0, x + y);
        assertEq(r.residual + b.matched1, z);
    }

    function test_amountBound() public {
        vm.expectRevert(MatchingMath.InvalidTotals.selector);
        this.calculate(uint256(uint128(type(int128).max)) + 1, 1e6, uint160(1 << 96));
    }

    function test_noMatch() public {
        vm.expectRevert(MatchingMath.NoMatch.selector);
        this.calculate(1, 1, TickMath.getSqrtPriceAtTick(90));
    }

    function calculate(uint256 a, uint256 b, uint160 s) external pure returns (MatchingMath.Budget memory) {
        return MatchingMath.budget(a, b, s);
    }
}
