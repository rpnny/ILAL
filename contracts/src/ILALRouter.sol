// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";

/// @title ILALRouter
/// @notice Routes compliant swaps and liquidity operations through Uniswap v4.
///
/// Every call includes a `hookData` blob (ILAL session token + signature) that
/// the ComplianceHook verifies.  Callers must:
///   1. Approve this contract to spend the input token.
///   2. Sign a SessionToken off-chain (or use `ilal swap / ilal pool add-liquidity`).
///   3. Call `swap()` or `addLiquidity()`.
///
/// Settlement pattern (v4 unlock pattern):
///   For ERC-20: sync(currency) → transferFrom(payer → poolManager) → settle()
///   For native: settle{value}()
///   To receive: take(currency, recipient, amount)
contract ILALRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    // ─── Errors ───────────────────────────────────────────────────────────────

    error OnlyPoolManager();
    error NativeNotSupported();
    error ERC20TransferFailed();
    error SessionUserMismatch();
    error SessionCallerMismatch();
    error InvalidHookData();
    error InvalidTreasury();
    error ProtocolFeeTooHigh();
    error ExactOutputNotSupported();
    error SlippageTooHigh(uint256 amountOut, uint256 minAmountOut);
    error InvalidLiquidityDelta();
    error LiquiditySpendExceeded(address token, uint256 amount, uint256 maximum);
    error LiquidityOutputTooLow(address token, uint256 amount, uint256 minimum);

    // ─── Immutables ───────────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;
    address public immutable treasury;
    uint24 public immutable protocolFeePips;

    uint24 public constant PIPS_DENOMINATOR = 1_000_000;
    uint24 public constant MAX_PROTOCOL_FEE_PIPS = 1_000; // 0.10%

    event ProtocolFeePaid(address indexed payer, address indexed token, address indexed treasury, uint256 amount);
    event SwapExecuted(
        bytes32 indexed poolId,
        address indexed user,
        address tokenIn,
        address tokenOut,
        int128 amountIn,
        int128 amountOut
    );

    // ─── Callback data structs ────────────────────────────────────────────────

    enum CallType {
        Swap,
        AddLiquidity,
        RemoveLiquidity
    }

    struct CallbackData {
        CallType callType;
        address sender;
        PoolKey key;
        // swap
        SwapParams swapParams;
        uint256 minAmountOut; // 0 = no slippage protection
        // liquidity
        ModifyLiquidityParams liquidityParams;
        uint256 amount0Limit; // max spend on add; min receive on remove
        uint256 amount1Limit; // max spend on add; min receive on remove
        bytes hookData;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(IPoolManager _poolManager, address _treasury, uint24 _protocolFeePips) {
        if (_treasury == address(0)) revert InvalidTreasury();
        if (_protocolFeePips > MAX_PROTOCOL_FEE_PIPS) revert ProtocolFeeTooHigh();
        poolManager = _poolManager;
        treasury = _treasury;
        protocolFeePips = _protocolFeePips;
    }

    // ─── External entry points ────────────────────────────────────────────────

    /// @notice Execute a compliant swap.
    /// @param key          The pool to swap in.
    /// @param params       Swap parameters (zeroForOne, amountSpecified, sqrtPriceLimitX96).
    /// @param minAmountOut Minimum output token amount the caller will accept. Pass 0 to skip.
    ///                     Reverts with SlippageTooHigh if the actual output is less.
    /// @param hookData     Encoded (SessionToken, bytes signature) — created by `ilal swap`.
    /// @return delta       The signed balance change (negative = paid, positive = received).
    function swap(PoolKey calldata key, SwapParams calldata params, uint256 minAmountOut, bytes calldata hookData)
        external
        payable
        returns (BalanceDelta delta)
    {
        _ensureERC20Pool(key);
        _verifySessionBinding(hookData);
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    callType: CallType.Swap,
                    sender: msg.sender,
                    key: key,
                    swapParams: params,
                    minAmountOut: minAmountOut,
                    liquidityParams: ModifyLiquidityParams({
                        tickLower: 0, tickUpper: 0, liquidityDelta: 0, salt: bytes32(0)
                    }),
                    amount0Limit: 0,
                    amount1Limit: 0,
                    hookData: hookData
                })
            )
        );
        delta = abi.decode(result, (BalanceDelta));
        (address tokenIn, address tokenOut, int128 amountIn, int128 amountOut) = _swapAmounts(key, params, delta);
        _collectProtocolFee(tokenIn, uint256(int256(amountIn)), msg.sender);
        emit SwapExecuted(PoolId.unwrap(key.toId()), msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /// @notice Add liquidity to a compliant pool.
    /// @param key       The pool.
    /// @param params    Position parameters. The supplied salt is scoped to msg.sender on-chain.
    /// @param maxAmount0 Maximum currency0 the caller permits the position to spend.
    /// @param maxAmount1 Maximum currency1 the caller permits the position to spend.
    /// @param hookData   Encoded (SessionToken, bytes signature) — created by `ilal pool add-liquidity`.
    /// @return callerDelta  Balance delta for the caller (tokens paid/received).
    /// @return feesAccrued  Fees collected from existing position (if any).
    function addLiquidity(
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        uint256 maxAmount0,
        uint256 maxAmount1,
        bytes calldata hookData
    ) external payable returns (BalanceDelta callerDelta, BalanceDelta feesAccrued) {
        _ensureERC20Pool(key);
        if (params.liquidityDelta <= 0) revert InvalidLiquidityDelta();
        _verifySessionBinding(hookData);
        ModifyLiquidityParams memory scopedParams = _scopeLiquidityParams(params, msg.sender);
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    callType: CallType.AddLiquidity,
                    sender: msg.sender,
                    key: key,
                    swapParams: SwapParams({zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0}),
                    minAmountOut: 0, // N/A for liquidity operations
                    liquidityParams: scopedParams,
                    amount0Limit: maxAmount0,
                    amount1Limit: maxAmount1,
                    hookData: hookData
                })
            )
        );
        (callerDelta, feesAccrued) = abi.decode(result, (BalanceDelta, BalanceDelta));
    }

    /// @notice Remove liquidity from a compliant pool.
    /// @param key       The pool.
    /// @param params    Position parameters. Delta must be negative; salt is scoped to msg.sender.
    /// @param minAmount0 Minimum currency0 the caller must receive.
    /// @param minAmount1 Minimum currency1 the caller must receive.
    /// @param hookData   Encoded (SessionToken, bytes signature).
    /// @return callerDelta  Balance delta for the caller.
    /// @return feesAccrued  Fees collected.
    function removeLiquidity(
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        uint256 minAmount0,
        uint256 minAmount1,
        bytes calldata hookData
    ) external returns (BalanceDelta callerDelta, BalanceDelta feesAccrued) {
        if (key.currency0.isAddressZero() || key.currency1.isAddressZero()) {
            revert NativeNotSupported();
        }
        if (params.liquidityDelta >= 0) revert InvalidLiquidityDelta();
        _verifySessionBinding(hookData);
        ModifyLiquidityParams memory scopedParams = _scopeLiquidityParams(params, msg.sender);
        bytes memory result = poolManager.unlock(
            abi.encode(
                CallbackData({
                    callType: CallType.RemoveLiquidity,
                    sender: msg.sender,
                    key: key,
                    swapParams: SwapParams({zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0}),
                    minAmountOut: 0, // N/A for liquidity operations
                    liquidityParams: scopedParams,
                    amount0Limit: minAmount0,
                    amount1Limit: minAmount1,
                    hookData: hookData
                })
            )
        );
        (callerDelta, feesAccrued) = abi.decode(result, (BalanceDelta, BalanceDelta));
    }

    // ─── IUnlockCallback ──────────────────────────────────────────────────────

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();

        CallbackData memory d = abi.decode(rawData, (CallbackData));

        if (d.callType == CallType.Swap) {
            BalanceDelta delta = poolManager.swap(d.key, d.swapParams, d.hookData);
            // Slippage guard: the output side of the delta is the positive amount.
            // For zeroForOne: output = delta.amount1(); for oneForZero: output = delta.amount0().
            if (d.minAmountOut > 0) {
                uint256 actualOut =
                    d.swapParams.zeroForOne ? uint256(int256(delta.amount1())) : uint256(int256(delta.amount0()));
                if (actualOut < d.minAmountOut) revert SlippageTooHigh(actualOut, d.minAmountOut);
            }
            _settle(d.key.currency0, d.sender, delta.amount0());
            _settle(d.key.currency1, d.sender, delta.amount1());
            return abi.encode(delta);
        } else {
            // AddLiquidity or RemoveLiquidity
            (BalanceDelta callerDelta, BalanceDelta feesAccrued) =
                poolManager.modifyLiquidity(d.key, d.liquidityParams, d.hookData);
            if (d.callType == CallType.AddLiquidity) {
                _enforceLiquiditySpendLimits(d.key, callerDelta, d.amount0Limit, d.amount1Limit);
            } else {
                _enforceLiquidityOutputLimits(d.key, callerDelta, d.amount0Limit, d.amount1Limit);
            }
            _settle(d.key.currency0, d.sender, callerDelta.amount0());
            _settle(d.key.currency1, d.sender, callerDelta.amount1());
            return abi.encode(callerDelta, feesAccrued);
        }
    }

    // ─── Internal settlement ──────────────────────────────────────────────────

    function _ensureERC20Pool(PoolKey calldata key) internal {
        if (msg.value != 0 || key.currency0.isAddressZero() || key.currency1.isAddressZero()) {
            revert NativeNotSupported();
        }
    }

    function _verifySessionBinding(bytes calldata hookData) internal view {
        // Every ILAL session version starts with the same two ABI words:
        // user and authorizedCaller. Reading only this stable prefix lets one
        // Router serve versioned Hooks without weakening the two bindings the
        // Router is responsible for. The selected Hook decodes and validates
        // the complete version-specific token before any pool state changes.
        if (hookData.length < 64) revert InvalidHookData();
        uint256 userWord;
        uint256 callerWord;
        assembly {
            userWord := calldataload(hookData.offset)
            callerWord := calldataload(add(hookData.offset, 32))
        }
        if (userWord > type(uint160).max || callerWord > type(uint160).max) revert InvalidHookData();
        if (address(uint160(userWord)) != msg.sender) revert SessionUserMismatch();
        if (address(uint160(callerWord)) != address(this)) revert SessionCallerMismatch();
    }

    /// @notice Returns the PoolManager salt used for a user's ILAL position.
    /// @dev PoolManager sees this router as the position owner for every user. Binding
    ///      the user into the salt prevents one compliant caller from modifying another
    ///      caller's position by copying its public ticks and user-provided salt.
    function positionSalt(address user, bytes32 userSalt) public pure returns (bytes32) {
        return keccak256(abi.encode(user, userSalt));
    }

    function _scopeLiquidityParams(ModifyLiquidityParams calldata params, address user)
        internal
        pure
        returns (ModifyLiquidityParams memory scoped)
    {
        scoped = ModifyLiquidityParams({
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidityDelta: params.liquidityDelta,
            salt: positionSalt(user, params.salt)
        });
    }

    function quoteProtocolFee(PoolKey calldata key, SwapParams calldata params)
        external
        view
        returns (address tokenIn, uint256 feeAmount)
    {
        return _quoteProtocolFee(key, params);
    }

    /// @dev Charges the fee on the input actually consumed by PoolManager. This
    ///      matters when a price limit causes an exact-input swap to fill only partially.
    function _collectProtocolFee(address tokenIn, uint256 actualAmountIn, address payer) internal {
        uint256 feeAmount = actualAmountIn * protocolFeePips / PIPS_DENOMINATOR;
        if (feeAmount == 0) return;
        _safeTransferFrom(tokenIn, payer, treasury, feeAmount);
        emit ProtocolFeePaid(payer, tokenIn, treasury, feeAmount);
    }

    function _quoteProtocolFee(PoolKey calldata key, SwapParams calldata params)
        internal
        view
        returns (address tokenIn, uint256 feeAmount)
    {
        if (params.amountSpecified > 0) revert ExactOutputNotSupported();
        tokenIn = Currency.unwrap(params.zeroForOne ? key.currency0 : key.currency1);
        uint256 amountIn = uint256(-params.amountSpecified);
        feeAmount = amountIn * protocolFeePips / PIPS_DENOMINATOR;
    }

    function _swapAmounts(PoolKey calldata key, SwapParams calldata params, BalanceDelta delta)
        internal
        pure
        returns (address tokenIn, address tokenOut, int128 amountIn, int128 amountOut)
    {
        if (params.zeroForOne) {
            tokenIn = Currency.unwrap(key.currency0);
            tokenOut = Currency.unwrap(key.currency1);
            amountIn = -delta.amount0();
            amountOut = delta.amount1();
        } else {
            tokenIn = Currency.unwrap(key.currency1);
            tokenOut = Currency.unwrap(key.currency0);
            amountIn = -delta.amount1();
            amountOut = delta.amount0();
        }
    }

    function _enforceLiquiditySpendLimits(
        PoolKey memory key,
        BalanceDelta delta,
        uint256 maxAmount0,
        uint256 maxAmount1
    ) internal pure {
        uint256 amount0 = _paidAmount(delta.amount0());
        uint256 amount1 = _paidAmount(delta.amount1());
        if (amount0 > maxAmount0) {
            revert LiquiditySpendExceeded(Currency.unwrap(key.currency0), amount0, maxAmount0);
        }
        if (amount1 > maxAmount1) {
            revert LiquiditySpendExceeded(Currency.unwrap(key.currency1), amount1, maxAmount1);
        }
    }

    function _enforceLiquidityOutputLimits(
        PoolKey memory key,
        BalanceDelta delta,
        uint256 minAmount0,
        uint256 minAmount1
    ) internal pure {
        uint256 amount0 = _receivedAmount(delta.amount0());
        uint256 amount1 = _receivedAmount(delta.amount1());
        if (amount0 < minAmount0) {
            revert LiquidityOutputTooLow(Currency.unwrap(key.currency0), amount0, minAmount0);
        }
        if (amount1 < minAmount1) {
            revert LiquidityOutputTooLow(Currency.unwrap(key.currency1), amount1, minAmount1);
        }
    }

    function _paidAmount(int128 delta) internal pure returns (uint256) {
        return delta < 0 ? uint256(-int256(delta)) : 0;
    }

    function _receivedAmount(int128 delta) internal pure returns (uint256) {
        return delta > 0 ? uint256(int256(delta)) : 0;
    }

    /// @dev Handles one side of the balance delta.
    ///      delta < 0  → we owe the pool  → transferFrom(payer) + settle
    ///      delta > 0  → pool owes us     → take to the original sender
    ///      delta == 0 → nothing to do
    function _settle(Currency currency, address payer, int128 delta) internal {
        if (delta < 0) {
            // We owe the pool: sync → transferFrom(payer → poolManager) → settle
            // delta is known negative, so -delta is non-negative and fits in int128.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 amount = uint256(-int256(delta));
            if (currency.isAddressZero()) revert NativeNotSupported();
            poolManager.sync(currency);
            _safeTransferFrom(Currency.unwrap(currency), payer, address(poolManager), amount);
            poolManager.settle();
        } else if (delta > 0) {
            // Pool owes us: take to the original sender
            // delta is known positive, so this cast cannot truncate or wrap.
            // forge-lint: disable-next-line(unsafe-typecast)
            poolManager.take(currency, payer, uint256(int256(delta)));
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ERC20TransferFailed();
        }
    }

    receive() external payable {
        revert NativeNotSupported();
    }
}
