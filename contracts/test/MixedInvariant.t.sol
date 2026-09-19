// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {Test} from "forge-std/Test.sol";
import {MixedExecutionTest} from "./MixedExecution.t.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {MixedHook} from "../src/mixed/MixedHook.sol";
import {MixedExecutionRouter} from "../src/mixed/MixedExecutionRouter.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

contract MixedStateHandler is Test {
    MixedHook public h;
    MixedExecutionRouter public r;
    PoolKey private key;
    MockERC20 private t0;
    MockERC20 private t1;
    uint256 public calls;
    uint256 public successes;
    uint256 public rollbacks;
    uint256 public cancellations;
    address private a;
    address private b;

    constructor(MixedHook hook, MixedExecutionRouter router, PoolKey memory k, MockERC20 x, MockERC20 y) {
        h = hook;
        r = router;
        key = k;
        t0 = x;
        t1 = y;
        a = vm.addr(0xA11CE);
        b = vm.addr(0xB0B);
    }

    function step(uint256 seed) external {
        uint256 n = ++calls + 1000;
        uint128 amount = uint128(10000 + seed % 1000000);
        MixedTypes.Order[] memory o = new MixedTypes.Order[](2);
        bytes[] memory sig = new bytes[](2);
        o[0] = MixedTypes.Order(
            a,
            h.supportedPoolId(),
            bytes32(uint256(1)),
            1,
            true,
            amount,
            0,
            amount,
            h.oracle().lower(),
            h.oracle().upper(),
            uint64(block.timestamp + 1000),
            bytes32(n)
        );
        o[1] = MixedTypes.Order(
            b,
            h.supportedPoolId(),
            bytes32(uint256(1)),
            1,
            false,
            amount * 7 / 10,
            0,
            amount * 7 / 10,
            h.oracle().lower(),
            h.oracle().upper(),
            uint64(block.timestamp + 1000),
            bytes32(n)
        );
        if (seed % 4 == 1) o[0].minAmountOut = amount * 2;
        if (seed % 4 == 2) {
            vm.prank(a);
            h.cancelNonce(0, bytes32(n));
            cancellations++;
        }
        sig[0] = _sign(0xA11CE, h.orderDigest(o[0], false));
        sig[1] = _sign(0xB0B, h.orderDigest(o[1], false));
        if (seed % 4 == 3) sig[0] = _sign(0xB0B, h.orderDigest(o[0], false));
        bytes32 before = _balances();
        (bool ok,) = address(r).call(abi.encodeCall(r.executeBatch, (key, o, sig)));
        if (seed % 4 == 0) {
            require(ok, "VALID_EXECUTION_FAILED");
            successes++;
            require(h.nonceUsed(a, 0, bytes32(n)) && h.nonceUsed(b, 0, bytes32(n)), "NONCE_NOT_CONSUMED");
        } else {
            require(!ok, "INVALID_EXECUTION_SUCCEEDED");
            rollbacks++;
            require(_balances() == before, "FAILED_TX_BALANCES");
            require(!h.nonceUsed(b, 0, bytes32(n)), "FAILED_TX_NONCE");
            require(h.nonceUsed(a, 0, bytes32(n)) == (seed % 4 == 2), "CANCEL_ROLLBACK");
        }
        if (ok) {
            bytes32 settled = _balances();
            (bool replay,) = address(r).call(abi.encodeCall(r.executeBatch, (key, o, sig)));
            require(!replay && settled == _balances(), "REPLAY");
        }
        require(!h.executionActive() && !r.executionActive(), "OPEN_CONTEXT");
        require(!h.nonceUsed(a, 1, bytes32(n)), "NAMESPACE_LEAK");
    }

    function _sign(uint256 pk, bytes32 digest) private pure returns (bytes memory) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(rr, s, v);
    }

    function _balances() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                t0.balanceOf(a),
                t1.balanceOf(a),
                t0.balanceOf(b),
                t1.balanceOf(b),
                t0.balanceOf(address(r.poolManager())),
                t1.balanceOf(address(r.poolManager()))
            )
        );
    }
}

contract MixedInvariantTest is MixedExecutionTest {
    MixedStateHandler private handler;

    function setUp() public override {
        super.setUp();
        handler = new MixedStateHandler(hook, router, key, t0, t1);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = handler.step.selector;
        targetSelector(FuzzSelector(address(handler), selectors));
    }

    function invariant_conservationCustodyAndClosedContext() public view {
        _closed();
        assertEq(t0.balanceOf(alice) + t0.balanceOf(bob) + t0.balanceOf(address(manager)), t0.totalSupply());
        assertEq(t1.balanceOf(alice) + t1.balanceOf(bob) + t1.balanceOf(address(manager)), t1.totalSupply());
        assertEq(t0.balanceOf(address(lp)), 0);
        assertEq(t1.balanceOf(address(lp)), 0);
        assertEq(handler.calls(), handler.successes() + handler.rollbacks());
    }
}
