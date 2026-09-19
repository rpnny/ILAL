// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {IStablecoinOracleGuard} from "../interfaces/IStablecoinOracleGuard.sol";
import {MatchingMath} from "./MatchingMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @notice Explicit immutable asset/reference binding and execution price envelope.
contract MixedOracleGuard {
    address public immutable token0;
    address public immutable token1;
    IStablecoinOracleGuard public immutable referenceGuard;
    uint256 public immutable maxPoolOracleDeviationBps;
    uint160 public immutable lower;
    uint160 public immutable upper;
    error PriceOutsideBand();
    error ReferenceDeviation();

    constructor(address t0, address t1, IStablecoinOracleGuard guard, uint256 deviationBps) {
        require(t0 != address(0) && t0 < t1 && t0.code.length > 0 && t1.code.length > 0, "TOKENS");
        require(address(guard).code.length > 0 && deviationBps > 0 && deviationBps <= 100, "ORACLE_CONFIG");
        token0 = t0;
        token1 = t1;
        referenceGuard = guard;
        maxPoolOracleDeviationBps = deviationBps;
        lower = TickMath.getSqrtPriceAtTick(-100);
        upper = TickMath.getSqrtPriceAtTick(100);
    }

    function validate(uint160 s) external view {
        checkBand(s);
        IStablecoinOracleGuard.OracleSnapshot memory r = referenceGuard.validate();
        require(r.price0Wad > 0 && r.price1Wad > 0, "REFERENCE_ZERO");
        uint256 poolRatio = FullMath.mulDiv(MatchingMath.numerator(s), 1e18, 1 << 192);
        uint256 referenceRatio = FullMath.mulDiv(r.price0Wad, 1e18, r.price1Wad);
        uint256 diff = poolRatio > referenceRatio ? poolRatio - referenceRatio : referenceRatio - poolRatio;
        if (diff > FullMath.mulDiv(referenceRatio, maxPoolOracleDeviationBps, 10000)) revert ReferenceDeviation();
    }

    function checkBand(uint160 s) public view {
        if (s < lower || s > upper) revert PriceOutsideBand();
    }

    function priceLimit(bool zeroForOne) external view returns (uint160) {
        return zeroForOne ? lower : upper;
    }
}
