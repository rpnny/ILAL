// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IChainlinkAggregatorV3} from "../src/interfaces/IChainlinkAggregatorV3.sol";
import {IStablecoinOracleGuard} from "../src/interfaces/IStablecoinOracleGuard.sol";
import {ChainlinkStablecoinOracleGuard} from "../src/oracle/ChainlinkStablecoinOracleGuard.sol";
import {MockChainlinkAggregator} from "./mocks/MockChainlinkAggregator.sol";

contract ChainlinkStablecoinOracleGuardTest is Test {
    MockChainlinkAggregator internal feed0;
    MockChainlinkAggregator internal feed1;
    ChainlinkStablecoinOracleGuard internal guard;

    function setUp() public {
        vm.warp(1_000_000);
        feed0 = new MockChainlinkAggregator(8, "USDC / USD", 1e8);
        feed1 = new MockChainlinkAggregator(8, "USDT / USD", 1e8);
        guard = _guard(feed0, feed1, MockChainlinkAggregator(address(0)), 0);
    }

    function test_validateReturnsNormalizedSnapshot() public view {
        IStablecoinOracleGuard.OracleSnapshot memory snapshot = guard.validate();
        assertEq(snapshot.price0Wad, 1e18);
        assertEq(snapshot.price1Wad, 1e18);
        assertEq(snapshot.updatedAt0, block.timestamp);
        assertEq(snapshot.updatedAt1, block.timestamp);
        assertFalse(snapshot.sequencerCheckEnabled);
    }

    function test_acceptsExactIndividualDeviationBoundary() public {
        feed0.setRound(2, 99_000_000, block.timestamp, block.timestamp);
        feed1.setRound(2, 99_000_000, block.timestamp, block.timestamp);
        guard.validate();
    }

    function testFuzz_acceptsSupportedFeedDecimals(uint8 decimals) public {
        decimals = uint8(bound(decimals, 0, 18));
        int256 unit = int256(10 ** decimals);
        MockChainlinkAggregator first = new MockChainlinkAggregator(decimals, "A / USD", unit);
        MockChainlinkAggregator second = new MockChainlinkAggregator(decimals, "B / USD", unit);
        IStablecoinOracleGuard.OracleSnapshot memory snapshot =
            _guard(first, second, MockChainlinkAggregator(address(0)), 0).validate();
        assertEq(snapshot.price0Wad, 1e18);
        assertEq(snapshot.price1Wad, 1e18);
    }

    function test_acceptsDifferentFeedDecimals() public {
        MockChainlinkAggregator sixDecimals = new MockChainlinkAggregator(6, "A / USD", 1e6);
        MockChainlinkAggregator eighteenDecimals = new MockChainlinkAggregator(18, "B / USD", 1e18);
        IStablecoinOracleGuard.OracleSnapshot memory snapshot =
            _guard(sixDecimals, eighteenDecimals, MockChainlinkAggregator(address(0)), 0).validate();
        assertEq(snapshot.price0Wad, 1e18);
        assertEq(snapshot.price1Wad, 1e18);
    }

    function test_revertsOneBpsBeyondPegBoundary() public {
        feed0.setRound(2, 98_990_000, block.timestamp, block.timestamp);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.PegDeviationExceeded.selector);
        guard.validate();
    }

    function test_revertsPairDeviationWhenBothIndividualPricesAreAllowed() public {
        feed0.setRound(2, 100_500_000, block.timestamp, block.timestamp);
        feed1.setRound(2, 99_500_000, block.timestamp, block.timestamp);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.PairDeviationExceeded.selector);
        guard.validate();
    }

    function test_revertsStaleAndFuturePrices() public {
        feed0.setRound(2, 1e8, block.timestamp - 90_001, block.timestamp - 90_001);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.StalePrice.selector);
        guard.validate();

        feed0.setRound(3, 1e8, block.timestamp + 1, block.timestamp + 1);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.FutureTimestamp.selector);
        guard.validate();
    }

    function test_revertsInvalidRoundAndAnswers() public {
        feed0.setRound(0, 1e8, block.timestamp, 0);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.InvalidRound.selector);
        guard.validate();

        feed0.setRound(2, 0, block.timestamp, block.timestamp);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.InvalidAnswer.selector);
        guard.validate();

        feed0.setRound(3, -1, block.timestamp, block.timestamp);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.InvalidAnswer.selector);
        guard.validate();

        feed0.setRound(4, 1e8, block.timestamp, block.timestamp);
        feed0.setAnsweredInRound(3);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.InvalidRound.selector);
        guard.validate();
    }

    function test_revertsWhenFeedCallFails() public {
        feed0.setShouldRevert(true);
        vm.expectRevert(abi.encodeWithSelector(ChainlinkStablecoinOracleGuard.FeedCallFailed.selector, address(feed0)));
        guard.validate();
    }

    function test_revertsWhenSequencerDownAndDuringGracePeriod() public {
        MockChainlinkAggregator sequencer = new MockChainlinkAggregator(0, "L2 Sequencer Uptime Status Feed", 1);
        ChainlinkStablecoinOracleGuard guarded = _guard(feed0, feed1, sequencer, 3600);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.SequencerDown.selector);
        guarded.validate();

        sequencer.setRound(2, 0, block.timestamp - 3600, block.timestamp);
        vm.expectRevert(
            abi.encodeWithSelector(ChainlinkStablecoinOracleGuard.SequencerGracePeriodNotOver.selector, 3600, 3600)
        );
        guarded.validate();

        sequencer.setRound(3, 0, block.timestamp - 3601, block.timestamp);
        assertTrue(guarded.validate().sequencerCheckEnabled);

        sequencer.setRound(4, 0, block.timestamp + 1, block.timestamp);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.SequencerInvalidTimestamp.selector);
        guarded.validate();
    }

    function test_constructorRejectsUnsupportedDecimals() public {
        MockChainlinkAggregator invalid = new MockChainlinkAggregator(19, "INVALID", 1e18);
        vm.expectPartialRevert(ChainlinkStablecoinOracleGuard.UnsupportedFeedDecimals.selector);
        _guard(invalid, feed1, MockChainlinkAggregator(address(0)), 0);
    }

    function test_constructorRejectsInvalidFeedPair() public {
        vm.expectRevert(abi.encodeWithSelector(ChainlinkStablecoinOracleGuard.InvalidFeed.selector, address(1)));
        _guard(MockChainlinkAggregator(address(1)), feed1, MockChainlinkAggregator(address(0)), 0);

        vm.expectRevert(ChainlinkStablecoinOracleGuard.InvalidConfiguration.selector);
        _guard(feed0, feed0, MockChainlinkAggregator(address(0)), 0);
    }

    function _guard(
        MockChainlinkAggregator first,
        MockChainlinkAggregator second,
        MockChainlinkAggregator sequencer,
        uint256 gracePeriod
    ) internal returns (ChainlinkStablecoinOracleGuard) {
        return new ChainlinkStablecoinOracleGuard(
            IChainlinkAggregatorV3(address(first)),
            IChainlinkAggregatorV3(address(second)),
            90_000,
            90_000,
            100,
            100,
            IChainlinkAggregatorV3(address(sequencer)),
            gracePeriod
        );
    }
}
