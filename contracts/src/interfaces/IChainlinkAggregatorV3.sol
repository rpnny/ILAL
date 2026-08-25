// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @dev Minimal Chainlink AggregatorV3 interface. See https://docs.chain.link/data-feeds/api-reference.
interface IChainlinkAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
