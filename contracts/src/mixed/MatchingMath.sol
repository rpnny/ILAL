// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Fee-free crossing at an execution-time, pre-fee pool reference price.
library MatchingMath {
    uint256 internal constant Q192 = 1 << 192;
    uint256 internal constant MAX_AMOUNT = uint256(uint128(type(int128).max));
    error InvalidPrice();
    error InvalidTotals();
    error NoMatch();
    error ZeroMatchedOutput();

    struct Budget {
        uint256 total0;
        uint256 total1;
        uint256 matched0;
        uint256 matched1;
    }

    struct Allocation {
        uint256 matchedInput;
        uint256 matchedOutput;
        uint256 residual;
    }

    function numerator(uint160 s) internal pure returns (uint256) {
        if (s < TickMath.getSqrtPriceAtTick(-100) || s > TickMath.getSqrtPriceAtTick(100)) revert InvalidPrice();
        return uint256(s) * s;
    }

    function budget(uint256 t0, uint256 t1, uint160 s) internal pure returns (Budget memory b) {
        if (t0 == 0 || t1 == 0 || t0 > MAX_AMOUNT || t1 > MAX_AMOUNT) revert InvalidTotals();
        uint256 n = numerator(s);
        uint256 converted = FullMath.mulDiv(t1, Q192, n);
        uint256 m0 = t0 < converted ? t0 : converted;
        uint256 m1 = FullMath.mulDiv(m0, n, Q192);
        if (m0 == 0 || m1 == 0) revert NoMatch();
        b = Budget(t0, t1, m0, m1);
    }

    /// @dev cumulativeInput is the side's input before this order, in canonical order.
    function allocate(Budget memory b, bool zeroForOne, uint256 cumulativeInput, uint256 amount)
        internal
        pure
        returns (Allocation memory a)
    {
        uint256 total = zeroForOne ? b.total0 : b.total1;
        uint256 matched = zeroForOne ? b.matched0 : b.matched1;
        uint256 output = zeroForOne ? b.matched1 : b.matched0;
        if (amount == 0 || cumulativeInput + amount > total) revert InvalidTotals();
        uint256 beforeInput = FullMath.mulDiv(cumulativeInput, matched, total);
        uint256 afterInput = FullMath.mulDiv(cumulativeInput + amount, matched, total);
        a.matchedInput = afterInput - beforeInput;
        a.matchedOutput = FullMath.mulDiv(afterInput, output, matched) - FullMath.mulDiv(beforeInput, output, matched);
        a.residual = amount - a.matchedInput;
        if (a.matchedInput != 0 && a.matchedOutput == 0) revert ZeroMatchedOutput();
    }
}
