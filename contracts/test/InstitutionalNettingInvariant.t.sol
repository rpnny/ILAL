// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";

import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {InstitutionalNettingHook} from "../src/netting/InstitutionalNettingHook.sol";
import {InstitutionalBatchRouter} from "../src/netting/InstitutionalBatchRouter.sol";
import {NettingTypes} from "../src/netting/NettingTypes.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";

contract InstitutionalNettingHandler is Test {
    uint256 internal constant ALICE_KEY = 0xA11CE;
    uint256 internal constant BOB_KEY = 0xB0B;
    uint256 internal constant MAX_ORDER_AMOUNT = 1_000e6;

    InstitutionalBatchRouter public immutable router;
    InstitutionalNettingHook public immutable hook;
    PoolKey internal key;
    address public immutable alice;
    address public immutable bob;

    uint256 public calls;
    uint256 public submittedGross;
    uint256 public matchedGross;
    uint256 public residualGross;
    uint256 public lastResidual0;
    uint256 public lastResidual1;
    bytes32 public lastAliceNonce;
    bytes32 public lastBobNonce;

    constructor(InstitutionalBatchRouter _router, InstitutionalNettingHook _hook, PoolKey memory _key) {
        router = _router;
        hook = _hook;
        key = _key;
        alice = vm.addr(ALICE_KEY);
        bob = vm.addr(BOB_KEY);
    }

    function execute(uint64 rawAmount0, uint64 rawAmount1, uint8 rawOrderCount) external {
        uint256 orderCount = bound(uint256(rawOrderCount), 3, 16);
        uint256 sequence = ++calls;
        uint256 total0;
        uint256 total1;
        NettingTypes.NettingOrder[] memory orders = new NettingTypes.NettingOrder[](orderCount);
        bytes[] memory signatures = new bytes[](orderCount);
        for (uint256 i; i < orderCount; ++i) {
            bool zeroForOne = i % 2 == 0;
            address user = zeroForOne ? alice : bob;
            uint256 rawAmount = zeroForOne ? rawAmount0 : rawAmount1;
            uint256 amount = uint256(keccak256(abi.encode(rawAmount, sequence, i))) % MAX_ORDER_AMOUNT + 1;
            bytes32 nonce = keccak256(abi.encode(sequence, i, user));
            orders[i] = NettingTypes.NettingOrder({
                user: user,
                poolId: hook.supportedPoolId(),
                zeroForOne: zeroForOne,
                amountIn: uint128(amount),
                minAmountOut: 0,
                maxAmmInput: uint128(amount),
                deadline: type(uint64).max,
                nonce: nonce
            });
            signatures[i] = _sign(orders[i], zeroForOne ? ALICE_KEY : BOB_KEY);
            if (zeroForOne) {
                total0 += amount;
                lastAliceNonce = nonce;
            } else {
                total1 += amount;
                lastBobNonce = nonce;
            }
        }

        router.executeBatch(key, orders, signatures);

        uint256 matched = total0 < total1 ? total0 : total1;
        lastResidual0 = total0 - matched;
        lastResidual1 = total1 - matched;
        submittedGross += total0 + total1;
        matchedGross += matched * 2;
        residualGross += lastResidual0 + lastResidual1;
        assertEq(submittedGross, matchedGross + residualGross);
        assertTrue(hook.nonceUsed(alice, lastAliceNonce));
        assertTrue(hook.nonceUsed(bob, lastBobNonce));
        assertFalse(hook.batchActive());
    }

    function _sign(NettingTypes.NettingOrder memory order, uint256 privateKey) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, hook.orderDigest(order));
        return abi.encodePacked(r, s, v);
    }
}

contract InstitutionalNettingInvariantTest is StdInvariant, Test {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336;
    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 10;

    IPoolManager internal manager;
    PoolModifyLiquidityTest internal liquidityRouter;
    InstitutionalBatchRouter internal router;
    InstitutionalNettingHook internal hook;
    MockERC20 internal token0;
    MockERC20 internal token1;
    InstitutionalNettingHandler internal handler;
    address internal alice;
    address internal bob;

    function setUp() public {
        alice = vm.addr(0xA11CE);
        bob = vm.addr(0xB0B);
        manager = new PoolManager(address(this));
        liquidityRouter = new PoolModifyLiquidityTest(manager);
        router = new InstitutionalBatchRouter(manager);
        PolicyRegistry registry = new PolicyRegistry();
        MockCNFIssuer issuer = new MockCNFIssuer();
        MockERC20 tokenA = new MockERC20("Invariant USD A", "iUSDA", 6);
        MockERC20 tokenB = new MockERC20("Invariant USD B", "iUSDB", 6);
        (token0, token1) = address(tokenA) < address(tokenB) ? (tokenA, tokenB) : (tokenB, tokenA);

        bytes memory args = abi.encode(
            manager, registry, address(router), address(token0), address(token1), FEE, TICK_SPACING, int24(100)
        );
        (, bytes32 salt) = HookMiner.find(
            address(this),
            Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG,
            type(InstitutionalNettingHook).creationCode,
            args
        );
        hook = new InstitutionalNettingHook{salt: salt}(
            manager, registry, address(router), address(token0), address(token1), FEE, TICK_SPACING, 100
        );
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(hook))
        });
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
        registry.setPolicy(PoolId.unwrap(key.toId()), address(issuer), issuer.defaultCredentialType());
        token0.mint(alice, 1e22);
        token1.mint(alice, 1e22);
        token0.mint(bob, 1e22);
        token1.mint(bob, 1e22);
        vm.prank(alice);
        token0.approve(address(router), type(uint256).max);
        vm.prank(alice);
        token1.approve(address(router), type(uint256).max);
        vm.prank(bob);
        token0.approve(address(router), type(uint256).max);
        vm.prank(bob);
        token1.approve(address(router), type(uint256).max);

        handler = new InstitutionalNettingHandler(router, hook, key);
        targetContract(address(handler));
    }

    function invariant_grossEqualsMatchedPlusResidual() public view {
        assertEq(handler.submittedGross(), handler.matchedGross() + handler.residualGross());
    }

    function invariant_onlyOneSideCanHaveResidual() public view {
        assertTrue(handler.lastResidual0() == 0 || handler.lastResidual1() == 0);
    }

    function invariant_batchContextAlwaysClosed() public view {
        assertFalse(hook.batchActive());
    }

    function invariant_latestNoncesCannotReplay() public view {
        if (handler.calls() == 0) return;
        assertTrue(hook.nonceUsed(alice, handler.lastAliceNonce()));
        assertTrue(hook.nonceUsed(bob, handler.lastBobNonce()));
    }

    function invariant_hookAndRouterHaveNoInventory() public view {
        assertEq(token0.balanceOf(address(hook)), 0);
        assertEq(token1.balanceOf(address(hook)), 0);
        assertEq(token0.balanceOf(address(router)), 0);
        assertEq(token1.balanceOf(address(router)), 0);
    }

    function invariant_tokenConservation() public view {
        assertEq(_trackedBalances(token0), token0.totalSupply());
        assertEq(_trackedBalances(token1), token1.totalSupply());
    }

    function _trackedBalances(MockERC20 token) internal view returns (uint256) {
        return token.balanceOf(address(this)) + token.balanceOf(address(manager)) + token.balanceOf(alice)
            + token.balanceOf(bob) + token.balanceOf(address(hook)) + token.balanceOf(address(router))
            + token.balanceOf(address(liquidityRouter)) + token.balanceOf(address(handler));
    }
}
