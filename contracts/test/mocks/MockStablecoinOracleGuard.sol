// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IStablecoinOracleGuard} from "../../src/interfaces/IStablecoinOracleGuard.sol";

/// @dev Benchmark-only baseline for isolating the incremental Chainlink read cost.
contract MockStablecoinOracleGuard is IStablecoinOracleGuard {
    function validate() external view returns (OracleSnapshot memory snapshot) {
        snapshot = OracleSnapshot({
            price0Wad: 1e18,
            price1Wad: 1e18,
            updatedAt0: block.timestamp,
            updatedAt1: block.timestamp,
            sequencerCheckEnabled: false
        });
    }
}
