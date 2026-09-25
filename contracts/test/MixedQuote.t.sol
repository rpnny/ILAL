// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {MixedExecutionFixture} from "./MixedExecution.t.sol";
import {MixedTypes} from "../src/mixed/MixedTypes.sol";
import {MixedExecutionRouter} from "../src/mixed/MixedExecutionRouter.sol";
import {MixedAuthorization} from "../src/mixed/MixedAuthorization.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract Mixed1271Wallet {
    address immutable owner;

    constructor(address who) {
        owner = who;
    }

    function approve(IERC20 token, address spender) external {
        require(msg.sender == owner);
        token.approve(spender, type(uint256).max);
    }

    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recover(digest, signature) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
}

contract MixedQuoteTest is MixedExecutionFixture {
    function test_unsignedQuoteAlwaysRollsBackAndCannotAuthorize() public {
        (MixedTypes.Order[] memory orders, bytes[] memory sig) = _batch(100e6, 70e6, 80);
        uint256 balance = t0.balanceOf(alice);
        vm.expectPartialRevert(MixedExecutionRouter.QuoteResult.selector);
        router.quoteBatch(key, orders, false);
        assertEq(t0.balanceOf(alice), balance);
        assertFalse(hook.nonceUsed(alice, 0, orders[0].nonce));
        assertFalse(router.quoting());
        _closed();
        bytes[] memory empty = new bytes[](2);
        vm.expectRevert(MixedAuthorization.InvalidAuthorization.selector);
        router.executeBatch(key, orders, empty);
        router.executeBatch(key, orders, sig);
        vm.expectRevert(MixedAuthorization.NonceUsed.selector);
        router.quoteBatch(key, orders, false);
    }

    function test_bindingCannotChangeAndWrongHookRejected() public {
        vm.expectRevert("BIND_ONCE");
        router.bindHook(hook);
        vm.expectRevert("BIND_ONCE");
        lp.bindHook(hook);
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(10e6, 10e6, 81);
        PoolKey memory wrong = key;
        wrong.hooks = IHooks(address(0x1234));
        vm.expectRevert("CANONICAL_HOOK");
        router.executeBatch(wrong, o, s);
        _closed();
    }

    function test_erc1271ReceivesOnlyItsOwnOutput() public {
        Mixed1271Wallet wallet = new Mixed1271Wallet(alice);
        t0.mint(address(wallet), 100e6);
        vm.prank(alice);
        wallet.approve(IERC20(address(t0)), address(router));
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(100e6, 100e6, 82);
        o[0].user = address(wallet);
        s[0] = _sign(AK, hook.orderDigest(o[0], false));
        router.executeBatch(key, o, s);
        assertEq(t1.balanceOf(address(wallet)), 100e6);
        assertEq(t0.balanceOf(address(wallet)), 0);
        _closed();
    }

    function test_accidentalTransfersAreNotUserRevenue() public {
        t0.mint(address(router), 777);
        t1.mint(address(hook), 999);
        (MixedTypes.Order[] memory o, bytes[] memory s) = _batch(100e6, 100e6, 83);
        uint256 before = t1.balanceOf(alice);
        router.executeBatch(key, o, s);
        assertEq(t1.balanceOf(alice) - before, 100e6);
        assertEq(t0.balanceOf(address(router)), 777);
        assertEq(t1.balanceOf(address(hook)), 999);
    }
}
