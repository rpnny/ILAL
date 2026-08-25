// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

contract MockChainlinkAggregator {
    uint8 public immutable decimals;
    string public description;
    uint80 public roundId = 1;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound = 1;
    bool public shouldRevert;

    constructor(uint8 _decimals, string memory _description, int256 _answer) {
        decimals = _decimals;
        description = _description;
        answer = _answer;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
    }

    function setRound(uint80 _roundId, int256 _answer, uint256 _startedAt, uint256 _updatedAt) external {
        roundId = _roundId;
        answer = _answer;
        startedAt = _startedAt;
        updatedAt = _updatedAt;
        answeredInRound = _roundId;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function setAnsweredInRound(uint80 value) external {
        answeredInRound = value;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (shouldRevert) revert("mock feed failure");
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}
