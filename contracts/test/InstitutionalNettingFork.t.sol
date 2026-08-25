// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {IV4Router} from "v4-periphery/src/interfaces/IV4Router.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";

contract UniquePoolHook {
    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        return UniquePoolHook.beforeInitialize.selector;
    }
}

interface IERC20MetadataFork {
    function decimals() external view returns (uint8);
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IPermit2Fork {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IUniversalRouterFork {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Read-only Base fork guard for the external production surfaces used
/// by institutional-study-v1. It never broadcasts and never mutates mainnet.
contract InstitutionalNettingForkTest is Test {
    address internal constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant USDT = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2;
    address internal constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address internal constant UNIVERSAL_ROUTER = 0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant GAS_PRICE_ORACLE = 0x420000000000000000000000000000000000000F;
    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint256 internal constant UNIT = 1e6;
    uint8 internal constant V4_SWAP = 0x10;
    uint8 internal constant SWAP_EXACT_IN_SINGLE = 0x06;
    uint8 internal constant SETTLE_ALL = 0x0c;
    uint8 internal constant TAKE_ALL = 0x0f;

    IPoolManager internal manager;
    PoolKey internal key;
    bool internal forkConfigured;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_MAINNET_RPC_URL", string(""));
        uint256 forkBlock = vm.envOr("ILAL_FORK_BLOCK", uint256(0));
        if (bytes(rpcUrl).length == 0 || forkBlock == 0) return;
        vm.createSelectFork(rpcUrl, forkBlock);
        manager = IPoolManager(POOL_MANAGER);
        forkConfigured = true;
    }

    function testFork_officialSurfacesAndRealStablecoinBytecodeExist() public view {
        if (!forkConfigured) return;
        assertGt(USDC.code.length, 0);
        assertGt(USDT.code.length, 0);
        assertGt(POOL_MANAGER.code.length, 0);
        assertGt(UNIVERSAL_ROUTER.code.length, 0);
        assertGt(PERMIT2.code.length, 0);
        assertGt(GAS_PRICE_ORACLE.code.length, 0);
        assertEq(IERC20MetadataFork(USDC).decimals(), 6);
        assertEq(IERC20MetadataFork(USDT).decimals(), 6);
    }

    function testFork_universalRouterPermit2IndependentAndBundled() public {
        if (!forkConfigured) return;
        _initializeControlledPool();
        uint256 snapshot = vm.snapshotState();

        uint256 gasBefore = gasleft();
        uint256 independentOutput =
            _executeSingle(true, uint128(10_000 * UNIT)) + _executeSingle(false, uint128(7_000 * UNIT));
        uint256 independentGas = gasBefore - gasleft();
        uint256 independentTotalGas = independentGas
            + _transactionEnvelopeGas(_singleCallData(true, uint128(10_000 * UNIT)))
            + _transactionEnvelopeGas(_singleCallData(false, uint128(7_000 * UNIT)));
        emit log_string(string.concat(
                "FORKBASELINE|mode=independent|output=",
                vm.toString(independentOutput),
                "|executionGas=",
                vm.toString(independentGas),
                "|totalGas=",
                vm.toString(independentTotalGas)
            ));

        assertTrue(vm.revertToState(snapshot));
        uint256 totalBefore =
            IERC20MetadataFork(USDC).balanceOf(address(this)) + IERC20MetadataFork(USDT).balanceOf(address(this));
        gasBefore = gasleft();
        _executeBundled(uint128(10_000 * UNIT), uint128(7_000 * UNIT));
        uint256 bundledGas = gasBefore - gasleft();
        uint256 bundledTotalGas =
            bundledGas + _transactionEnvelopeGas(_bundledCallData(uint128(10_000 * UNIT), uint128(7_000 * UNIT)));
        uint256 totalAfter =
            IERC20MetadataFork(USDC).balanceOf(address(this)) + IERC20MetadataFork(USDT).balanceOf(address(this));
        uint256 bundledOutput = totalAfter + 17_000 * UNIT - totalBefore;
        emit log_string(string.concat(
                "FORKBASELINE|mode=bundled|output=",
                vm.toString(bundledOutput),
                "|executionGas=",
                vm.toString(bundledGas),
                "|totalGas=",
                vm.toString(bundledTotalGas)
            ));
        assertGt(independentOutput, 0);
        assertGt(bundledOutput, 0);
    }

    function _initializeControlledPool() internal {
        // A beforeInitialize-only Hook makes the pool key unique while retaining
        // vanilla swap behavior after initialization.
        (address predicted, bytes32 salt) =
            HookMiner.find(address(this), Hooks.BEFORE_INITIALIZE_FLAG, type(UniquePoolHook).creationCode, bytes(""));
        UniquePoolHook uniqueHook = new UniquePoolHook{salt: salt}();
        assertEq(address(uniqueHook), predicted);
        key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(USDT),
            fee: 500,
            tickSpacing: 10,
            hooks: IHooks(address(uniqueHook))
        });
        manager.initialize(key, SQRT_PRICE_1_1);
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(manager);
        deal(USDC, address(this), 10_000_000 * UNIT, true);
        deal(USDT, address(this), 10_000_000 * UNIT, true);
        IERC20MetadataFork(USDC).approve(address(liquidityRouter), type(uint256).max);
        IERC20MetadataFork(USDT).approve(address(liquidityRouter), type(uint256).max);
        liquidityRouter.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: -1000, tickUpper: 1000, liquidityDelta: int256(1e14), salt: bytes32(0)}),
            ""
        );
        IERC20MetadataFork(USDC).approve(PERMIT2, type(uint256).max);
        IERC20MetadataFork(USDT).approve(PERMIT2, type(uint256).max);
        IPermit2Fork(PERMIT2).approve(USDC, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
        IPermit2Fork(PERMIT2).approve(USDT, UNIVERSAL_ROUTER, type(uint160).max, type(uint48).max);
    }

    function _plan(bool zeroForOne, uint128 amountIn) internal view returns (bytes memory) {
        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: amountIn,
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        Currency output = zeroForOne ? key.currency1 : key.currency0;
        params[1] = abi.encode(input, type(uint256).max);
        params[2] = abi.encode(output, uint256(0));
        return abi.encode(actions, params);
    }

    function _executeSingle(bool zeroForOne, uint128 amountIn) internal returns (uint256 output) {
        IERC20MetadataFork outputToken = IERC20MetadataFork(zeroForOne ? USDT : USDC);
        uint256 beforeBalance = outputToken.balanceOf(address(this));
        (bool success, bytes memory result) = UNIVERSAL_ROUTER.call(_singleCallData(zeroForOne, amountIn));
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        output = outputToken.balanceOf(address(this)) - beforeBalance;
    }

    function _singleCallData(bool zeroForOne, uint128 amountIn) internal view returns (bytes memory) {
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = _plan(zeroForOne, amountIn);
        return abi.encodeCall(IUniversalRouterFork.execute, (abi.encodePacked(V4_SWAP), inputs, block.timestamp + 1));
    }

    function _executeBundled(uint128 amount0, uint128 amount1) internal {
        (bool success, bytes memory result) = UNIVERSAL_ROUTER.call(_bundledCallData(amount0, amount1));
        if (!success) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }

    function _bundledCallData(uint128 amount0, uint128 amount1) internal view returns (bytes memory) {
        bytes[] memory inputs = new bytes[](2);
        inputs[0] = _plan(true, amount0);
        inputs[1] = _plan(false, amount1);
        return
            abi.encodeCall(
                IUniversalRouterFork.execute, (abi.encodePacked(V4_SWAP, V4_SWAP), inputs, block.timestamp + 1)
            );
    }

    function _transactionEnvelopeGas(bytes memory callData) internal pure returns (uint256 gasCost) {
        gasCost = 21_000;
        for (uint256 i; i < callData.length; ++i) {
            gasCost += callData[i] == 0 ? 4 : 16;
        }
    }
}
