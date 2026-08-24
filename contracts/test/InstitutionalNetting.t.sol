// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/src/test/PoolSwapTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {InstitutionalNettingHook} from "../src/netting/InstitutionalNettingHook.sol";
import {InstitutionalBatchRouter} from "../src/netting/InstitutionalBatchRouter.sol";
import {NettingTypes} from "../src/netting/NettingTypes.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";

contract InstitutionalNettingTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 10;
    int24 internal constant MAX_ABS_TICK = 100;
    uint128 internal constant TEST_LIQUIDITY = 1e12;
    uint256 internal constant UNIT = 1e6;
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;
    uint256 internal constant CAROL_KEY = 0xCA401;
    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    IPoolManager internal manager;
    PoolModifyLiquidityTest internal liquidityRouter;
    InstitutionalBatchRouter internal batchRouter;
    InstitutionalNettingHook internal hook;
    PolicyRegistry internal registry;
    MockCNFIssuer internal issuer;
    MockERC20 internal token0;
    MockERC20 internal token1;
    PoolKey internal key;
    bytes32 internal poolId;
    address internal alice;
    address internal bob;

    struct VanillaPool {
        IPoolManager manager;
        PoolSwapTest swapRouter;
        PoolKey key;
        PoolId id;
    }

    struct VanillaBenchmark {
        uint256 output;
        uint256 gasUsed;
        int24 endingTick;
    }

    struct NettingBenchmark {
        uint256 opposingAmount;
        uint256 gross;
        uint256 matchedGross;
        uint256 residual;
        uint256 output;
        uint256 gasUsed;
        int24 endingTick;
        uint256 lpFee;
        VanillaBenchmark zeroFirst;
        VanillaBenchmark oneFirst;
        uint256 vanillaLpFee;
    }

    function setUp() public {
        alice = vm.addr(ALICE_KEY);
        bob = vm.addr(BOB_KEY);
        manager = new PoolManager(address(this));
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        batchRouter = new InstitutionalBatchRouter(manager);
        registry = new PolicyRegistry();
        issuer = new MockCNFIssuer();

        MockERC20 tokenA = new MockERC20("Mock USD A", "mUSDA", 6);
        MockERC20 tokenB = new MockERC20("Mock USD B", "mUSDB", 6);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        bytes memory constructorArgs = abi.encode(
            manager, registry, address(batchRouter), address(token0), address(token1), FEE, TICK_SPACING, MAX_ABS_TICK
        );
        (address predicted, bytes32 salt) = HookMiner.find(
            address(this),
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG,
            type(InstitutionalNettingHook).creationCode,
            constructorArgs
        );
        hook = new InstitutionalNettingHook{salt: salt}(
            manager, registry, address(batchRouter), address(token0), address(token1), FEE, TICK_SPACING, MAX_ABS_TICK
        );
        assertEq(address(hook), predicted);
        assertEq(uint160(address(hook)) & uint160((1 << 14) - 1), 0x88);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        poolId = PoolId.unwrap(key.toId());
        assertEq(poolId, hook.supportedPoolId());
        manager.initialize(key, SQRT_PRICE_1_1);

        token0.mint(address(this), 1e24);
        token1.mint(address(this), 1e24);
        token0.approve(address(liquidityRouter), type(uint256).max);
        token1.approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -1000, tickUpper: 1000, liquidityDelta: int256(uint256(TEST_LIQUIDITY)), salt: bytes32(0)
            }),
            ""
        );

        issuer.setValid(alice, true);
        issuer.setValid(bob, true);
        registry.setPolicy(poolId, address(issuer), issuer.defaultCredentialType());
        _fundAndApprove(alice, token0, 1_000 * UNIT);
        _fundAndApprove(alice, token1, 1_000 * UNIT);
        _fundAndApprove(bob, token0, 1_000 * UNIT);
        _fundAndApprove(bob, token1, 1_000 * UNIT);
    }

    function test_previewAndExecute_100By70_routesOnly30Residual() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        NettingTypes.BatchHeader memory preview = batchRouter.previewBatch(orders);
        assertEq(preview.total0, 100 * UNIT);
        assertEq(preview.total1, 70 * UNIT);
        assertEq(preview.matchedEachSide, 70 * UNIT);
        assertEq(preview.exposureReduction, 140 * UNIT);
        assertEq(preview.residual0, 30 * UNIT);
        assertEq(preview.residual1, 0);

        uint256 alice0Before = token0.balanceOf(alice);
        uint256 alice1Before = token1.balanceOf(alice);
        uint256 bob0Before = token0.balanceOf(bob);
        uint256 bob1Before = token1.balanceOf(bob);
        (, int24 tickBefore,,) = manager.getSlot0(PoolId.wrap(poolId));

        bytes32 executedId = batchRouter.executeBatch(key, orders, signatures);

        (, int24 tickAfter,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertEq(executedId, preview.batchId);
        assertEq(token0.balanceOf(alice), alice0Before - 100 * UNIT);
        assertGt(token1.balanceOf(alice), alice1Before + 99 * UNIT);
        assertEq(token1.balanceOf(bob), bob1Before - 70 * UNIT);
        assertEq(token0.balanceOf(bob), bob0Before + 70 * UNIT);
        assertLt(tickAfter, tickBefore);
        assertTrue(hook.nonceUsed(alice, orders[0].nonce));
        assertTrue(hook.nonceUsed(bob, orders[1].nonce));
        assertFalse(hook.batchActive());
        assertEq(token0.balanceOf(address(hook)), 0);
        assertEq(token1.balanceOf(address(hook)), 0);
    }

    function test_100By70_poolStateEqualsVanilla30ResidualSwap() public {
        VanillaPool memory vanilla = _deployVanillaPool();
        uint256[4] memory balancesBefore = [
            token0.balanceOf(address(manager)),
            token1.balanceOf(address(manager)),
            token0.balanceOf(address(vanilla.manager)),
            token1.balanceOf(address(vanilla.manager))
        ];

        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        batchRouter.executeBatch(key, orders, signatures);
        vanilla.swapRouter
            .swap(
                vanilla.key,
                SwapParams({zeroForOne: true, amountSpecified: -int256(30 * UNIT), sqrtPriceLimitX96: 4295128740}),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );

        _assertPoolStatesEqual(manager, PoolId.wrap(poolId), vanilla.manager, vanilla.id);
        assertEq(
            int256(token0.balanceOf(address(manager))) - int256(balancesBefore[0]),
            int256(token0.balanceOf(address(vanilla.manager))) - int256(balancesBefore[2])
        );
        assertEq(
            int256(token1.balanceOf(address(manager))) - int256(balancesBefore[1]),
            int256(token1.balanceOf(address(vanilla.manager))) - int256(balancesBefore[3])
        );
    }

    function test_fullyBalancedBatch_doesNotMoveTick() public {
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(alice, true, 70 * UNIT, 70 * UNIT, 0, bytes32(uint256(3)));
        orders[1] = _order(bob, false, 70 * UNIT, 70 * UNIT, 0, bytes32(uint256(4)));
        bytes[] memory signatures = _signOrders(orders);
        (, int24 beforeTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        batchRouter.executeBatch(key, orders, signatures);
        (, int24 afterTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertEq(afterTick, beforeTick);
    }

    function test_multipleOrders_useCanonicalOrderIndependentOfSolverPermutation() public {
        address carol = vm.addr(CAROL_KEY);
        issuer.setValid(carol, true);
        _fundAndApprove(carol, token0, 1_000 * UNIT);
        _fundAndApprove(carol, token1, 1_000 * UNIT);
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](3);
        orders[0] = _order(alice, true, 40 * UNIT, 0, 40 * UNIT, bytes32(uint256(5)));
        orders[1] = _order(bob, false, 70 * UNIT, 0, 70 * UNIT, bytes32(uint256(6)));
        orders[2] = _order(carol, true, 60 * UNIT, 0, 60 * UNIT, bytes32(uint256(7)));
        bytes[] memory signatures = _signOrders(orders);
        NettingTypes.BatchHeader memory preview = batchRouter.previewBatch(orders);
        assertEq(preview.matchedEachSide, 70 * UNIT);
        assertEq(preview.residual0, 30 * UNIT);

        uint256 snapshot = vm.snapshotState();
        batchRouter.executeBatch(key, orders, signatures);
        uint256 alice0After = token0.balanceOf(alice);
        uint256 alice1After = token1.balanceOf(alice);
        uint256 bob0After = token0.balanceOf(bob);
        uint256 bob1After = token1.balanceOf(bob);
        uint256 carol0After = token0.balanceOf(carol);
        uint256 carol1After = token1.balanceOf(carol);
        (uint160 sqrtPriceAfter, int24 tickAfter,,) = manager.getSlot0(PoolId.wrap(poolId));

        assertTrue(vm.revertToState(snapshot));
        _reverseOrderPairs(orders, signatures);
        assertEq(batchRouter.previewBatch(orders).batchId, preview.batchId);
        batchRouter.executeBatch(key, orders, signatures);
        assertEq(token0.balanceOf(alice), alice0After);
        assertEq(token1.balanceOf(alice), alice1After);
        assertEq(token0.balanceOf(bob), bob0After);
        assertEq(token1.balanceOf(bob), bob1After);
        assertEq(token0.balanceOf(carol), carol0After);
        assertEq(token1.balanceOf(carol), carol1After);
        (uint160 permutedSqrtPrice, int24 permutedTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        assertEq(permutedSqrtPrice, sqrtPriceAfter);
        assertEq(permutedTick, tickAfter);
    }

    function test_hookRejectsNonCanonicalOrderingAndDuplicateHashes() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        if (hook.hashOrder(orders[0]) < hook.hashOrder(orders[1])) {
            _reverseOrderPairs(orders, signatures);
        }
        NettingTypes.BatchHeader memory header = batchRouter.previewBatch(orders);

        // InstitutionalBatchRouter stores its private execution flag in slot zero.
        vm.store(address(batchRouter), bytes32(0), bytes32(uint256(1)));
        vm.prank(address(batchRouter));
        vm.expectPartialRevert(NettingTypes.OrdersNotStrictlySorted.selector);
        hook.openBatch(header, orders, signatures);
        vm.store(address(batchRouter), bytes32(0), bytes32(0));

        NettingTypes.NettingOrder[] memory duplicates = new NettingTypes.NettingOrder[](2);
        duplicates[0] = orders[0];
        duplicates[1] = orders[0];
        bytes[] memory duplicateSignatures = new bytes[](2);
        duplicateSignatures[0] = signatures[0];
        duplicateSignatures[1] = signatures[0];
        vm.expectPartialRevert(NettingTypes.OrdersNotStrictlySorted.selector);
        batchRouter.executeBatch(key, duplicates, duplicateSignatures);
    }

    function test_revertsWhenMaxAmmInputExceeded_andRollsBackNonces() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        orders[0].maxAmmInput = uint128(29 * UNIT);
        signatures[0] = _sign(orders[0], ALICE_KEY);
        vm.expectRevert();
        batchRouter.executeBatch(key, orders, signatures);
        assertFalse(hook.nonceUsed(alice, orders[0].nonce));
        assertFalse(hook.nonceUsed(bob, orders[1].nonce));
    }

    function test_revertsWholeBatchOnSlippage() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        orders[0].minAmountOut = uint128(101 * UNIT);
        signatures[0] = _sign(orders[0], ALICE_KEY);
        uint256 alice0Before = token0.balanceOf(alice);
        vm.expectRevert();
        batchRouter.executeBatch(key, orders, signatures);
        assertEq(token0.balanceOf(alice), alice0Before);
        assertFalse(hook.nonceUsed(alice, orders[0].nonce));
    }

    function test_revertsExpiredOrder() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        orders[0].deadline = uint64(block.timestamp - 1);
        signatures[0] = _sign(orders[0], ALICE_KEY);
        vm.expectRevert(InstitutionalNettingHook.OrderExpired.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsInvalidSignature() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        signatures[0] = _sign(orders[0], BOB_KEY);
        vm.expectRevert(InstitutionalNettingHook.InvalidSignature.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_acceptsERC1271WalletSignature() public {
        address carol = vm.addr(CAROL_KEY);
        MockERC1271Wallet wallet = new MockERC1271Wallet(carol);
        issuer.setValid(address(wallet), true);
        _fundAndApprove(address(wallet), token0, 100 * UNIT);

        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(address(wallet), true, 50 * UNIT, 50 * UNIT, 0, bytes32(uint256(41)));
        orders[1] = _order(bob, false, 50 * UNIT, 50 * UNIT, 0, bytes32(uint256(42)));
        bytes[] memory signatures = new bytes[](2);
        signatures[0] = _sign(orders[0], CAROL_KEY);
        signatures[1] = _sign(orders[1], BOB_KEY);

        batchRouter.executeBatch(key, orders, signatures);
        assertEq(token1.balanceOf(address(wallet)), 50 * UNIT);
    }

    function test_rejectsHighSEoaSignature() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        bytes32 digest = hook.orderDigest(orders[0]);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_KEY, digest);
        signatures[0] = abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(InstitutionalNettingHook.InvalidSignature.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsWrongPoolAndTamperedAmount() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        orders[0].poolId = keccak256("wrong pool");
        signatures[0] = _sign(orders[0], ALICE_KEY);
        vm.expectRevert(InstitutionalNettingHook.InvalidOrder.selector);
        batchRouter.executeBatch(key, orders, signatures);

        (orders, signatures) = _orders100By70();
        orders[0].amountIn += 1;
        vm.expectRevert(InstitutionalNettingHook.InvalidSignature.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_cancelNonceAndReplayBothRevert() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        vm.prank(alice);
        hook.cancelNonce(orders[0].nonce);
        vm.expectRevert(InstitutionalNettingHook.NonceAlreadyUsed.selector);
        batchRouter.executeBatch(key, orders, signatures);

        (orders, signatures) = _orders100By70WithNonces(101, 102);
        batchRouter.executeBatch(key, orders, signatures);
        vm.expectRevert(InstitutionalNettingHook.NonceAlreadyUsed.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsInvalidCredentialAndWrongType() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        issuer.setValid(alice, false);
        vm.expectRevert(InstitutionalNettingHook.CredentialInvalid.selector);
        batchRouter.executeBatch(key, orders, signatures);

        issuer.setValid(alice, true);
        issuer.setCredentialType(alice, keccak256("wrong"));
        vm.expectRevert(InstitutionalNettingHook.CredentialTypeMismatch.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsRevokedAndExpiredCredential() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        issuer.setCredentialState(alice, type(uint64).max, true);
        vm.expectRevert(InstitutionalNettingHook.CredentialInvalid.selector);
        batchRouter.executeBatch(key, orders, signatures);

        issuer.setCredentialState(alice, uint64(block.timestamp), false);
        vm.expectRevert(InstitutionalNettingHook.CredentialInvalid.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_policyRotationInvalidatesOldEligibility() public {
        MockCNFIssuer replacement = new MockCNFIssuer();
        registry.proposePolicyUpdate(poolId, address(replacement), replacement.defaultCredentialType());
        vm.warp(block.timestamp + registry.POLICY_UPDATE_DELAY());
        registry.activatePolicyUpdate(poolId);
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70WithNonces(51, 52);
        vm.expectRevert(InstitutionalNettingHook.CredentialInvalid.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsWhenPolicyDisabled() public {
        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        registry.disablePolicy(poolId);
        vm.expectRevert(InstitutionalNettingHook.PolicyNotConfigured.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsSingleDirectionAndTooManyOrders() public {
        NettingTypes.NettingOrder[] memory sameDirection = new NettingTypes.NettingOrder[](2);
        sameDirection[0] = _order(alice, true, UNIT, 0, UNIT, bytes32(uint256(201)));
        sameDirection[1] = _order(bob, true, UNIT, 0, UNIT, bytes32(uint256(202)));
        bytes[] memory sameDirectionSignatures = _signOrders(sameDirection);
        vm.expectRevert(InstitutionalNettingHook.MissingOppositeDirection.selector);
        batchRouter.executeBatch(key, sameDirection, sameDirectionSignatures);

        NettingTypes.NettingOrder[] memory tooMany = new NettingTypes.NettingOrder[](17);
        bytes[] memory signatures = new bytes[](17);
        vm.expectRevert(InstitutionalBatchRouter.InvalidBatchSize.selector);
        batchRouter.executeBatch(key, tooMany, signatures);
    }

    function test_revertsDirectHookCalls() public {
        NettingTypes.BatchHeader memory emptyHeader;
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](0);
        bytes[] memory signatures = new bytes[](0);
        vm.expectRevert(InstitutionalNettingHook.OnlyBatchRouter.selector);
        hook.openBatch(emptyHeader, orders, signatures);
        vm.expectRevert(InstitutionalNettingHook.OnlyPoolManager.selector);
        hook.beforeSwap(address(this), key, _swapParams(), "");
    }

    function test_revertsAbovePegTick() public {
        bytes32 slot = keccak256(abi.encodePacked(poolId, bytes32(uint256(6))));
        bytes32 oldWord = vm.load(address(manager), slot);
        uint256 tickMask = uint256(0xFFFFFF) << 160;
        bytes32 newWord = bytes32((uint256(oldWord) & ~tickMask) | (uint256(uint24(101)) << 160));
        vm.store(address(manager), slot, newWord);

        (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) = _orders100By70();
        vm.expectRevert();
        batchRouter.executeBatch(key, orders, signatures);
    }

    function test_revertsAboveInt128InputBoundary() public {
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(
            alice,
            true,
            uint256(uint128(type(int128).max)) + 1,
            0,
            uint256(uint128(type(int128).max)) + 1,
            bytes32(uint256(61))
        );
        orders[1] = _order(bob, false, 1, 0, 0, bytes32(uint256(62)));
        bytes[] memory signatures = _signOrders(orders);
        vm.expectRevert(InstitutionalNettingHook.InvalidAmount.selector);
        batchRouter.executeBatch(key, orders, signatures);
    }

    function testGas_maximum16OrderBatch() public {
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](16);
        for (uint256 i; i < orders.length; ++i) {
            bool zeroForOne = i % 2 == 0;
            orders[i] = _order(zeroForOne ? alice : bob, zeroForOne, UNIT, UNIT, 0, bytes32(uint256(1_000 + i)));
        }
        bytes[] memory signatures = _signOrders(orders);
        uint256 gasBefore = gasleft();
        batchRouter.executeBatch(key, orders, signatures);
        uint256 gasUsed = gasBefore - gasleft();
        assertLt(gasUsed, 8_000_000);
    }

    function testBenchmark_100By25() public {
        _benchmarkTwoOrderFlow(25 * UNIT, 2_025, 2_026);
    }

    function testBenchmark_100By50() public {
        _benchmarkTwoOrderFlow(50 * UNIT, 2_050, 2_051);
    }

    function testBenchmark_100By70() public {
        _benchmarkTwoOrderFlow(70 * UNIT, 2_070, 2_071);
    }

    function testBenchmark_100By90() public {
        _benchmarkTwoOrderFlow(90 * UNIT, 2_090, 2_091);
    }

    function testBenchmark_100By100() public {
        _benchmarkTwoOrderFlow(100 * UNIT, 2_100, 2_101);
    }

    function testFuzz_previewAccounting(uint64 amount0, uint64 amount1) public view {
        amount0 = uint64(bound(amount0, 1, type(uint64).max));
        amount1 = uint64(bound(amount1, 1, type(uint64).max));
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(alice, true, amount0, 0, amount0, bytes32(uint256(301)));
        orders[1] = _order(bob, false, amount1, 0, amount1, bytes32(uint256(302)));
        NettingTypes.BatchHeader memory header = batchRouter.previewBatch(orders);
        assertEq(header.matchedEachSide * 2 + header.residual0 + header.residual1, uint256(amount0) + uint256(amount1));
        assertEq(header.matchedEachSide, amount0 < amount1 ? amount0 : amount1);
        assertTrue(header.residual0 == 0 || header.residual1 == 0);
    }

    function test_previewCommitment_matchesCliVector() public view {
        bytes32 cliPoolId = bytes32(uint256(0x2222222222222222222222222222222222222222222222222222222222222222));
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = NettingTypes.NettingOrder({
            user: 0x3333333333333333333333333333333333333333,
            poolId: cliPoolId,
            zeroForOne: true,
            amountIn: 100_000_000,
            minAmountOut: 0,
            maxAmmInput: 100_000_000,
            deadline: 4_000_000_000,
            nonce: bytes32(uint256(1))
        });
        orders[1] = NettingTypes.NettingOrder({
            user: 0x4444444444444444444444444444444444444444,
            poolId: cliPoolId,
            zeroForOne: false,
            amountIn: 70_000_000,
            minAmountOut: 0,
            maxAmmInput: 70_000_000,
            deadline: 4_000_000_000,
            nonce: bytes32(uint256(2))
        });
        assertEq(
            batchRouter.previewBatch(orders).batchId, 0x3279cb3136ff7a9bd6fdb9304478401b2e52b3efe9e1a78c9b8eb1464264e025
        );
    }

    function _orders100By70()
        internal
        view
        returns (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures)
    {
        return _orders100By70WithNonces(1, 2);
    }

    function _orders100By70WithNonces(uint256 nonce0, uint256 nonce1)
        internal
        view
        returns (NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures)
    {
        orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(alice, true, 100 * UNIT, 99 * UNIT, 30 * UNIT, bytes32(nonce0));
        orders[1] = _order(bob, false, 70 * UNIT, 70 * UNIT, 0, bytes32(nonce1));
        signatures = _signOrders(orders);
    }

    /// @dev Compares one atomic ILAL batch with two ordinary exact-input swaps
    /// from identical 1:1 pools. Both vanilla execution orders are measured so
    /// downstream reporting can use the better vanilla outcome.
    function _benchmarkTwoOrderFlow(uint256 opposingAmount, uint256 nonce0, uint256 nonce1) internal {
        NettingBenchmark memory result;
        result.opposingAmount = opposingAmount;
        result.gross = 100 * UNIT + opposingAmount;
        result.matchedGross = opposingAmount * 2;
        result.residual = 100 * UNIT - opposingAmount;

        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(alice, true, 100 * UNIT, 0, result.residual, bytes32(nonce0));
        orders[1] = _order(bob, false, opposingAmount, 0, 0, bytes32(nonce1));
        bytes[] memory signatures = _signOrders(orders);
        NettingTypes.BatchHeader memory header = batchRouter.previewBatch(orders);

        uint256 alice1Before = token1.balanceOf(alice);
        uint256 bob0Before = token0.balanceOf(bob);
        uint256 gasBefore = gasleft();
        batchRouter.executeBatch(key, orders, signatures);
        result.gasUsed = gasBefore - gasleft();
        result.output = token1.balanceOf(alice) - alice1Before + token0.balanceOf(bob) - bob0Before;
        (, result.endingTick,,) = manager.getSlot0(PoolId.wrap(poolId));
        result.lpFee = _exactInputLpFee(result.residual);
        result.zeroFirst = _runVanillaBenchmark(opposingAmount, true);
        result.oneFirst = _runVanillaBenchmark(opposingAmount, false);
        result.vanillaLpFee = _exactInputLpFee(100 * UNIT) + _exactInputLpFee(opposingAmount);
        uint256 bestVanillaOutput =
            result.zeroFirst.output > result.oneFirst.output ? result.zeroFirst.output : result.oneFirst.output;

        assertEq(header.total0, 100 * UNIT);
        assertEq(header.total1, opposingAmount);
        assertEq(header.matchedEachSide, opposingAmount);
        assertEq(header.residual0, result.residual);
        assertEq(header.residual1, 0);
        assertGt(result.output, bestVanillaOutput);
        assertLt(result.lpFee, result.vanillaLpFee);
        assertEq(token0.balanceOf(address(hook)), 0);
        assertEq(token1.balanceOf(address(hook)), 0);
        assertEq(token0.balanceOf(address(batchRouter)), 0);
        assertEq(token1.balanceOf(address(batchRouter)), 0);

        _logBenchmark(result);
    }

    function _runVanillaBenchmark(uint256 opposingAmount, bool zeroFirst)
        internal
        returns (VanillaBenchmark memory result)
    {
        VanillaPool memory vanilla = _deployVanillaPool();
        uint256 gasBefore = gasleft();
        BalanceDelta zeroForOneDelta;
        BalanceDelta oneForZeroDelta;
        if (zeroFirst) {
            zeroForOneDelta = _vanillaSwap(vanilla, true, 100 * UNIT);
            oneForZeroDelta = _vanillaSwap(vanilla, false, opposingAmount);
        } else {
            oneForZeroDelta = _vanillaSwap(vanilla, false, opposingAmount);
            zeroForOneDelta = _vanillaSwap(vanilla, true, 100 * UNIT);
        }
        result.gasUsed = gasBefore - gasleft();
        result.output = uint256(uint128(zeroForOneDelta.amount1())) + uint256(uint128(oneForZeroDelta.amount0()));
        (, result.endingTick,,) = vanilla.manager.getSlot0(vanilla.id);
    }

    function _logBenchmark(NettingBenchmark memory result) internal {
        string memory line = string.concat(
            "BENCHMARK|opposing=", vm.toString(result.opposingAmount), "|gross=", vm.toString(result.gross)
        );
        line = string.concat(
            line,
            "|matchedGross=",
            vm.toString(result.matchedGross),
            "|residual=",
            vm.toString(result.residual),
            "|nettingOutput=",
            vm.toString(result.output)
        );
        line = string.concat(
            line,
            "|nettingGas=",
            vm.toString(result.gasUsed),
            "|nettingTick=",
            vm.toString(int256(result.endingTick)),
            "|nettingLpFee=",
            vm.toString(result.lpFee)
        );
        line = string.concat(
            line,
            "|vanillaZeroFirstOutput=",
            vm.toString(result.zeroFirst.output),
            "|vanillaZeroFirstGas=",
            vm.toString(result.zeroFirst.gasUsed),
            "|vanillaZeroFirstTick=",
            vm.toString(int256(result.zeroFirst.endingTick))
        );
        line = string.concat(
            line,
            "|vanillaOneFirstOutput=",
            vm.toString(result.oneFirst.output),
            "|vanillaOneFirstGas=",
            vm.toString(result.oneFirst.gasUsed),
            "|vanillaOneFirstTick=",
            vm.toString(int256(result.oneFirst.endingTick)),
            "|vanillaLpFee=",
            vm.toString(result.vanillaLpFee)
        );
        emit log_string(line);
    }

    function _vanillaSwap(VanillaPool memory vanilla, bool zeroForOne, uint256 amountIn)
        internal
        returns (BalanceDelta)
    {
        return vanilla.swapRouter
            .swap(
                vanilla.key,
                SwapParams({
                    zeroForOne: zeroForOne,
                    amountSpecified: -int256(amountIn),
                    sqrtPriceLimitX96: zeroForOne ? 4295128740 : 1461446703485210103287273052203988822378723970341
                }),
                PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
                ""
            );
    }

    function _exactInputLpFee(uint256 amountIn) internal pure returns (uint256) {
        return amountIn - (amountIn * (1_000_000 - FEE) / 1_000_000);
    }

    function _order(
        address user,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 maxAmmInput,
        bytes32 nonce
    ) internal view returns (NettingTypes.NettingOrder memory) {
        return NettingTypes.NettingOrder({
            user: user,
            poolId: poolId,
            zeroForOne: zeroForOne,
            amountIn: uint128(amountIn),
            minAmountOut: uint128(minAmountOut),
            maxAmmInput: uint128(maxAmmInput),
            deadline: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
    }

    function _signOrders(NettingTypes.NettingOrder[] memory orders) internal view returns (bytes[] memory signatures) {
        signatures = new bytes[](orders.length);
        for (uint256 i; i < orders.length; ++i) {
            uint256 privateKey = orders[i].user == alice ? ALICE_KEY : orders[i].user == bob ? BOB_KEY : CAROL_KEY;
            signatures[i] = _sign(orders[i], privateKey);
        }
    }

    function _reverseOrderPairs(NettingTypes.NettingOrder[] memory orders, bytes[] memory signatures) internal pure {
        uint256 length = orders.length;
        for (uint256 i; i < length / 2; ++i) {
            uint256 opposite = length - 1 - i;
            (orders[i], orders[opposite]) = (orders[opposite], orders[i]);
            (signatures[i], signatures[opposite]) = (signatures[opposite], signatures[i]);
        }
    }

    function _sign(NettingTypes.NettingOrder memory order, uint256 privateKey) internal view returns (bytes memory) {
        bytes32 digest = hook.orderDigest(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _fundAndApprove(address user, MockERC20 token, uint256 amount) internal {
        token.mint(user, amount);
        vm.prank(user);
        token.approve(address(batchRouter), type(uint256).max);
    }

    function _deployVanillaPool() internal returns (VanillaPool memory vanilla) {
        vanilla.manager = new PoolManager(address(this));
        PoolModifyLiquidityTest vanillaLiquidityRouter = new PoolModifyLiquidityTest(vanilla.manager);
        vanilla.swapRouter = new PoolSwapTest(vanilla.manager);
        vanilla.key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(0))
        });
        vanilla.id = vanilla.key.toId();
        vanilla.manager.initialize(vanilla.key, SQRT_PRICE_1_1);
        token0.approve(address(vanillaLiquidityRouter), type(uint256).max);
        token1.approve(address(vanillaLiquidityRouter), type(uint256).max);
        vanillaLiquidityRouter.modifyLiquidity(
            vanilla.key,
            ModifyLiquidityParams({
                tickLower: -1000, tickUpper: 1000, liquidityDelta: int256(uint256(TEST_LIQUIDITY)), salt: bytes32(0)
            }),
            ""
        );
        token0.approve(address(vanilla.swapRouter), type(uint256).max);
        token1.approve(address(vanilla.swapRouter), type(uint256).max);
    }

    function _assertPoolStatesEqual(
        IPoolManager nettingManager,
        PoolId nettingId,
        IPoolManager vanillaManager,
        PoolId vanillaId
    ) internal view {
        (uint160 nettingSqrtPrice, int24 nettingTick, uint24 nettingProtocolFee, uint24 nettingLpFee) =
            nettingManager.getSlot0(nettingId);
        (uint160 vanillaSqrtPrice, int24 vanillaTick, uint24 vanillaProtocolFee, uint24 vanillaLpFee) =
            vanillaManager.getSlot0(vanillaId);
        assertEq(nettingSqrtPrice, vanillaSqrtPrice);
        assertEq(nettingTick, vanillaTick);
        assertEq(nettingProtocolFee, vanillaProtocolFee);
        assertEq(nettingLpFee, vanillaLpFee);
        assertEq(nettingManager.getLiquidity(nettingId), vanillaManager.getLiquidity(vanillaId));
        (uint256 nettingFeeGrowth0, uint256 nettingFeeGrowth1) = nettingManager.getFeeGrowthGlobals(nettingId);
        (uint256 vanillaFeeGrowth0, uint256 vanillaFeeGrowth1) = vanillaManager.getFeeGrowthGlobals(vanillaId);
        assertEq(nettingFeeGrowth0, vanillaFeeGrowth0);
        assertEq(nettingFeeGrowth1, vanillaFeeGrowth1);
    }

    function _swapParams() internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 4295128740});
    }
}
