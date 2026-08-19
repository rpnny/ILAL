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
            key, ModifyLiquidityParams({tickLower: -1000, tickUpper: 1000, liquidityDelta: 1e20, salt: bytes32(0)}), ""
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

    function test_multipleOrders_allocateMatchInArrayOrder() public {
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](3);
        orders[0] = _order(alice, true, 40 * UNIT, 40 * UNIT, 0, bytes32(uint256(5)));
        orders[1] = _order(bob, false, 70 * UNIT, 69 * UNIT, 30 * UNIT, bytes32(uint256(6)));
        orders[2] = _order(alice, true, 60 * UNIT, 59 * UNIT, 30 * UNIT, bytes32(uint256(7)));
        NettingTypes.BatchHeader memory preview = batchRouter.previewBatch(orders);
        assertEq(preview.matchedEachSide, 70 * UNIT);
        assertEq(preview.residual0, 30 * UNIT);
        batchRouter.executeBatch(key, orders, _signOrders(orders));
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

    function testFuzz_previewAccounting(uint64 amount0, uint64 amount1) public view {
        amount0 = uint64(bound(amount0, 1, type(uint64).max));
        amount1 = uint64(bound(amount1, 1, type(uint64).max));
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](2);
        orders[0] = _order(alice, true, amount0, 0, amount0, bytes32(uint256(301)));
        orders[1] = _order(bob, false, amount1, 0, amount1, bytes32(uint256(302)));
        NettingTypes.BatchHeader memory header = batchRouter.previewBatch(orders);
        assertEq(header.matchedEachSide * 2 + header.residual0 + header.residual1, uint256(amount0) + uint256(amount1));
        assertEq(header.matchedEachSide, amount0 < amount1 ? amount0 : amount1);
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
            signatures[i] = _sign(orders[i], orders[i].user == alice ? ALICE_KEY : BOB_KEY);
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

    function _swapParams() internal pure returns (SwapParams memory) {
        return SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 4295128740});
    }
}
