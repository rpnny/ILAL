// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency, CurrencyLibrary} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";

import {NettingTypes} from "./NettingTypes.sol";
import {IInstitutionalNettingHook} from "./IInstitutionalNettingHook.sol";

/// @title InstitutionalBatchRouter
/// @notice Permissionless atomic executor for signed institutional netting batches.
contract InstitutionalBatchRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    error OnlyPoolManager();
    error ReentrantBatch();
    error InvalidPool();
    error NativeNotSupported();
    error InvalidBatchSize();
    error ERC20TransferFailed();
    error IncompleteFill(uint256 actualAmountIn, uint256 signedAmountIn);
    error SlippageTooHigh(uint256 amountOut, uint256 minimum);

    event OrderSettled(
        bytes32 indexed batchId,
        uint256 indexed orderIndex,
        address indexed user,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut,
        uint256 matchedOutput,
        uint256 ammOutput
    );
    event BatchExecuted(
        bytes32 indexed batchId,
        address indexed executor,
        uint256 orderCount,
        uint256 total0,
        uint256 total1,
        uint256 matchedEachSide,
        uint256 residual0,
        uint256 residual1
    );

    IPoolManager public immutable poolManager;
    bool private _executing;

    struct CallbackData {
        address executor;
        PoolKey key;
        NettingTypes.BatchHeader header;
        NettingTypes.NettingOrder[] orders;
        bytes[] signatures;
    }

    constructor(IPoolManager _poolManager) {
        poolManager = _poolManager;
    }

    function batchUnlockActive() external view returns (bool) {
        return _executing;
    }

    function previewBatch(NettingTypes.NettingOrder[] calldata orders)
        public
        pure
        returns (NettingTypes.BatchHeader memory)
    {
        NettingTypes.NettingOrder[] memory copies = orders;
        return NettingTypes.preview(copies);
    }

    function executeBatch(
        PoolKey calldata key,
        NettingTypes.NettingOrder[] calldata orders,
        bytes[] calldata signatures
    ) external returns (bytes32 batchId) {
        if (_executing) revert ReentrantBatch();
        if (orders.length < 2 || orders.length > 16 || signatures.length != orders.length) revert InvalidBatchSize();
        if (key.currency0.isAddressZero() || key.currency1.isAddressZero()) revert NativeNotSupported();

        IInstitutionalNettingHook hook = IInstitutionalNettingHook(address(key.hooks));
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (
            address(hook.poolManager()) != address(poolManager) || hook.authorizedRouter() != address(this)
                || hook.supportedPoolId() != poolId
        ) revert InvalidPool();

        NettingTypes.BatchHeader memory header = previewBatch(orders);
        _executing = true;
        poolManager.unlock(
            abi.encode(
                CallbackData({executor: msg.sender, key: key, header: header, orders: orders, signatures: signatures})
            )
        );
        _executing = false;
        return header.batchId;
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        if (!_executing) revert ReentrantBatch();
        CallbackData memory data = abi.decode(rawData, (CallbackData));
        IInstitutionalNettingHook hook = IInstitutionalNettingHook(address(data.key.hooks));
        hook.openBatch(data.header, data.orders, data.signatures);

        uint256 remaining0 = data.header.matchedEachSide;
        uint256 remaining1 = data.header.matchedEachSide;
        for (uint256 i; i < data.orders.length; ++i) {
            NettingTypes.NettingOrder memory order = data.orders[i];
            uint256 remaining = order.zeroForOne ? remaining0 : remaining1;
            uint256 matched = order.amountIn < remaining ? order.amountIn : remaining;
            if (order.zeroForOne) remaining0 = remaining - matched;
            else remaining1 = remaining - matched;

            BalanceDelta delta = poolManager.swap(
                data.key,
                SwapParams({
                    zeroForOne: order.zeroForOne,
                    amountSpecified: -int256(uint256(order.amountIn)),
                    sqrtPriceLimitX96: order.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
                }),
                abi.encode(data.header.batchId, i, order)
            );
            _settleOrder(data.key, data.header.batchId, i, order, matched, delta);
        }

        hook.closeBatch(data.header);
        emit BatchExecuted(
            data.header.batchId,
            data.executor,
            data.orders.length,
            data.header.total0,
            data.header.total1,
            data.header.matchedEachSide,
            data.header.residual0,
            data.header.residual1
        );
        return abi.encode(data.header.batchId);
    }

    function _settleOrder(
        PoolKey memory key,
        bytes32 batchId,
        uint256 orderIndex,
        NettingTypes.NettingOrder memory order,
        uint256 matched,
        BalanceDelta delta
    ) internal {
        int128 inputDelta = order.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = order.zeroForOne ? delta.amount1() : delta.amount0();
        uint256 actualInput = inputDelta < 0 ? uint256(-int256(inputDelta)) : 0;
        uint256 actualOutput = outputDelta > 0 ? uint256(int256(outputDelta)) : 0;
        if (actualInput != order.amountIn) revert IncompleteFill(actualInput, order.amountIn);
        if (actualOutput < order.minAmountOut) revert SlippageTooHigh(actualOutput, order.minAmountOut);

        _settle(key.currency0, order.user, delta.amount0());
        _settle(key.currency1, order.user, delta.amount1());
        emit OrderSettled(
            batchId,
            orderIndex,
            order.user,
            order.zeroForOne,
            actualInput,
            actualOutput,
            matched,
            actualOutput - matched
        );
    }

    function _settle(Currency currency, address user, int128 delta) internal {
        if (delta < 0) {
            uint256 amount = uint256(-int256(delta));
            poolManager.sync(currency);
            _safeTransferFrom(Currency.unwrap(currency), user, address(poolManager), amount);
            poolManager.settle();
        } else if (delta > 0) {
            poolManager.take(currency, user, uint256(int256(delta)));
        }
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory result) = token.call(abi.encodeCall(IERC20Minimal.transferFrom, (from, to, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert ERC20TransferFailed();
    }
}
