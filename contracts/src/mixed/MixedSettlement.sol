// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

library MixedSettlement {
    using SafeERC20 for IERC20;

    function fund(IPoolManager manager, Currency currency, address user, uint256 amount) internal {
        if (amount == 0) return;
        manager.sync(currency);
        IERC20(Currency.unwrap(currency)).safeTransferFrom(user, address(manager), amount);
        require(manager.settle() == amount, "NONSTANDARD_TRANSFER");
    }

    function pay(IPoolManager manager, Currency currency, address user, uint256 amount) internal {
        if (amount > 0) manager.take(currency, user, amount);
    }
}
