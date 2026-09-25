// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {MixedTypes} from "./MixedTypes.sol";
import {MatchingMath} from "./MatchingMath.sol";
import {MixedAuthorization} from "./MixedAuthorization.sol";
import {MixedOracleGuard} from "./MixedOracleGuard.sol";
import {IMixedEligibility} from "./IMixedEligibility.sol";

interface IMixedRouterContext {
    function executionActive() external view returns (bool);
}

interface IMixedQuoteContext {
    function quoting() external view returns (bool);
}

interface IMixedDecimals {
    function decimals() external view returns (uint8);
}

contract MixedHook is IHooks, MixedAuthorization {
    using PoolIdLibrary for PoolKey;

    struct Config {
        IPoolManager manager;
        MixedOracleGuard oracle;
        IMixedEligibility eligibility;
        address executionRouter;
        address liquidityRouter;
    }

    struct Context {
        bytes32 commitment;
        uint160 referencePrice;
        uint8 count;
        uint8 next;
        bool direct;
        MatchingMath.Budget budget;
    }
    IPoolManager public immutable poolManager;
    MixedOracleGuard public immutable oracle;
    IMixedEligibility public immutable eligibility;
    address public immutable executionRouter;
    address public immutable liquidityRouter;
    bytes32 public immutable supportedPoolId;
    Context public current;
    mapping(uint256 => bytes32) private _hashes;
    mapping(uint256 => MatchingMath.Allocation) private _allocations;
    bytes32 private constant ACTIVE_SLOT = keccak256("ilal.mixed.hook.active");
    event ExecutionOpened(bytes32 indexed commitment, uint160 referencePrice, bool direct);
    event ExecutionClosed(bytes32 indexed commitment, bytes32 executionRecord, uint160 endingPrice);
    error UnauthorizedPath();
    error InvalidExecution();
    error Ineligible();

    constructor(Config memory c) MixedAuthorization("ILAL Mixed Hook") {
        require(
            address(c.manager).code.length > 0 && address(c.oracle).code.length > 0
                && address(c.eligibility).code.length > 0,
            "CONFIG"
        );
        require(c.executionRouter.code.length > 0 && c.liquidityRouter.code.length > 0, "ROUTERS");
        require(
            IMixedDecimals(c.oracle.token0()).decimals() == IMixedDecimals(c.oracle.token1()).decimals(), "DECIMALS"
        );
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
        poolManager = c.manager;
        oracle = c.oracle;
        eligibility = c.eligibility;
        executionRouter = c.executionRouter;
        liquidityRouter = c.liquidityRouter;
        supportedPoolId = PoolId.unwrap(
            PoolKey(Currency.wrap(c.oracle.token0()), Currency.wrap(c.oracle.token1()), 500, 10, IHooks(address(this)))
                .toId()
        );
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory p) {
        p.beforeSwap = true;
        p.beforeSwapReturnDelta = true;
        p.beforeAddLiquidity = true;
        p.beforeRemoveLiquidity = true;
        p.beforeDonate = true;
    }

    function executionActive() public view returns (bool result) {
        bytes32 slot = ACTIVE_SLOT;
        assembly ("memory-safe") { result := tload(slot) }
    }

    function _setActive(bool value) private {
        bytes32 slot = ACTIVE_SLOT;
        assembly ("memory-safe") { tstore(slot, value) }
    }

    function allocation(uint256 i) external view returns (MatchingMath.Allocation memory) {
        require(executionActive() && i < current.count, "CONTEXT");
        return _allocations[i];
    }

    function referencePrice() external view returns (uint160) {
        require(executionActive(), "CONTEXT");
        return current.referencePrice;
    }

    function orderDigest(MixedTypes.Order calldata o, bool direct) external view returns (bytes32) {
        return _hashTypedDataV4(MixedTypes.hashOrder(o, direct));
    }

    function liquidityDigest(MixedTypes.LiquidityAuthorization calldata a) external view returns (bytes32) {
        return _hashTypedDataV4(MixedTypes.hashLiquidity(a));
    }

    function openBatch(
        PoolKey calldata key,
        MixedTypes.Order[] calldata orders,
        bytes[] calldata signatures,
        bool direct
    ) external returns (bytes32 commitment) {
        if (
            msg.sender != executionRouter || !IMixedRouterContext(executionRouter).executionActive()
                || executionActive()
        ) revert UnauthorizedPath();
        _checkPool(key);
        uint256 n = orders.length;
        require(signatures.length == n && (direct ? n == 1 : n >= 2 && n <= 16), "COUNT");
        (uint160 s,,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(supportedPoolId));
        oracle.validate(s);
        bytes32[] memory hashes = new bytes32[](n);
        uint256 t0;
        uint256 t1;
        for (uint256 i; i < n; ++i) {
            MixedTypes.Order calldata o = orders[i];
            hashes[i] = MixedTypes.hashOrder(o, direct);
            _validateOrder(o, hashes[i], signatures[i], s, direct);
            if (o.zeroForOne) t0 += o.amountIn;
            else t1 += o.amountIn;
        }
        require(t0 <= MatchingMath.MAX_AMOUNT && t1 <= MatchingMath.MAX_AMOUNT, "TOTAL_BOUND");
        commitment = MixedTypes.commitment(hashes, address(this), supportedPoolId);
        MatchingMath.Budget memory b = direct ? MatchingMath.Budget(t0, t1, 0, 0) : MatchingMath.budget(t0, t1, s);
        current = Context(commitment, s, uint8(n), 0, direct, b);
        uint256 c0;
        uint256 c1;
        for (uint256 i; i < n; ++i) {
            MixedTypes.Order calldata o = orders[i];
            MatchingMath.Allocation memory a = direct
                ? MatchingMath.Allocation(0, 0, o.amountIn)
                : MatchingMath.allocate(b, o.zeroForOne, o.zeroForOne ? c0 : c1, o.amountIn);
            require(a.residual <= o.maxAmmInput && a.matchedOutput <= MatchingMath.MAX_AMOUNT, "ORDER_LIMIT");
            _allocations[i] = a;
            _hashes[i] = hashes[i];
            if (o.zeroForOne) c0 += o.amountIn;
            else c1 += o.amountIn;
        }
        _setActive(true);
        emit ExecutionOpened(commitment, s, direct);
    }

    function _validateOrder(MixedTypes.Order calldata o, bytes32 hash, bytes calldata sig, uint160 s, bool direct)
        private
    {
        require(o.poolId == supportedPoolId && o.amountIn > 0 && o.amountIn <= MatchingMath.MAX_AMOUNT, "ORDER");
        require(o.minSqrtPriceX96 <= s && s <= o.maxSqrtPriceX96, "SIGNED_PRICE");
        if (IMixedQuoteContext(executionRouter).quoting()) {
            require(o.user != address(0) && block.timestamp <= o.deadline, "QUOTE_ORDER");
        } else {
            _authorize(o.user, hash, o.deadline, sig);
        }
        if (!eligibility.isEligible(o.poolId, o.user, o.executionPolicyHash, o.policyRevision)) revert Ineligible();
        _consume(o.user, direct ? MixedTypes.DIRECT_SWAP : MixedTypes.BATCH_ORDER, o.nonce);
    }

    function closeBatch() external {
        if (msg.sender != executionRouter || !executionActive() || current.next != current.count) {
            revert InvalidExecution();
        }
        (uint160 end,,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(supportedPoolId));
        oracle.checkBand(end);
        bytes32 record = keccak256(abi.encode(current.commitment, current.referencePrice, current.budget));
        for (uint256 i; i < current.count; ++i) {
            record = keccak256(abi.encode(record, _hashes[i], _allocations[i]));
            delete _hashes[i];
            delete _allocations[i];
        }
        emit ExecutionClosed(current.commitment, record, end);
        delete current;
        _setActive(false);
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata data)
        external
        onlyManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _checkPool(key);
        if (sender != executionRouter || !executionActive() || !IMixedRouterContext(sender).executionActive()) {
            revert UnauthorizedPath();
        }
        (uint256 i, MixedTypes.Order memory o) = abi.decode(data, (uint256, MixedTypes.Order));
        require(
            i == current.next && i < current.count && MixedTypes.hashOrder(o, current.direct) == _hashes[i],
            "ORDER_CONTEXT"
        );
        require(
            params.zeroForOne == o.zeroForOne && params.amountSpecified == -int256(uint256(o.amountIn)), "SWAP_CONTEXT"
        );
        require(params.sqrtPriceLimitX96 == oracle.priceLimit(o.zeroForOne), "PRICE_LIMIT");
        current.next++;
        MatchingMath.Allocation memory a = _allocations[i];
        return (
            IHooks.beforeSwap.selector,
            toBeforeSwapDelta(int128(uint128(a.matchedInput)), -int128(uint128(a.matchedOutput))),
            0
        );
    }

    function _checkPool(PoolKey calldata key) private view {
        require(PoolId.unwrap(key.toId()) == supportedPoolId, "POOL");
    }
    modifier onlyManager() {
        if (msg.sender != address(poolManager)) revert UnauthorizedPath();
        _;
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata data
    ) external onlyManager returns (bytes4) {
        _liquidity(sender, key, params, data, true);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata params,
        bytes calldata data
    ) external onlyManager returns (bytes4) {
        _liquidity(sender, key, params, data, false);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function _liquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata p,
        bytes calldata data,
        bool adding
    ) private {
        _checkPool(key);
        if (sender != liquidityRouter || executionActive() || !IMixedRouterContext(sender).executionActive()) {
            revert UnauthorizedPath();
        }
        (MixedTypes.LiquidityAuthorization memory a, bytes memory sig) =
            abi.decode(data, (MixedTypes.LiquidityAuthorization, bytes));
        uint8 expected = p.liquidityDelta > 0
            ? MixedTypes.LP_ADD
            : p.liquidityDelta < 0 ? MixedTypes.LP_EXIT : MixedTypes.LP_COLLECT;
        require(
            adding == (expected == MixedTypes.LP_ADD) && a.action == expected && a.poolId == supportedPoolId,
            "LP_ACTION"
        );
        require(
            p.tickLower == a.tickLower && p.tickUpper == a.tickUpper && p.liquidityDelta == a.liquidityDelta
                && p.salt == MixedTypes.positionSalt(a.user, a.userSalt),
            "LP_POSITION"
        );
        _authorize(a.user, MixedTypes.hashLiquidity(a), a.deadline, sig);
        if (adding && !eligibility.isEligible(a.poolId, a.user, a.executionPolicyHash, a.policyRevision)) {
            revert Ineligible();
        }
        _consume(a.user, expected, a.nonce);
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert UnauthorizedPath();
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        revert UnauthorizedPath();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        revert UnauthorizedPath();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert UnauthorizedPath();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert UnauthorizedPath();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        override
        returns (bytes4, int128)
    {
        revert UnauthorizedPath();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert UnauthorizedPath();
    }
}
