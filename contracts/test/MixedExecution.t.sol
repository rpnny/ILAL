// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolManager} from "v4-core/src/PoolManager.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockStablecoinOracleGuard} from "./mocks/MockStablecoinOracleGuard.sol";
import {MixedHook} from "../src/mixed/MixedHook.sol";
import {MixedOracleGuard} from "../src/mixed/MixedOracleGuard.sol";
import {MixedExecutionRouter} from "../src/mixed/MixedExecutionRouter.sol";
import {MixedLiquidityRouter} from "../src/mixed/MixedLiquidityRouter.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {MixedAuthorization} from "../src/mixed/MixedAuthorization.sol";
import {IMixedEligibility} from "../src/mixed/IMixedEligibility.sol";

contract TestMixedEligibility is IMixedEligibility {
    bool public valid = true;

    function setValid(bool v) external {
        valid = v;
    }

    function isEligible(bytes32, address, bytes32, uint64) external view returns (bool) {
        return valid;
    }
}

abstract contract MixedExecutionFixture is Test {
    using PoolIdLibrary for PoolKey;
    IPoolManager internal manager;
    MixedHook internal hook;
    MixedExecutionRouter internal router;
    MixedLiquidityRouter internal lp;
    MixedOracleGuard internal oracle;
    TestMixedEligibility internal eligibility;
    MockStablecoinOracleGuard internal referenceGuard;
    MockERC20 internal t0;
    MockERC20 internal t1;
    PoolKey internal key;
    bytes32 internal poolId;
    uint256 internal constant AK = 0xA11CE;
    uint256 internal constant BK = 0xB0B;
    address internal alice;
    address internal bob;

    function setUp() public virtual {
        _setup(0);
    }

    function _setup(int24 tick) internal {
        alice = vm.addr(AK);
        bob = vm.addr(BK);
        manager = new PoolManager(address(this));
        router = new MixedExecutionRouter(manager);
        lp = new MixedLiquidityRouter(manager);
        eligibility = new TestMixedEligibility();
        referenceGuard = new MockStablecoinOracleGuard();
        MockERC20 a = new MockERC20("A", "A", 6);
        MockERC20 b = new MockERC20("B", "B", 6);
        (t0, t1) = address(a) < address(b) ? (a, b) : (b, a);
        oracle = new MixedOracleGuard(address(t0), address(t1), referenceGuard, 100);
        MixedHook.Config memory c =
            MixedHook.Config(manager, oracle, _eligibilityProvider(), address(router), address(lp));
        uint160 flags = Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_DONATE_FLAG;
        (, bytes32 salt) = HookMiner.find(address(this), flags, type(MixedHook).creationCode, abi.encode(c));
        hook = new MixedHook{salt: salt}(c);
        router.bindHook(hook);
        lp.bindHook(hook);
        key = PoolKey(Currency.wrap(address(t0)), Currency.wrap(address(t1)), 500, 10, IHooks(address(hook)));
        poolId = PoolId.unwrap(key.toId());
        manager.initialize(key, TickMath.getSqrtPriceAtTick(tick));
        t0.mint(alice, 1e18);
        t1.mint(alice, 1e18);
        t0.mint(bob, 1e18);
        t1.mint(bob, 1e18);
        vm.startPrank(alice);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        t0.approve(address(lp), type(uint256).max);
        t1.approve(address(lp), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        t0.approve(address(router), type(uint256).max);
        t1.approve(address(router), type(uint256).max);
        vm.stopPrank();
        _beforeInitialLiquidity();
        MixedTypes.LiquidityAuthorization memory auth = _lp(MixedTypes.LP_ADD, 1e14, 1);
        bytes memory sig = _sign(AK, hook.liquidityDigest(auth));
        vm.prank(alice);
        lp.modify(key, auth, sig);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _order(address who, bool side, uint128 amount, uint256 nonce)
        internal
        view
        returns (MixedTypes.Order memory)
    {
        return MixedTypes.Order(
            who,
            poolId,
            _executionPolicyHash(),
            _policyRevision(),
            side,
            amount,
            0,
            amount,
            oracle.lower(),
            oracle.upper(),
            uint64(block.timestamp + 3600),
            bytes32(nonce)
        );
    }

    function _lp(uint8 action, int128 delta, uint256 nonce)
        internal
        view
        returns (MixedTypes.LiquidityAuthorization memory)
    {
        return MixedTypes.LiquidityAuthorization(
            alice,
            poolId,
            _executionPolicyHash(),
            _policyRevision(),
            action,
            -1000,
            1000,
            delta,
            bytes32(0),
            action == MixedTypes.LP_ADD ? type(uint128).max : 0,
            action == MixedTypes.LP_ADD ? type(uint128).max : 0,
            uint64(block.timestamp + 3600),
            bytes32(nonce)
        );
    }

    function _batch(uint128 amount0, uint128 amount1, uint256 nonce)
        internal
        view
        returns (MixedTypes.Order[] memory o, bytes[] memory s)
    {
        o = new MixedTypes.Order[](2);
        s = new bytes[](2);
        o[0] = _order(alice, true, amount0, nonce);
        o[1] = _order(bob, false, amount1, nonce);
        s[0] = _sign(AK, hook.orderDigest(o[0], false));
        s[1] = _sign(BK, hook.orderDigest(o[1], false));
    }

    function _closed() internal view {
        assertFalse(hook.executionActive());
        assertFalse(router.executionActive());
        assertEq(t0.balanceOf(address(hook)), 0);
        assertEq(t1.balanceOf(address(hook)), 0);
        assertEq(t0.balanceOf(address(router)), 0);
        assertEq(t1.balanceOf(address(router)), 0);
    }

    function _eligibilityProvider() internal virtual returns (IMixedEligibility) {
        return eligibility;
    }
    function _beforeInitialLiquidity() internal virtual {}

    function _executionPolicyHash() internal view virtual returns (bytes32) {
        return bytes32(uint256(1));
    }

    function _policyRevision() internal view virtual returns (uint64) {
        return 1;
    }
}

contract MixedExecutionTest is MixedExecutionFixture {
    function test_batchAndNoCustody() public {
        (MixedTypes.Order[] memory o, bytes[] memory sig) = _batch(100e6, 70e6, 9);
        uint256 before = t0.balanceOf(bob);
        router.executeBatch(key, o, sig);
        assertEq(t0.balanceOf(bob) - before, 70e6);
        _closed();
        assertTrue(hook.nonceUsed(alice, 0, o[0].nonce));
    }

    function test_marketMinimumRollback() public {
        (MixedTypes.Order[] memory o, bytes[] memory sig) = _batch(100e6, 70e6, 10);
        o[0].minAmountOut = 101e6;
        sig[0] = _sign(AK, hook.orderDigest(o[0], false));
        uint256 before = t0.balanceOf(alice);
        vm.expectRevert("MIN_OUTPUT");
        router.executeBatch(key, o, sig);
        assertEq(t0.balanceOf(alice), before);
        assertFalse(hook.nonceUsed(alice, 0, o[0].nonce));
        _closed();
    }

    function test_openOutsideUnlockDenied() public {
        (MixedTypes.Order[] memory o, bytes[] memory sig) = _batch(100e6, 70e6, 11);
        vm.expectRevert(MixedHook.UnauthorizedPath.selector);
        hook.openBatch(key, o, sig, false);
        vm.prank(address(router));
        vm.expectRevert(MixedHook.UnauthorizedPath.selector);
        hook.openBatch(key, o, sig, false);
    }

    function test_directSignatureNamespace() public {
        MixedTypes.Order memory o = _order(alice, true, 1e6, 12);
        bytes memory bad = _sign(AK, hook.orderDigest(o, false));
        vm.expectRevert(MixedAuthorization.InvalidAuthorization.selector);
        router.executeDirectSwap(key, o, bad);
        bytes memory sig = _sign(AK, hook.orderDigest(o, true));
        router.executeDirectSwap(key, o, sig);
        assertTrue(hook.nonceUsed(alice, 1, o.nonce));
        assertFalse(hook.nonceUsed(alice, 0, o.nonce));
        _closed();
    }

    function test_exitAndCollectAfterRevocation() public {
        eligibility.setValid(false);
        MixedTypes.LiquidityAuthorization memory a = _lp(MixedTypes.LP_ADD, 1000, 30);
        bytes memory s = _sign(AK, hook.liquidityDigest(a));
        vm.prank(alice);
        vm.expectRevert();
        lp.modify(key, a, s);
        a = _lp(MixedTypes.LP_EXIT, -5e13, 31);
        s = _sign(AK, hook.liquidityDigest(a));
        vm.prank(alice);
        lp.modify(key, a, s);
        a = _lp(MixedTypes.LP_COLLECT, 0, 31);
        s = _sign(AK, hook.liquidityDigest(a));
        vm.prank(alice);
        lp.modify(key, a, s);
        assertTrue(hook.nonceUsed(alice, 4, bytes32(uint256(31))));
        assertTrue(hook.nonceUsed(alice, 5, bytes32(uint256(31))));
    }

    function test_wrongOwnerCannotWithdraw() public {
        MixedTypes.LiquidityAuthorization memory a = _lp(MixedTypes.LP_EXIT, -100, 50);
        bytes memory s = _sign(AK, hook.liquidityDigest(a));
        vm.prank(bob);
        vm.expectRevert("OWNER_OR_REENTRY");
        lp.modify(key, a, s);
    }

    function test_tick90CrossesAtReference() public {
        _setup(90);
        (MixedTypes.Order[] memory o, bytes[] memory sig) = _batch(100e6, 100e6, 20);
        uint256 before = t0.balanceOf(bob);
        router.executeBatch(key, o, sig);
        uint256 got = t0.balanceOf(bob) - before;
        assertGt(got, 99e6);
        assertLt(got, 99105000);
        _closed();
    }

    function test_permutationIndependent() public {
        (MixedTypes.Order[] memory o, bytes[] memory sig) = _batch(100e6, 70e6, 21);
        uint256 snap = vm.snapshotState();
        bytes32 a = router.executeBatch(key, o, sig);
        uint256 balance = t1.balanceOf(alice);
        vm.revertToState(snap);
        (o[0], o[1]) = (o[1], o[0]);
        (sig[0], sig[1]) = (sig[1], sig[0]);
        assertEq(router.executeBatch(key, o, sig), a);
        assertEq(t1.balanceOf(alice), balance);
    }
}
