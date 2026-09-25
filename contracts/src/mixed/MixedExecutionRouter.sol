// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {MixedHook} from "./MixedHook.sol";
import {MixedTypes} from "./MixedTypes.sol";
import {MixedSettlement} from "./MixedSettlement.sol";
import {MatchingMath} from "./MatchingMath.sol";

contract MixedExecutionRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable configurationAuthority;
    address public canonicalHook;
    event HookBound(address indexed hook);

    function bindHook(MixedHook hook) external {
        require(msg.sender == configurationAuthority && canonicalHook == address(0), "BIND_ONCE");
        require(
            address(hook).code.length > 0 && address(hook.poolManager()) == address(poolManager)
                && hook.executionRouter() == address(this),
            "HOOK_BINDING"
        );
        canonicalHook = address(hook);
        emit HookBound(address(hook));
    }
    bytes32 private constant ACTIVE_SLOT = keccak256("ilal.mixed.execution.active");
    error QuoteResult(bytes32 commitment, uint256[] outputs);
    bytes32 private constant QUOTE_SLOT = keccak256("ilal.mixed.quote");

    function quoting() public view returns (bool v) {
        bytes32 slot = QUOTE_SLOT;
        assembly ("memory-safe") { v := tload(slot) }
    }

    /// @notice Always reverts, including on success; cannot execute unsigned orders.
    function quoteBatch(PoolKey calldata key, MixedTypes.Order[] calldata orders, bool direct) external {
        require(!executionActive() && !quoting(), "REENTRANT");
        bytes32 slot = QUOTE_SLOT;
        assembly ("memory-safe") { tstore(slot, 1) }
        bytes[] memory signatures = new bytes[](orders.length);
        bytes memory result = _execute(key, orders, signatures, direct);
        (bytes32 commitment, uint256[] memory outputs) = abi.decode(result, (bytes32, uint256[]));
        revert QuoteResult(commitment, outputs);
    }
    event OrderSettled(
        bytes32 indexed commitment,
        address indexed user,
        uint256 index,
        bool zeroForOne,
        uint256 input,
        uint256 output,
        uint256 matchedInput,
        uint256 matchedOutput,
        uint256 ammInput,
        uint256 ammOutput
    );

    constructor(IPoolManager manager) {
        require(address(manager).code.length > 0, "MANAGER");
        poolManager = manager;
        configurationAuthority = msg.sender;
    }

    function executionActive() public view returns (bool v) {
        bytes32 slot = ACTIVE_SLOT;
        assembly ("memory-safe") { v := tload(slot) }
    }

    function _active(bool v) private {
        bytes32 slot = ACTIVE_SLOT;
        assembly ("memory-safe") { tstore(slot, v) }
    }

    function executeBatch(PoolKey calldata key, MixedTypes.Order[] calldata orders, bytes[] calldata signatures)
        external
        returns (bytes32)
    {
        return abi.decode(_execute(key, orders, signatures, false), (bytes32));
    }

    function executeDirectSwap(PoolKey calldata key, MixedTypes.Order calldata order, bytes calldata signature)
        external
        returns (bytes32)
    {
        MixedTypes.Order[] memory orders = new MixedTypes.Order[](1);
        orders[0] = order;
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = signature;
        return abi.decode(_execute(key, orders, signatures, true), (bytes32));
    }

    function _execute(PoolKey memory key, MixedTypes.Order[] memory orders, bytes[] memory signatures, bool direct)
        private
        returns (bytes memory)
    {
        require(!executionActive(), "REENTRANT");
        uint256 n = orders.length;
        require(n == signatures.length && (direct ? n == 1 : n >= 2 && n <= 16), "COUNT");
        require(canonicalHook != address(0) && address(key.hooks) == canonicalHook, "CANONICAL_HOOK");
        MixedHook hook = MixedHook(address(key.hooks));
        require(hook.executionRouter() == address(this) && address(hook.poolManager()) == address(poolManager), "HOOK");
        for (uint256 i = 1; i < n; ++i) {
            uint256 j = i;
            while (j > 0 && MixedTypes.hashOrder(orders[j], direct) < MixedTypes.hashOrder(orders[j - 1], direct)) {
                (orders[j], orders[j - 1]) = (orders[j - 1], orders[j]);
                (signatures[j], signatures[j - 1]) = (signatures[j - 1], signatures[j]);
                --j;
            }
        }
        _active(true);
        bytes memory result = poolManager.unlock(abi.encode(key, orders, signatures, direct));
        _active(false);
        return result;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager) && executionActive(), "CALLBACK");
        (PoolKey memory key, MixedTypes.Order[] memory orders, bytes[] memory signatures, bool direct) =
            abi.decode(data, (PoolKey, MixedTypes.Order[], bytes[], bool));
        require(canonicalHook != address(0) && address(key.hooks) == canonicalHook, "CANONICAL_HOOK");
        MixedHook hook = MixedHook(address(key.hooks));
        bytes32 commitment = hook.openBatch(key, orders, signatures, direct);
        for (uint256 i; i < orders.length; ++i) {
            MixedSettlement.fund(
                poolManager, orders[i].zeroForOne ? key.currency0 : key.currency1, orders[i].user, orders[i].amountIn
            );
        }
        uint256[] memory outputs = new uint256[](orders.length);
        for (uint256 i; i < orders.length; ++i) {
            outputs[i] = _swap(key, hook, orders[i], commitment, i);
        }
        hook.closeBatch();
        for (uint256 i; i < orders.length; ++i) {
            MixedSettlement.pay(
                poolManager, orders[i].zeroForOne ? key.currency1 : key.currency0, orders[i].user, outputs[i]
            );
        }
        return abi.encode(commitment, outputs);
    }

    function _swap(PoolKey memory key, MixedHook hook, MixedTypes.Order memory o, bytes32 commitment, uint256 i)
        private
        returns (uint256 output)
    {
        MatchingMath.Allocation memory a = hook.allocation(i);
        BalanceDelta d = poolManager.swap(
            key,
            SwapParams(o.zeroForOne, -int256(uint256(o.amountIn)), hook.oracle().priceLimit(o.zeroForOne)),
            abi.encode(i, o)
        );
        int128 inputDelta = o.zeroForOne ? d.amount0() : d.amount1();
        int128 outputDelta = o.zeroForOne ? d.amount1() : d.amount0();
        require(inputDelta < 0 && uint256(-int256(inputDelta)) == o.amountIn, "INCOMPLETE_FILL");
        require(outputDelta >= 0, "OUTPUT_SIGN");
        output = uint128(outputDelta);
        require(output >= o.minAmountOut && output >= a.matchedOutput, "MIN_OUTPUT");
        emit OrderSettled(
            commitment,
            o.user,
            i,
            o.zeroForOne,
            o.amountIn,
            output,
            a.matchedInput,
            a.matchedOutput,
            a.residual,
            output - a.matchedOutput
        );
    }
}
