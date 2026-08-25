// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

interface IStablecoinOracleGuard {
    struct OracleSnapshot {
        uint256 price0Wad;
        uint256 price1Wad;
        uint256 updatedAt0;
        uint256 updatedAt1;
        bool sequencerCheckEnabled;
    }

    function validate() external view returns (OracleSnapshot memory snapshot);
}
