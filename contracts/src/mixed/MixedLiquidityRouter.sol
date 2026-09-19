// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {MixedHook} from "./MixedHook.sol";
import {MixedTypes} from "./MixedTypes.sol";
import {MixedSettlement} from "./MixedSettlement.sol";

/// @notice Immutable owner-isolated positions, without NFTs, operators or admin withdrawals.
contract MixedLiquidityRouter is IUnlockCallback {
    IPoolManager public immutable poolManager;
    address public immutable configurationAuthority;
    address public canonicalHook;
    event HookBound(address indexed hook);

    function bindHook(MixedHook hook) external {
        require(msg.sender == configurationAuthority && canonicalHook == address(0), "BIND_ONCE");
        require(
            address(hook).code.length > 0 && address(hook.poolManager()) == address(poolManager)
                && hook.liquidityRouter() == address(this),
            "HOOK_BINDING"
        );
        canonicalHook = address(hook);
        emit HookBound(address(hook));
    }
    bytes32 private constant ACTIVE_SLOT = keccak256("ilal.mixed.liquidity.active");
    event LiquiditySettled(
        address indexed user,
        bytes32 indexed poolId,
        bytes32 indexed positionSalt,
        uint8 action,
        int128 liquidityDelta,
        int128 amount0,
        int128 amount1,
        int128 fees0,
        int128 fees1
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

    function modify(PoolKey calldata key, MixedTypes.LiquidityAuthorization calldata a, bytes calldata signature)
        external
        returns (BalanceDelta delta, BalanceDelta fees)
    {
        require(msg.sender == a.user && !executionActive(), "OWNER_OR_REENTRY");
        require(canonicalHook != address(0) && address(key.hooks) == canonicalHook, "CANONICAL_HOOK");
        MixedHook h = MixedHook(address(key.hooks));
        require(h.liquidityRouter() == address(this) && address(h.poolManager()) == address(poolManager), "HOOK");
        _active(true);
        bytes memory result = poolManager.unlock(abi.encode(key, a, signature));
        _active(false);
        return abi.decode(result, (BalanceDelta, BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(poolManager) && executionActive(), "CALLBACK");
        (PoolKey memory key, MixedTypes.LiquidityAuthorization memory a, bytes memory signature) =
            abi.decode(data, (PoolKey, MixedTypes.LiquidityAuthorization, bytes));
        bytes32 salt = MixedTypes.positionSalt(a.user, a.userSalt);
        (BalanceDelta d, BalanceDelta fees) = poolManager.modifyLiquidity(
            key, ModifyLiquidityParams(a.tickLower, a.tickUpper, a.liquidityDelta, salt), abi.encode(a, signature)
        );
        if (a.action == MixedTypes.LP_ADD) {
            // Limits bound gross principal, never masked by fees earned by this position.
            require(
                _paid(d.amount0() - fees.amount0()) <= a.amount0Limit
                    && _paid(d.amount1() - fees.amount1()) <= a.amount1Limit,
                "LP_SPEND"
            );
        } else {
            require(
                d.amount0() >= 0 && d.amount1() >= 0 && uint128(d.amount0()) >= a.amount0Limit
                    && uint128(d.amount1()) >= a.amount1Limit,
                "LP_RECEIVE"
            );
        }
        _settle(key.currency0, a.user, d.amount0());
        _settle(key.currency1, a.user, d.amount1());
        emit LiquiditySettled(
            a.user, a.poolId, salt, a.action, a.liquidityDelta, d.amount0(), d.amount1(), fees.amount0(), fees.amount1()
        );
        return abi.encode(d, fees);
    }

    function _paid(int128 x) private pure returns (uint256) {
        return x < 0 ? uint256(-int256(x)) : 0;
    }

    function _settle(Currency c, address user, int128 x) private {
        if (x < 0) MixedSettlement.fund(poolManager, c, user, uint256(-int256(x)));
        else MixedSettlement.pay(poolManager, c, user, uint128(x));
    }
}
