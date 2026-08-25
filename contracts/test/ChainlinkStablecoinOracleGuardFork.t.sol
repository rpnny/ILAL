// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IChainlinkAggregatorV3} from "../src/interfaces/IChainlinkAggregatorV3.sol";
import {IStablecoinOracleGuard} from "../src/interfaces/IStablecoinOracleGuard.sol";
import {ChainlinkStablecoinOracleGuard} from "../src/oracle/ChainlinkStablecoinOracleGuard.sol";

interface IERC20MetadataFork {
    function decimals() external view returns (uint8);
}

contract ChainlinkStablecoinOracleGuardForkTest is Test {
    address internal constant CIRCLE_TEST_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address internal constant USDC_USD = 0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165;
    address internal constant USDT_USD = 0x3ec8593F930EA45ea58c968260e6e9FF53FC934f;
    uint256 internal constant PINNED_BLOCK = 45_931_635;

    bool internal forkConfigured;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl, vm.envOr("ILAL_BASE_SEPOLIA_FEED_BLOCK", PINNED_BLOCK));
        forkConfigured = true;
    }

    function testFork_realBaseSepoliaFeedsPassGuard() public {
        if (!forkConfigured) return;
        assertGt(CIRCLE_TEST_USDC.code.length, 0);
        assertEq(IERC20MetadataFork(CIRCLE_TEST_USDC).decimals(), 6);
        assertGt(USDC_USD.code.length, 0);
        assertGt(USDT_USD.code.length, 0);
        assertEq(IChainlinkAggregatorV3(USDC_USD).description(), "USDC / USD");
        assertEq(IChainlinkAggregatorV3(USDT_USD).description(), "USDT / USD");
        assertEq(IChainlinkAggregatorV3(USDC_USD).decimals(), 8);
        assertEq(IChainlinkAggregatorV3(USDT_USD).decimals(), 8);

        ChainlinkStablecoinOracleGuard guard = new ChainlinkStablecoinOracleGuard(
            IChainlinkAggregatorV3(USDC_USD),
            IChainlinkAggregatorV3(USDT_USD),
            90_000,
            90_000,
            100,
            100,
            IChainlinkAggregatorV3(address(0)),
            0
        );
        IStablecoinOracleGuard.OracleSnapshot memory snapshot = guard.validate();
        assertGe(snapshot.price0Wad, 99e16);
        assertLe(snapshot.price0Wad, 101e16);
        assertGe(snapshot.price1Wad, 99e16);
        assertLe(snapshot.price1Wad, 101e16);
        assertLe(block.timestamp - snapshot.updatedAt0, 90_000);
        assertLe(block.timestamp - snapshot.updatedAt1, 90_000);
        assertFalse(snapshot.sequencerCheckEnabled);
    }
}
