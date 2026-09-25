// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {MixedExecutionTest} from "./MixedExecution.t.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {MixedAuthorization} from "../src/mixed/MixedAuthorization.sol";
import {MixedOracleGuard} from "../src/mixed/MixedOracleGuard.sol";
import {MixedHook} from "../src/mixed/MixedHook.sol";
import {PoolDonateTest} from "v4-core/src/test/PoolDonateTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/src/test/PoolModifyLiquidityTest.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IStablecoinOracleGuard} from "../src/interfaces/IStablecoinOracleGuard.sol";

contract MovingReference is IStablecoinOracleGuard {
    uint256 public p = 1e18;
    bool public broken;

    function set(uint256 price, bool fail) external {
        p = price;
        broken = fail;
    }

    function validate() external view returns (OracleSnapshot memory) {
        require(!broken, "STALE");
        return OracleSnapshot(p, 1e18, block.timestamp, block.timestamp, false);
    }
}

contract MixedSafetyTest is MixedExecutionTest {
    function test_poolOracleDisagreement() public {
        MovingReference r = new MovingReference();
        MixedOracleGuard g = new MixedOracleGuard(address(t0), address(t1), r, 100);
        r.set(99e16, false);
        vm.expectRevert(MixedOracleGuard.ReferenceDeviation.selector);
        g.validate(TickMath.getSqrtPriceAtTick(99));
        r.set(1e18, true);
        vm.expectRevert("STALE");
        g.validate(uint160(1 << 96));
    }

    function test_residualCannotLeaveBand() public {
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(900_000e6, 1e6, 101);
        uint256 before = t0.balanceOf(alice);
        vm.expectRevert("INCOMPLETE_FILL");
        router.executeBatch(key, o, s);
        assertEq(t0.balanceOf(alice), before);
        assertFalse(hook.nonceUsed(alice, 0, o[0].nonce));
        _closed();
    }

    function test_referenceOutsideSignedRange() public {
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(100e6, 70e6, 102);
        o[0].minSqrtPriceX96 = TickMath.getSqrtPriceAtTick(1);
        s[0] = _sign(AK, hook.orderDigest(o[0], false));
        vm.expectRevert("SIGNED_PRICE");
        router.executeBatch(key, o, s);
        assertFalse(hook.nonceUsed(alice, 0, o[0].nonce));
    }

    function test_chainChangeInvalidatesSignature() public {
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(100e6, 70e6, 103);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(MixedAuthorization.InvalidAuthorization.selector);
        router.executeBatch(key, o, s);
    }

    function test_cancelIsNamespaceIsolated() public {
        vm.prank(alice);
        hook.cancelNonce(MixedTypes.BATCH_ORDER, bytes32(uint256(104)));
        MixedTypes.Order memory o = _order(alice, true, 1e6, 104);
        router.executeDirectSwap(key, o, _sign(AK, hook.orderDigest(o, true)));
        assertTrue(hook.nonceUsed(alice, 0, o.nonce));
        assertTrue(hook.nonceUsed(alice, 1, o.nonce));
    }

    function test_otherRouterCannotModifyPositionOrDonate() public {
        PoolModifyLiquidityTest other = new PoolModifyLiquidityTest(manager);
        vm.expectRevert();
        other.modifyLiquidity(key, ModifyLiquidityParams(-1000, 1000, 1000, bytes32(0)), "");
        PoolDonateTest donor = new PoolDonateTest(manager);
        vm.expectRevert();
        donor.donate(key, 1, 1, "");
    }

    function test_collectCannotUseExitSignature() public {
        MixedTypes.LiquidityAuthorization memory a = _lp(MixedTypes.LP_EXIT, 0, 105);
        bytes memory s = _sign(AK, hook.liquidityDigest(a));
        vm.prank(alice);
        vm.expectRevert();
        lp.modify(key, a, s);
        assertFalse(hook.nonceUsed(alice, 4, a.nonce));
    }

    function test_allowanceIsIndependentOfOrderAuthorization() public {
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(100e6, 70e6, 106);
        vm.prank(alice);
        t0.approve(address(router), 0);
        vm.expectRevert();
        router.executeBatch(key, o, s);
        assertFalse(hook.nonceUsed(alice, 0, o[0].nonce));
        _closed();
    }
}
