// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {ILALRouter} from "../src/ILALRouter.sol";
import {SessionLib} from "../src/libraries/SessionLib.sol";
import {MockPoolManager} from "./mocks/MockPoolManager.sol";

contract ILALRouterTest is Test {
    using PoolIdLibrary for PoolKey;

    ILALRouter internal router;
    MockPoolManager internal mockPM;
    MockERC20 internal token0;
    MockERC20 internal token1;

    address internal treasury = makeAddr("treasury");
    address internal trader = makeAddr("trader");

    PoolKey internal erc20Key;
    PoolKey internal nativeKey;

    /// @dev Protocol fee is 50 pips = 0.005% of amountIn
    uint24 internal constant PROTOCOL_FEE_PIPS = 50;

    struct MockSessionV2 {
        address user;
        address authorizedCaller;
        uint256 policyHash;
        uint64 policyRevision;
        uint256 chainId;
        address verifyingHook;
        bytes32 poolId;
        uint8 action;
        uint64 deadline;
        bytes32 nonce;
    }

    function setUp() public {
        mockPM = new MockPoolManager();
        router = new ILALRouter(IPoolManager(address(mockPM)), treasury, PROTOCOL_FEE_PIPS);

        token0 = new MockERC20();
        token0.initialize("Token0", "T0", 18);
        token1 = new MockERC20();
        token1.initialize("Token1", "T1", 18);

        // Ensure token0 < token1 by address (Uniswap ordering requirement)
        if (address(token0) > address(token1)) {
            (token0, token1) = (token1, token0);
        }

        erc20Key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        nativeKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
    }

    // ─── hookData helpers ─────────────────────────────────────────────────────

    /// @dev Build minimal hookData that passes _verifySessionBinding.
    ///      The router only checks user == msg.sender and authorizedCaller == router.
    ///      The real signature check lives in ComplianceHook, which is bypassed here.
    function _buildHookData(address user) internal view returns (bytes memory) {
        SessionLib.SessionToken memory token = SessionLib.SessionToken({
            user: user,
            authorizedCaller: address(router),
            cnfIssuer: address(0xBEEF),
            chainId: block.chainid,
            verifyingHook: address(0xCAFE),
            poolId: bytes32(0),
            action: SessionLib.ACTION_SWAP,
            deadline: uint64(type(uint64).max),
            nonce: bytes32(0)
        });
        // Fake 65-byte signature (not verified by router — ComplianceHook handles that)
        bytes memory sig = new bytes(65);
        return abi.encode(token, sig);
    }

    function _buildV2HookData(address user) internal view returns (bytes memory) {
        MockSessionV2 memory token = MockSessionV2({
            user: user,
            authorizedCaller: address(router),
            policyHash: 55,
            policyRevision: 1,
            chainId: block.chainid,
            verifyingHook: address(0xCAFE),
            poolId: bytes32(0),
            action: 1,
            deadline: uint64(type(uint64).max),
            nonce: bytes32(0)
        });
        return abi.encode(token, new bytes(65));
    }

    function test_swap_revertsOnNativeCurrency() public {
        vm.expectRevert(ILALRouter.NativeNotSupported.selector);
        router.swap(nativeKey, SwapParams(true, -1, 4295128740), 0, "");
    }

    function test_swap_revertsOnUnexpectedEth() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(ILALRouter.NativeNotSupported.selector);
        router.swap{value: 1 wei}(erc20Key, SwapParams(true, -1, 4295128740), 0, "");
    }

    function test_receive_revertsOnDirectEth() public {
        vm.deal(address(this), 1 ether);
        (bool success, bytes memory data) = address(router).call{value: 1 wei}("");
        assertFalse(success);
        assertEq(bytes4(data), ILALRouter.NativeNotSupported.selector);
    }

    function test_constructor_revertsOnZeroTreasury() public {
        vm.expectRevert(ILALRouter.InvalidTreasury.selector);
        new ILALRouter(IPoolManager(makeAddr("poolManager")), address(0), 50);
    }

    function test_constructor_revertsOnProtocolFeeTooHigh() public {
        vm.expectRevert(ILALRouter.ProtocolFeeTooHigh.selector);
        new ILALRouter(IPoolManager(makeAddr("poolManager")), makeAddr("treasury"), 1001);
    }

    function test_quoteProtocolFee_exactInput() public view {
        // zeroForOne=false → tokenIn is currency1
        (address tokenIn, uint256 feeAmount) =
            router.quoteProtocolFee(erc20Key, SwapParams(false, -100 ether, 4295128740));

        assertEq(tokenIn, address(token1));
        // 100e18 * 50 pips / 1_000_000 = 0.005e18
        assertEq(feeAmount, 0.005 ether);
    }

    function test_quoteProtocolFee_revertsOnExactOutput() public {
        vm.expectRevert(ILALRouter.ExactOutputNotSupported.selector);
        router.quoteProtocolFee(erc20Key, SwapParams(false, 100 ether, 4295128740));
    }

    function test_addLiquidity_revertsOnNativeCurrency() public {
        vm.expectRevert(ILALRouter.NativeNotSupported.selector);
        router.addLiquidity(
            nativeKey,
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1, salt: bytes32(0)}),
            0,
            0,
            ""
        );
    }

    function test_removeLiquidity_revertsOnNativeCurrency() public {
        vm.expectRevert(ILALRouter.NativeNotSupported.selector);
        router.removeLiquidity(
            nativeKey,
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: -1, salt: bytes32(0)}),
            0,
            0,
            ""
        );
    }

    function test_addLiquidity_revertsOnNonPositiveDelta() public {
        bytes memory hookData = _buildHookData(trader);
        vm.prank(trader);
        vm.expectRevert(ILALRouter.InvalidLiquidityDelta.selector);
        router.addLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, -1, bytes32(0)), 0, 0, hookData);
    }

    function test_removeLiquidity_revertsOnNonNegativeDelta() public {
        bytes memory hookData = _buildHookData(trader);
        vm.prank(trader);
        vm.expectRevert(ILALRouter.InvalidLiquidityDelta.selector);
        router.removeLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, 1, bytes32(0)), 0, 0, hookData);
    }

    function test_liquiditySalt_isScopedToCaller() public {
        bytes32 userSalt = keccak256("shared-public-salt");
        ModifyLiquidityParams memory params = ModifyLiquidityParams(-60, 60, 1 ether, userSalt);

        vm.prank(trader);
        router.addLiquidity(erc20Key, params, 0, 0, _buildHookData(trader));
        bytes32 traderPositionSalt = mockPM.lastSalt();
        assertEq(traderPositionSalt, router.positionSalt(trader, userSalt));

        address otherTrader = makeAddr("otherTrader");
        vm.prank(otherTrader);
        router.addLiquidity(erc20Key, params, 0, 0, _buildHookData(otherTrader));
        bytes32 otherPositionSalt = mockPM.lastSalt();

        assertEq(otherPositionSalt, router.positionSalt(otherTrader, userSalt));
        assertNotEq(traderPositionSalt, otherPositionSalt);
    }

    function test_removeLiquidity_usesSameCallerScopedSaltAsAdd() public {
        bytes32 userSalt = keccak256("position-one");
        vm.prank(trader);
        router.addLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, userSalt), 0, 0, _buildHookData(trader));
        bytes32 addSalt = mockPM.lastSalt();

        vm.prank(trader);
        router.removeLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, -1 ether, userSalt), 0, 0, _buildHookData(trader)
        );

        assertEq(mockPM.lastSalt(), addSalt);
    }

    function test_compliantCallerCannotRemoveAnotherUsersPosition() public {
        bytes32 copiedPublicSalt = keccak256("public-position-salt");
        vm.prank(trader);
        router.addLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, copiedPublicSalt), 0, 0, _buildHookData(trader)
        );

        address attacker = makeAddr("compliantAttacker");
        vm.prank(attacker);
        vm.expectRevert(MockPoolManager.InsufficientPositionLiquidity.selector);
        router.removeLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, -1 ether, copiedPublicSalt), 0, 0, _buildHookData(attacker)
        );
    }

    function test_addLiquidity_reverts_whenCurrency0SpendExceedsMaximum() public {
        mockPM.setLiquidityResult(-int128(10 ether), -int128(20 ether));

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILALRouter.LiquiditySpendExceeded.selector, address(token0), uint256(10 ether), uint256(9 ether)
            )
        );
        router.addLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 9 ether, 20 ether, _buildHookData(trader)
        );
    }

    function test_addLiquidity_reverts_whenCurrency1SpendExceedsMaximum() public {
        mockPM.setLiquidityResult(-int128(10 ether), -int128(20 ether));

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILALRouter.LiquiditySpendExceeded.selector, address(token1), uint256(20 ether), uint256(19 ether)
            )
        );
        router.addLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 10 ether, 19 ether, _buildHookData(trader)
        );
    }

    function test_addLiquidity_handlesMinInt128DeltaWithoutOverflow() public {
        mockPM.setLiquidityResult(type(int128).min, 0);
        uint256 absoluteMinInt128 = uint256(1) << 127;

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILALRouter.LiquiditySpendExceeded.selector, address(token0), absoluteMinInt128, uint256(0)
            )
        );
        router.addLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 0, 0, _buildHookData(trader));
    }

    function test_addLiquidity_passes_whenSpendMeetsMaximums() public {
        mockPM.setLiquidityResult(-int128(10 ether), -int128(20 ether));
        deal(address(token0), trader, 10 ether);
        deal(address(token1), trader, 20 ether);
        vm.startPrank(trader);
        token0.approve(address(router), 10 ether);
        token1.approve(address(router), 20 ether);
        router.addLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 10 ether, 20 ether, _buildHookData(trader)
        );
        vm.stopPrank();

        assertEq(token0.balanceOf(trader), 0);
        assertEq(token1.balanceOf(trader), 0);
    }

    function test_removeLiquidity_reverts_whenCurrency1OutputBelowMinimum() public {
        vm.prank(trader);
        router.addLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 0, 0, _buildHookData(trader));
        mockPM.setLiquidityResult(int128(10 ether), int128(20 ether));

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILALRouter.LiquidityOutputTooLow.selector, address(token1), uint256(20 ether), uint256(21 ether)
            )
        );
        router.removeLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, -1 ether, bytes32(0)), 10 ether, 21 ether, _buildHookData(trader)
        );
    }

    function test_removeLiquidity_reverts_whenCurrency0OutputBelowMinimum() public {
        vm.prank(trader);
        router.addLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 0, 0, _buildHookData(trader));
        mockPM.setLiquidityResult(int128(10 ether), int128(20 ether));

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(
                ILALRouter.LiquidityOutputTooLow.selector, address(token0), uint256(10 ether), uint256(11 ether)
            )
        );
        router.removeLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, -1 ether, bytes32(0)), 11 ether, 20 ether, _buildHookData(trader)
        );
    }

    function test_removeLiquidity_passes_whenOutputsMeetMinimums() public {
        vm.prank(trader);
        router.addLiquidity(erc20Key, ModifyLiquidityParams(-60, 60, 1 ether, bytes32(0)), 0, 0, _buildHookData(trader));
        mockPM.setLiquidityResult(int128(10 ether), int128(20 ether));
        deal(address(token0), address(mockPM), 10 ether);
        deal(address(token1), address(mockPM), 20 ether);

        vm.prank(trader);
        router.removeLiquidity(
            erc20Key, ModifyLiquidityParams(-60, 60, -1 ether, bytes32(0)), 10 ether, 20 ether, _buildHookData(trader)
        );

        assertEq(token0.balanceOf(trader), 10 ether);
        assertEq(token1.balanceOf(trader), 20 ether);
    }

    // ─── Happy path (mock PoolManager integration) ────────────────────────────

    function test_swap_happyPath_zeroForOne() public {
        // Amounts: swap 100e18 token0 → 95e18 token1
        int128 amountIn = -int128(100 ether); // negative = pool receives token0
        int128 amountOut = int128(95 ether); // positive = pool sends token1
        mockPM.setSwapResult(amountIn, amountOut); // delta(amount0=amountIn, amount1=amountOut)

        // Protocol fee = 100e18 * 50 / 1_000_000 = 5e15
        uint256 feeAmount = uint256(100 ether) * PROTOCOL_FEE_PIPS / 1_000_000;

        // Fund trader with token0 (for protocol fee + swap input)
        deal(address(token0), trader, 100 ether + feeAmount);
        // Fund mockPM with token1 so it can `take` (send to trader)
        deal(address(token1), address(mockPM), 95 ether);

        // Approve router for swap settlement plus the post-settlement protocol fee.
        vm.prank(trader);
        token0.approve(address(router), 100 ether + feeAmount);
        // Also approve router for swap input (settled inside unlockCallback)
        // The router calls transferFrom(trader, poolManager, amountIn)
        // via _settle — it needs to be approved even for the inner call
        // (note: router calls _safeTransferFrom in _settle — approval is on the router address)

        bytes memory hookData = _buildHookData(trader);
        SwapParams memory params = SwapParams({
            zeroForOne: true,
            amountSpecified: -int256(100 ether), // exact input
            sqrtPriceLimitX96: 4295128740
        });

        vm.prank(trader);
        BalanceDelta delta = router.swap(erc20Key, params, 0, hookData);

        // Verify delta returned correctly
        assertEq(delta.amount0(), amountIn, "amount0 mismatch");
        assertEq(delta.amount1(), amountOut, "amount1 mismatch");

        // Treasury received protocol fee in token0
        assertEq(token0.balanceOf(treasury), feeAmount, "treasury fee mismatch");

        // Trader received token1 output
        assertEq(token1.balanceOf(trader), 95 ether, "trader output mismatch");
    }

    function test_swap_protocolFeeUsesActualInputOnPartialFill() public {
        // User requests up to 100 tokens, but the price limit permits only 40 to execute.
        mockPM.setSwapResult(-int128(40 ether), int128(38 ether));
        uint256 actualFee = uint256(40 ether) * PROTOCOL_FEE_PIPS / 1_000_000;
        uint256 requestedFee = uint256(100 ether) * PROTOCOL_FEE_PIPS / 1_000_000;

        deal(address(token0), trader, 40 ether + actualFee);
        deal(address(token1), address(mockPM), 38 ether);
        vm.prank(trader);
        token0.approve(address(router), 40 ether + actualFee);

        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: 4295128740});

        vm.prank(trader);
        router.swap(erc20Key, params, 0, _buildHookData(trader));

        assertEq(token0.balanceOf(treasury), actualFee);
        assertLt(token0.balanceOf(treasury), requestedFee);
        assertEq(token0.balanceOf(trader), 0);
    }

    function test_swap_emitsSwapExecuted() public {
        mockPM.setSwapResult(-int128(100 ether), int128(95 ether));
        deal(address(token0), trader, 200 ether);
        deal(address(token1), address(mockPM), 95 ether);
        vm.prank(trader);
        token0.approve(address(router), 200 ether);

        bytes memory hookData = _buildHookData(trader);
        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: 4295128740});

        bytes32 expectedPoolId = PoolId.unwrap(erc20Key.toId());
        vm.expectEmit(true, true, false, false);
        emit ILALRouter.SwapExecuted(expectedPoolId, trader, address(token0), address(token1), 0, 0);

        vm.prank(trader);
        router.swap(erc20Key, params, 0, hookData);
    }

    // ─── Slippage protection ─────────────────────────────────────────────────

    function test_swap_slippage_passes_whenOutputMeetsMin() public {
        // Output = 95e18, minAmountOut = 95e18 — should pass
        mockPM.setSwapResult(-int128(100 ether), int128(95 ether));
        deal(address(token0), trader, 200 ether);
        deal(address(token1), address(mockPM), 95 ether);
        vm.prank(trader);
        token0.approve(address(router), 200 ether);

        bytes memory hookData = _buildHookData(trader);
        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: 4295128740});

        vm.prank(trader);
        BalanceDelta delta = router.swap(erc20Key, params, 95 ether, hookData);
        assertEq(delta.amount1(), int128(95 ether));
    }

    function test_swap_slippage_reverts_whenOutputBelowMin() public {
        // Output = 80e18, minAmountOut = 95e18 — should revert
        mockPM.setSwapResult(-int128(100 ether), int128(80 ether));
        deal(address(token0), trader, 200 ether);
        deal(address(token1), address(mockPM), 80 ether);
        vm.prank(trader);
        token0.approve(address(router), 200 ether);

        bytes memory hookData = _buildHookData(trader);
        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: 4295128740});

        vm.prank(trader);
        vm.expectRevert(
            abi.encodeWithSelector(ILALRouter.SlippageTooHigh.selector, uint256(80 ether), uint256(95 ether))
        );
        router.swap(erc20Key, params, 95 ether, hookData);
    }

    function test_swap_slippage_disabled_whenMinZero() public {
        // minAmountOut = 0 → no check, any output accepted
        mockPM.setSwapResult(-int128(100 ether), int128(1));
        deal(address(token0), trader, 200 ether);
        deal(address(token1), address(mockPM), 1);
        vm.prank(trader);
        token0.approve(address(router), 200 ether);

        bytes memory hookData = _buildHookData(trader);
        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: 4295128740});

        vm.prank(trader);
        // Should NOT revert even though output (1 wei) is tiny
        BalanceDelta delta = router.swap(erc20Key, params, 0, hookData);
        assertEq(delta.amount1(), int128(1));
    }

    // ─── Session binding checks ───────────────────────────────────────────────

    function test_swap_reverts_sessionUserMismatch() public {
        // Build hookData for alice but call from bob
        address alice = makeAddr("alice");
        bytes memory hookData = _buildHookData(alice);

        SwapParams memory params =
            SwapParams({zeroForOne: true, amountSpecified: -int256(100 ether), sqrtPriceLimitX96: 4295128740});

        vm.prank(makeAddr("bob"));
        vm.expectRevert(ILALRouter.SessionUserMismatch.selector);
        router.swap(erc20Key, params, 0, hookData);
    }

    function test_swap_acceptsVersionedSessionPrefix() public {
        mockPM.setSwapResult(-int128(1 ether), int128(1 ether));
        uint256 feeAmount = uint256(1 ether) * PROTOCOL_FEE_PIPS / 1_000_000;
        deal(address(token0), trader, 1 ether + feeAmount);
        deal(address(token1), address(mockPM), 1 ether);
        vm.prank(trader);
        token0.approve(address(router), 1 ether + feeAmount);

        vm.prank(trader);
        BalanceDelta delta = router.swap(
            erc20Key,
            SwapParams({zeroForOne: true, amountSpecified: -int256(1 ether), sqrtPriceLimitX96: 4295128740}),
            1 ether,
            _buildV2HookData(trader)
        );
        assertEq(delta.amount1(), int128(1 ether));
    }

    function test_swap_reverts_shortHookData() public {
        vm.prank(trader);
        vm.expectRevert(ILALRouter.InvalidHookData.selector);
        router.swap(erc20Key, SwapParams(true, -1, 4295128740), 0, hex"1234");
    }

    function test_swap_reverts_nonCanonicalAddressWord() public {
        bytes memory hookData = new bytes(64);
        uint256 nonCanonicalUser = uint256(1) << 160;
        address routerAddress = address(router);
        assembly {
            mstore(add(hookData, 32), nonCanonicalUser)
            mstore(add(hookData, 64), routerAddress)
        }

        vm.prank(trader);
        vm.expectRevert(ILALRouter.InvalidHookData.selector);
        router.swap(erc20Key, SwapParams(true, -1, 4295128740), 0, hookData);
    }
}
