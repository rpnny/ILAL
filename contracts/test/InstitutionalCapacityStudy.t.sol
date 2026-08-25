// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {InstitutionalNettingHook} from "../src/netting/InstitutionalNettingHook.sol";
import {InstitutionalBatchRouter} from "../src/netting/InstitutionalBatchRouter.sol";
import {NettingTypes} from "../src/netting/NettingTypes.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";

contract InstitutionalCapacityStudy is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant UNIT = 1e6;
    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 10;
    uint128 internal constant BASE_LIQUIDITY = 1e12;
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;

    struct Fixture {
        IPoolManager manager;
        InstitutionalBatchRouter router;
        InstitutionalNettingHook hook;
        MockERC20 token0;
        MockERC20 token1;
        PoolKey key;
        address alice;
        address bob;
    }

    function testStudy_capacityFrontier_025x_r100() public {
        _runRangeFrontier(2_500, 100);
    }

    function testStudy_capacityFrontier_025x_r1000() public {
        _runRangeFrontier(2_500, 1_000);
    }

    function testStudy_capacityFrontier_025x_r10000() public {
        _runRangeFrontier(2_500, 10_000);
    }

    function testStudy_capacityFrontier_050x_r100() public {
        _runRangeFrontier(5_000, 100);
    }

    function testStudy_capacityFrontier_050x_r1000() public {
        _runRangeFrontier(5_000, 1_000);
    }

    function testStudy_capacityFrontier_050x_r10000() public {
        _runRangeFrontier(5_000, 10_000);
    }

    function testStudy_capacityFrontier_100x_r100() public {
        _runRangeFrontier(10_000, 100);
    }

    function testStudy_capacityFrontier_100x_r1000() public {
        _runRangeFrontier(10_000, 1_000);
    }

    function testStudy_capacityFrontier_100x_r10000() public {
        _runRangeFrontier(10_000, 10_000);
    }

    function testStudy_capacityFrontier_200x_r100() public {
        _runRangeFrontier(20_000, 100);
    }

    function testStudy_capacityFrontier_200x_r1000() public {
        _runRangeFrontier(20_000, 1_000);
    }

    function testStudy_capacityFrontier_200x_r10000() public {
        _runRangeFrontier(20_000, 10_000);
    }

    function testStudy_capacityFrontier_1000x_r100() public {
        _runRangeFrontier(100_000, 100);
    }

    function testStudy_capacityFrontier_1000x_r1000() public {
        _runRangeFrontier(100_000, 1_000);
    }

    function testStudy_capacityFrontier_1000x_r10000() public {
        _runRangeFrontier(100_000, 10_000);
    }

    function _runRangeFrontier(uint256 liquidityBps, int24 range) internal {
        int24[3] memory initialTicks = [int24(0), 90, -90];
        uint256[3] memory balanceBps = [uint256(5_000), 10_000, 20_000];
        for (uint256 k; k < initialTicks.length; ++k) {
            Fixture memory fixture = _deployFixture(liquidityBps, range, initialTicks[k]);
            for (uint256 m; m < balanceBps.length; ++m) {
                _measureFrontier(fixture, liquidityBps, range, initialTicks[k], balanceBps[m]);
            }
        }
    }

    function _deployFixture(uint256 liquidityBps, int24 range, int24 initialTick)
        internal
        returns (Fixture memory fixture)
    {
        fixture.manager = new PoolManager(address(this));
        fixture.router = new InstitutionalBatchRouter(fixture.manager);
        PolicyRegistry registry = new PolicyRegistry();
        MockCNFIssuer issuer = new MockCNFIssuer();
        MockERC20 tokenA = new MockERC20("Capacity USD A", "cUSDA", 6);
        MockERC20 tokenB = new MockERC20("Capacity USD B", "cUSDB", 6);
        (fixture.token0, fixture.token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes memory args = abi.encode(
            fixture.manager,
            registry,
            address(fixture.router),
            address(fixture.token0),
            address(fixture.token1),
            FEE,
            TICK_SPACING,
            int24(100)
        );
        (, bytes32 salt) = HookMiner.find(
            address(this),
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG,
            type(InstitutionalNettingHook).creationCode,
            args
        );
        fixture.hook = new InstitutionalNettingHook{salt: salt}(
            fixture.manager,
            registry,
            address(fixture.router),
            address(fixture.token0),
            address(fixture.token1),
            FEE,
            TICK_SPACING,
            100
        );
        fixture.key = PoolKey({
            currency0: Currency.wrap(address(fixture.token0)),
            currency1: Currency.wrap(address(fixture.token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(fixture.hook))
        });
        fixture.manager.initialize(fixture.key, TickMath.getSqrtPriceAtTick(initialTick));
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(fixture.manager);
        fixture.token0.mint(address(this), 1e24);
        fixture.token1.mint(address(this), 1e24);
        fixture.token0.approve(address(liquidityRouter), type(uint256).max);
        fixture.token1.approve(address(liquidityRouter), type(uint256).max);
        uint128 liquidity = uint128(uint256(BASE_LIQUIDITY) * liquidityBps / 10_000);
        liquidityRouter.modifyLiquidity(
            fixture.key,
            ModifyLiquidityParams({
                tickLower: -range, tickUpper: range, liquidityDelta: int256(uint256(liquidity)), salt: 0
            }),
            ""
        );
        fixture.alice = vm.addr(ALICE_KEY);
        fixture.bob = vm.addr(BOB_KEY);
        issuer.setValid(fixture.alice, true);
        issuer.setValid(fixture.bob, true);
        registry.setPolicy(PoolId.unwrap(fixture.key.toId()), address(issuer), issuer.defaultCredentialType());
        vm.prank(fixture.alice);
        fixture.token0.approve(address(fixture.router), type(uint256).max);
        vm.prank(fixture.bob);
        fixture.token1.approve(address(fixture.router), type(uint256).max);
    }

    function _measureFrontier(
        Fixture memory fixture,
        uint256 liquidityBps,
        int24 range,
        int24 initialTick,
        uint256 balanceBps
    ) internal {
        uint256 low;
        uint256 high = 1_000_001;
        bytes4 firstFailure;
        while (low + 1 < high) {
            uint256 mid = (low + high) / 2;
            (bool success, bytes4 selector) = _canExecute(fixture, mid, balanceBps);
            if (success) {
                low = mid;
            } else {
                high = mid;
                firstFailure = selector;
            }
        }
        emit log_string(string.concat(
                "CAPACITY|liquidityBps=",
                vm.toString(liquidityBps),
                "|range=",
                vm.toString(int256(range)),
                "|initialTick=",
                vm.toString(int256(initialTick)),
                "|balanceBps=",
                vm.toString(balanceBps),
                "|maxSafeNotional=",
                vm.toString(low),
                "|firstFailureNotional=",
                high == 1_000_001 ? "none" : vm.toString(high),
                "|selector=",
                vm.toString(bytes32(firstFailure))
            ));
    }

    function _canExecute(Fixture memory fixture, uint256 notionalTokens, uint256 balanceBps)
        internal
        returns (bool success, bytes4 selector)
    {
        uint256 snapshot = vm.snapshotState();
        uint256 amount0 = notionalTokens * UNIT;
        uint256 amount1 = amount0 * 70 / 100;
        uint256 physicalBalance = (amount0 + amount1) * balanceBps / 10_000;
        deal(address(fixture.token0), address(fixture.manager), physicalBalance, true);
        deal(address(fixture.token1), address(fixture.manager), physicalBalance, true);
        deal(address(fixture.token0), fixture.alice, amount0, true);
        deal(address(fixture.token1), fixture.bob, amount1, true);
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(fixture, fixture.alice, true, amount0, bytes32(uint256(1)));
        orders[1] = _order(fixture, fixture.bob, false, amount1, bytes32(uint256(2)));
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(fixture.hook, orders[0], ALICE_KEY);
        signatures[1] = _sign(fixture.hook, orders[1], BOB_KEY);
        try fixture.router.executeBatch(fixture.key, orders, signatures) returns (bytes32) {
            success = true;
        } catch (bytes memory reason) {
            if (reason.length >= 4) assembly ("memory-safe") { selector := mload(add(reason, 0x20)) }
        }
        assertTrue(vm.revertToState(snapshot));
    }

    function _order(Fixture memory fixture, address user, bool zeroForOne, uint256 amount, bytes32 nonce)
        internal
        view
        returns (NettingTypes.NettingOrder memory)
    {
        return NettingTypes.NettingOrder({
            user: user,
            poolId: fixture.hook.supportedPoolId(),
            zeroForOne: zeroForOne,
            amountIn: uint128(amount),
            minAmountOut: 0,
            maxAmmInput: uint128(amount),
            deadline: type(uint64).max,
            nonce: nonce
        });
    }

    function _sign(InstitutionalNettingHook hook, NettingTypes.NettingOrder memory order, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, hook.orderDigest(order));
        return abi.encodePacked(r, s, v);
    }
}
