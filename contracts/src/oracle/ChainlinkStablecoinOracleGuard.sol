// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IChainlinkAggregatorV3} from "../interfaces/IChainlinkAggregatorV3.sol";
import {IStablecoinOracleGuard} from "../interfaces/IStablecoinOracleGuard.sol";

/// @title ChainlinkStablecoinOracleGuard
/// @notice Fail-closed batch-opening guard for two USD-quoted Chainlink feeds.
contract ChainlinkStablecoinOracleGuard is IStablecoinOracleGuard {
    uint256 public constant WAD = 1e18;
    uint256 public constant BPS = 10_000;

    error InvalidFeed(address feed);
    error InvalidConfiguration();
    error UnsupportedFeedDecimals(address feed, uint8 decimals);
    error FeedCallFailed(address feed);
    error InvalidRound(address feed, uint80 roundId, uint256 updatedAt);
    error InvalidAnswer(address feed, int256 answer);
    error FutureTimestamp(address feed, uint256 updatedAt, uint256 currentTimestamp);
    error StalePrice(address feed, uint256 updatedAt, uint256 maxAge);
    error PegDeviationExceeded(uint8 tokenIndex, uint256 priceWad, uint256 maxDeviationBps);
    error PairDeviationExceeded(uint256 price0Wad, uint256 price1Wad, uint256 maxDeviationBps);
    error SequencerDown();
    error SequencerInvalidTimestamp(uint256 startedAt, uint256 currentTimestamp);
    error SequencerGracePeriodNotOver(uint256 elapsed, uint256 required);

    IChainlinkAggregatorV3 public immutable feed0;
    IChainlinkAggregatorV3 public immutable feed1;
    IChainlinkAggregatorV3 public immutable sequencerUptimeFeed;
    uint8 public immutable feed0Decimals;
    uint8 public immutable feed1Decimals;
    uint256 public immutable maxAge0;
    uint256 public immutable maxAge1;
    uint256 public immutable maxUsdDeviationBps;
    uint256 public immutable maxPairDeviationBps;
    uint256 public immutable sequencerGracePeriod;

    constructor(
        IChainlinkAggregatorV3 _feed0,
        IChainlinkAggregatorV3 _feed1,
        uint256 _maxAge0,
        uint256 _maxAge1,
        uint256 _maxUsdDeviationBps,
        uint256 _maxPairDeviationBps,
        IChainlinkAggregatorV3 _sequencerUptimeFeed,
        uint256 _sequencerGracePeriod
    ) {
        if (address(_feed0).code.length == 0) revert InvalidFeed(address(_feed0));
        if (address(_feed1).code.length == 0) revert InvalidFeed(address(_feed1));
        if (address(_feed0) == address(_feed1)) revert InvalidConfiguration();
        if (_maxAge0 == 0 || _maxAge1 == 0 || _maxUsdDeviationBps > BPS || _maxPairDeviationBps > BPS) {
            revert InvalidConfiguration();
        }
        if (address(_sequencerUptimeFeed) == address(0)) {
            if (_sequencerGracePeriod != 0) revert InvalidConfiguration();
        } else if (address(_sequencerUptimeFeed).code.length == 0 || _sequencerGracePeriod == 0) {
            revert InvalidConfiguration();
        }

        uint8 decimals0;
        uint8 decimals1;
        try _feed0.decimals() returns (uint8 value) {
            decimals0 = value;
        } catch {
            revert FeedCallFailed(address(_feed0));
        }
        try _feed1.decimals() returns (uint8 value) {
            decimals1 = value;
        } catch {
            revert FeedCallFailed(address(_feed1));
        }
        if (decimals0 > 18) revert UnsupportedFeedDecimals(address(_feed0), decimals0);
        if (decimals1 > 18) revert UnsupportedFeedDecimals(address(_feed1), decimals1);

        feed0 = _feed0;
        feed1 = _feed1;
        sequencerUptimeFeed = _sequencerUptimeFeed;
        feed0Decimals = decimals0;
        feed1Decimals = decimals1;
        maxAge0 = _maxAge0;
        maxAge1 = _maxAge1;
        maxUsdDeviationBps = _maxUsdDeviationBps;
        maxPairDeviationBps = _maxPairDeviationBps;
        sequencerGracePeriod = _sequencerGracePeriod;
    }

    function validate() external view returns (OracleSnapshot memory snapshot) {
        bool sequencerEnabled = address(sequencerUptimeFeed) != address(0);
        if (sequencerEnabled) _validateSequencer();

        (uint256 price0Wad, uint256 updatedAt0) = _read(feed0, feed0Decimals, maxAge0);
        (uint256 price1Wad, uint256 updatedAt1) = _read(feed1, feed1Decimals, maxAge1);
        _validatePeg(0, price0Wad);
        _validatePeg(1, price1Wad);

        uint256 difference = price0Wad > price1Wad ? price0Wad - price1Wad : price1Wad - price0Wad;
        uint256 smaller = price0Wad < price1Wad ? price0Wad : price1Wad;
        if (difference * BPS > smaller * maxPairDeviationBps) {
            revert PairDeviationExceeded(price0Wad, price1Wad, maxPairDeviationBps);
        }

        snapshot = OracleSnapshot({
            price0Wad: price0Wad,
            price1Wad: price1Wad,
            updatedAt0: updatedAt0,
            updatedAt1: updatedAt1,
            sequencerCheckEnabled: sequencerEnabled
        });
    }

    function _read(IChainlinkAggregatorV3 feed, uint8 decimals, uint256 maxAge)
        internal
        view
        returns (uint256 priceWad, uint256 updatedAt)
    {
        uint80 roundId;
        int256 answer;
        uint80 answeredInRound;
        try feed.latestRoundData() returns (
            uint80 returnedRoundId,
            int256 returnedAnswer,
            uint256,
            uint256 returnedUpdatedAt,
            uint80 returnedAnsweredInRound
        ) {
            roundId = returnedRoundId;
            answer = returnedAnswer;
            updatedAt = returnedUpdatedAt;
            answeredInRound = returnedAnsweredInRound;
        } catch {
            revert FeedCallFailed(address(feed));
        }
        if (roundId == 0 || answeredInRound < roundId || updatedAt == 0) {
            revert InvalidRound(address(feed), roundId, updatedAt);
        }
        if (answer <= 0) revert InvalidAnswer(address(feed), answer);
        if (updatedAt > block.timestamp) revert FutureTimestamp(address(feed), updatedAt, block.timestamp);
        if (block.timestamp - updatedAt > maxAge) revert StalePrice(address(feed), updatedAt, maxAge);
        priceWad = uint256(answer) * (10 ** (18 - decimals));
    }

    function _validatePeg(uint8 tokenIndex, uint256 priceWad) internal view {
        uint256 difference = priceWad > WAD ? priceWad - WAD : WAD - priceWad;
        if (difference * BPS > WAD * maxUsdDeviationBps) {
            revert PegDeviationExceeded(tokenIndex, priceWad, maxUsdDeviationBps);
        }
    }

    function _validateSequencer() internal view {
        int256 answer;
        uint256 startedAt;
        try sequencerUptimeFeed.latestRoundData() returns (
            uint80, int256 returnedAnswer, uint256 returnedStartedAt, uint256, uint80
        ) {
            answer = returnedAnswer;
            startedAt = returnedStartedAt;
        } catch {
            revert FeedCallFailed(address(sequencerUptimeFeed));
        }
        if (answer != 0) revert SequencerDown();
        if (startedAt == 0 || startedAt > block.timestamp) {
            revert SequencerInvalidTimestamp(startedAt, block.timestamp);
        }
        uint256 elapsed = block.timestamp - startedAt;
        if (elapsed <= sequencerGracePeriod) {
            revert SequencerGracePeriodNotOver(elapsed, sequencerGracePeriod);
        }
    }
}
