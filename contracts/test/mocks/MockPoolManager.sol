// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {BalanceDelta, toBalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IERC20Minimal} from "v4-core/src/interfaces/external/IERC20Minimal.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

/// @dev Minimal stub PoolManager for ILALRouter integration tests.
///
///      It:
///        • Forwards `unlock()` data back via `unlockCallback()` on the caller.
///        • Returns a configurable BalanceDelta from `swap()`.
///        • Makes `sync`, `settle`, `take` no-ops (no actual accounting).
///
///      This lets us test the router's slippage guard, protocol-fee deduction,
///      and event emission without deploying the full v4 stack.
contract MockPoolManager {
    error InsufficientPositionLiquidity();

    // Configurable swap return value
    int128 public mockAmount0;
    int128 public mockAmount1;
    int128 public mockLiquidityAmount0;
    int128 public mockLiquidityAmount1;
    int24 public lastTickLower;
    int24 public lastTickUpper;
    int256 public lastLiquidityDelta;
    bytes32 public lastSalt;
    mapping(bytes32 => int256) public positionLiquidity;

    function setSwapResult(int128 _amount0, int128 _amount1) external {
        mockAmount0 = _amount0;
        mockAmount1 = _amount1;
    }

    function setLiquidityResult(int128 _amount0, int128 _amount1) external {
        mockLiquidityAmount0 = _amount0;
        mockLiquidityAmount1 = _amount1;
    }

    // ─── IPoolManager stubs ───────────────────────────────────────────────────

    function unlock(bytes calldata data) external returns (bytes memory result) {
        result = IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory, bytes calldata) external view returns (BalanceDelta) {
        return toBalanceDelta(mockAmount0, mockAmount1);
    }

    function modifyLiquidity(PoolKey memory, ModifyLiquidityParams memory params, bytes calldata)
        external
        returns (BalanceDelta callerDelta, BalanceDelta feesAccrued)
    {
        lastTickLower = params.tickLower;
        lastTickUpper = params.tickUpper;
        lastLiquidityDelta = params.liquidityDelta;
        lastSalt = params.salt;
        bytes32 positionKey = keccak256(abi.encode(params.tickLower, params.tickUpper, params.salt));
        int256 nextLiquidity = positionLiquidity[positionKey] + params.liquidityDelta;
        if (nextLiquidity < 0) revert InsufficientPositionLiquidity();
        positionLiquidity[positionKey] = nextLiquidity;
        callerDelta = toBalanceDelta(mockLiquidityAmount0, mockLiquidityAmount1);
        feesAccrued = toBalanceDelta(0, 0);
    }

    function sync(Currency) external {}

    function settle() external payable returns (uint256) {
        return 0;
    }

    function settleFor(address) external payable returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        // Transfer tokens from this contract to `to` — tests must pre-fund this contract
        if (amount > 0) {
            address token = Currency.unwrap(currency);
            (bool ok, bytes memory d) = token.call(abi.encodeCall(IERC20Minimal.transfer, (to, amount)));
            require(ok && (d.length == 0 || abi.decode(d, (bool))), "MockPoolManager: take failed");
        }
    }

    // ─── Unused IPoolManager surface — all revert so tests catch accidental calls ──

    function initialize(PoolKey memory, uint160) external pure returns (int24) {
        revert("not implemented");
    }

    function collectProtocolFees(address, Currency, uint256) external pure returns (uint256) {
        revert("not implemented");
    }

    function setProtocolFee(PoolKey memory, uint24) external pure {
        revert("not implemented");
    }

    function setProtocolFeeController(address) external pure {
        revert("not implemented");
    }

    function updateDynamicLPFee(PoolKey memory, uint24) external pure {
        revert("not implemented");
    }

    function donate(PoolKey memory, uint256, uint256, bytes calldata) external pure returns (BalanceDelta) {
        revert("not implemented");
    }

    function isOperator(address, address) external pure returns (bool) {
        return false;
    }

    function setOperator(address, bool) external pure returns (bool) {
        return false;
    }

    function transfer(address, uint256, uint256, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256, uint256, uint256) external pure returns (bool) {
        return false;
    }

    function balanceOf(address, uint256) external pure returns (uint256) {
        return 0;
    }

    function allowance(address, address, uint256) external pure returns (uint256) {
        return 0;
    }

    function approve(address, uint256, uint256) external pure returns (bool) {
        return false;
    }

    function protocolFeeController() external pure returns (address) {
        return address(0);
    }

    function protocolFeesAccrued(Currency) external pure returns (uint256) {
        return 0;
    }

    function extsload(bytes32) external pure returns (bytes32) {
        return 0;
    }

    function extsload(bytes32, uint256) external pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function extsload(bytes32[] calldata) external pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }

    function exttload(bytes32) external pure returns (bytes32) {
        return 0;
    }

    function exttload(bytes32[] calldata) external pure returns (bytes32[] memory) {
        return new bytes32[](0);
    }
}
