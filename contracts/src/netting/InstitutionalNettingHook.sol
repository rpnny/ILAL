// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

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

import {ICNFIssuer} from "../interfaces/ICNFIssuer.sol";
import {IPolicyRegistry} from "../interfaces/IPolicyRegistry.sol";
import {NettingTypes} from "./NettingTypes.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

interface IBatchRouterStatus {
    function batchUnlockActive() external view returns (bool);
}

/// @title InstitutionalNettingHook
/// @notice Atomically matches verified, signed stablecoin orders at raw-unit 1:1 and sends only residuals to v4.
contract InstitutionalNettingHook is IHooks {
    using PoolIdLibrary for PoolKey;

    uint160 public constant REQUIRED_HOOK_FLAGS = Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    uint256 public constant MIN_BATCH_SIZE = 2;
    uint256 public constant MAX_BATCH_SIZE = 16;
    bytes4 private constant ERC1271_MAGIC = IERC1271.isValidSignature.selector;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    error OnlyPoolManager();
    error OnlyBatchRouter();
    error NotInsideBatchUnlock();
    error InvalidPoolManager();
    error InvalidPolicyRegistry();
    error InvalidTokenPair();
    error TokenDecimalsMismatch();
    error InvalidPoolConfiguration();
    error InvalidMaxTick();
    error UnsupportedPool();
    error BatchAlreadyActive();
    error BatchNotActive();
    error InvalidBatchSize();
    error InvalidBatchHeader();
    error MissingOppositeDirection();
    error PegTickExceeded(int24 tick, int24 maxAbsTick);
    error ExactOutputNotSupported();
    error InvalidAmount();
    error InvalidOrder();
    error OrderExpired();
    error InvalidSignature();
    error PolicyNotConfigured();
    error CredentialInvalid();
    error CredentialTypeMismatch();
    error NonceAlreadyUsed();
    error AmmInputLimitExceeded(uint256 ammInput, uint256 maximum);
    error BatchAccountingMismatch();
    error NotImplemented();

    event OrderNetted(
        bytes32 indexed batchId,
        uint256 indexed orderIndex,
        address indexed user,
        bool zeroForOne,
        uint256 amountIn,
        uint256 matchedInput,
        uint256 ammInput
    );
    event BatchNetted(
        bytes32 indexed batchId,
        uint256 total0,
        uint256 total1,
        uint256 matchedEachSide,
        uint256 residual0,
        uint256 residual1,
        uint256 exposureReduction
    );
    event NonceCancelled(address indexed user, bytes32 indexed nonce);

    IPoolManager public immutable poolManager;
    IPolicyRegistry public immutable policyRegistry;
    address public immutable authorizedRouter;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable poolFee;
    int24 public immutable poolTickSpacing;
    int24 public immutable maxAbsTick;
    bytes32 public immutable supportedPoolId;
    bytes32 public immutable domainSeparator;

    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

    struct BatchContext {
        bytes32 batchId;
        bytes32 observedCommitment;
        uint256 total0;
        uint256 total1;
        uint256 matchedEachSide;
        uint256 remainingMatch0;
        uint256 remainingMatch1;
        uint256 observed0;
        uint256 observed1;
        uint256 observedMatched0;
        uint256 observedMatched1;
        uint256 nextIndex;
        uint256 orderCount;
        bool active;
    }

    BatchContext public currentBatch;

    constructor(
        IPoolManager _poolManager,
        IPolicyRegistry _policyRegistry,
        address _authorizedRouter,
        address _token0,
        address _token1,
        uint24 _poolFee,
        int24 _poolTickSpacing,
        int24 _maxAbsTick
    ) {
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
        if (address(_poolManager).code.length == 0) revert InvalidPoolManager();
        if (address(_policyRegistry).code.length == 0) revert InvalidPolicyRegistry();
        if (_authorizedRouter.code.length == 0) revert OnlyBatchRouter();
        if (_token0 == address(0) || _token0 >= _token1) revert InvalidTokenPair();
        if (IERC20Decimals(_token0).decimals() != IERC20Decimals(_token1).decimals()) {
            revert TokenDecimalsMismatch();
        }
        if (_authorizedRouter == address(0)) revert OnlyBatchRouter();
        if (_poolFee != 500 || _poolTickSpacing != 10) revert InvalidPoolConfiguration();
        if (_maxAbsTick <= 0) revert InvalidMaxTick();

        poolManager = _poolManager;
        policyRegistry = _policyRegistry;
        authorizedRouter = _authorizedRouter;
        token0 = _token0;
        token1 = _token1;
        poolFee = _poolFee;
        poolTickSpacing = _poolTickSpacing;
        maxAbsTick = _maxAbsTick;

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(_token0),
            currency1: Currency.wrap(_token1),
            fee: _poolFee,
            tickSpacing: _poolTickSpacing,
            hooks: IHooks(address(this))
        });
        supportedPoolId = PoolId.unwrap(key.toId());
        domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("ILAL Institutional Netting"), keccak256("1"), block.chainid, address(this)
            )
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    modifier onlyBatchRouter() {
        if (msg.sender != authorizedRouter) revert OnlyBatchRouter();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory permissions) {
        permissions.beforeSwap = true;
        permissions.beforeSwapReturnDelta = true;
    }

    function hashOrder(NettingTypes.NettingOrder calldata order) public pure returns (bytes32) {
        return NettingTypes.hash(order);
    }

    function orderDigest(NettingTypes.NettingOrder calldata order) external view returns (bytes32) {
        return _digest(NettingTypes.hash(order));
    }

    function nonceUsed(address user, bytes32 nonce) public view returns (bool) {
        (uint256 wordPos, uint256 mask) = _noncePosition(nonce);
        return nonceBitmap[user][wordPos] & mask != 0;
    }

    function batchActive() external view returns (bool) {
        return currentBatch.active;
    }

    function cancelNonce(bytes32 nonce) external {
        _useNonce(msg.sender, nonce);
        emit NonceCancelled(msg.sender, nonce);
    }

    function openBatch(
        NettingTypes.BatchHeader calldata header,
        NettingTypes.NettingOrder[] calldata orders,
        bytes[] calldata signatures
    ) external onlyBatchRouter {
        if (!IBatchRouterStatus(authorizedRouter).batchUnlockActive()) {
            revert NotInsideBatchUnlock();
        }
        if (currentBatch.active) revert BatchAlreadyActive();
        uint256 length = orders.length;
        if (length < MIN_BATCH_SIZE || length > MAX_BATCH_SIZE || signatures.length != length) {
            revert InvalidBatchSize();
        }

        // This is deliberately a batch-start depeg guard, not an oracle or a
        // continuously enforced post-swap price bound.
        (, int24 tick,,) = StateLibrary.getSlot0(poolManager, PoolId.wrap(supportedPoolId));
        if (tick > maxAbsTick || tick < -maxAbsTick) revert PegTickExceeded(tick, maxAbsTick);

        // The immutable Router canonicalizes order/signature pairs. Requiring the
        // strict order again here makes allocation a Hook-enforced protocol rule.
        NettingTypes.NettingOrder[] memory orderCopies = orders;
        NettingTypes.BatchHeader memory expected = NettingTypes.preview(orderCopies);
        if (!_headersEqual(header, expected)) revert InvalidBatchHeader();
        if (header.total0 == 0 || header.total1 == 0) revert MissingOppositeDirection();

        for (uint256 i; i < length; ++i) {
            _validateOrder(orders[i], signatures[i]);
        }

        currentBatch = BatchContext({
            batchId: header.batchId,
            observedCommitment: bytes32(0),
            total0: header.total0,
            total1: header.total1,
            matchedEachSide: header.matchedEachSide,
            remainingMatch0: header.matchedEachSide,
            remainingMatch1: header.matchedEachSide,
            observed0: 0,
            observed1: 0,
            observedMatched0: 0,
            observedMatched1: 0,
            nextIndex: 0,
            orderCount: length,
            active: true
        });
    }

    function closeBatch(NettingTypes.BatchHeader calldata header) external onlyBatchRouter {
        if (!IBatchRouterStatus(authorizedRouter).batchUnlockActive()) revert NotInsideBatchUnlock();
        BatchContext memory context = currentBatch;
        if (!context.active) revert BatchNotActive();
        if (
            !_contextMatchesHeader(context, header) || context.nextIndex != context.orderCount
                || context.observedCommitment != context.batchId || context.observed0 != context.total0
                || context.observed1 != context.total1 || context.observedMatched0 != context.matchedEachSide
                || context.observedMatched1 != context.matchedEachSide || context.remainingMatch0 != 0
                || context.remainingMatch1 != 0
        ) revert BatchAccountingMismatch();

        emit BatchNetted(
            header.batchId,
            header.total0,
            header.total1,
            header.matchedEachSide,
            header.residual0,
            header.residual1,
            header.exposureReduction
        );
        delete currentBatch;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (sender != authorizedRouter) revert OnlyBatchRouter();
        if (PoolId.unwrap(key.toId()) != supportedPoolId) revert UnsupportedPool();
        if (params.amountSpecified >= 0) revert ExactOutputNotSupported();

        BatchContext storage context = currentBatch;
        if (!context.active) revert BatchNotActive();
        (bytes32 batchId, uint256 orderIndex, NettingTypes.NettingOrder memory order) =
            abi.decode(hookData, (bytes32, uint256, NettingTypes.NettingOrder));
        uint256 amountIn = uint256(-params.amountSpecified);
        if (
            batchId != context.batchId || orderIndex != context.nextIndex || order.poolId != supportedPoolId
                || order.zeroForOne != params.zeroForOne || order.amountIn != amountIn
        ) revert InvalidOrder();

        uint256 remaining = order.zeroForOne ? context.remainingMatch0 : context.remainingMatch1;
        uint256 matchedInput = amountIn < remaining ? amountIn : remaining;
        uint256 ammInput = amountIn - matchedInput;
        if (ammInput > order.maxAmmInput) revert AmmInputLimitExceeded(ammInput, order.maxAmmInput);
        if (matchedInput > uint256(uint128(type(int128).max))) revert InvalidAmount();

        bytes32 orderHash = NettingTypes.hash(order);
        context.observedCommitment = keccak256(abi.encodePacked(context.observedCommitment, orderHash));
        context.nextIndex = orderIndex + 1;
        if (order.zeroForOne) {
            context.remainingMatch0 = remaining - matchedInput;
            context.observed0 += amountIn;
            context.observedMatched0 += matchedInput;
        } else {
            context.remainingMatch1 = remaining - matchedInput;
            context.observed1 += amountIn;
            context.observedMatched1 += matchedInput;
        }

        emit OrderNetted(batchId, orderIndex, order.user, order.zeroForOne, amountIn, matchedInput, ammInput);
        return (
            IHooks.beforeSwap.selector,
            toBeforeSwapDelta(int128(uint128(matchedInput)), -int128(uint128(matchedInput))),
            0
        );
    }

    function _validateOrder(NettingTypes.NettingOrder calldata order, bytes calldata signature) internal {
        if (order.user == address(0) || order.poolId != supportedPoolId) revert InvalidOrder();
        if (order.amountIn == 0 || order.amountIn > uint128(type(int128).max)) revert InvalidAmount();
        if (block.timestamp > order.deadline) revert OrderExpired();
        _checkSignature(order.user, _digest(NettingTypes.hash(order)), signature);

        IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(supportedPoolId);
        if (!policy.enabled || policy.cnfIssuer == address(0)) revert PolicyNotConfigured();
        ICNFIssuer issuer = ICNFIssuer(policy.cnfIssuer);
        if (!issuer.isValid(order.user)) revert CredentialInvalid();
        uint256 credentialId = issuer.credentialOf(order.user);
        ICNFIssuer.Credential memory credential = issuer.getCredential(credentialId);
        if (credential.credentialType != policy.requiredCredentialType) revert CredentialTypeMismatch();
        _useNonce(order.user, order.nonce);
    }

    function _checkSignature(address user, bytes32 digest, bytes calldata signature) internal view {
        if (user.code.length == 0) {
            (address recovered, ECDSA.RecoverError error,) = ECDSA.tryRecoverCalldata(digest, signature);
            if (error == ECDSA.RecoverError.NoError && recovered == user) return;
        } else {
            try IERC1271(user).isValidSignature(digest, signature) returns (bytes4 magic) {
                if (magic == ERC1271_MAGIC) return;
            } catch {}
        }
        revert InvalidSignature();
    }

    function _digest(bytes32 orderHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, orderHash));
    }

    function _useNonce(address user, bytes32 nonce) internal {
        (uint256 wordPos, uint256 mask) = _noncePosition(nonce);
        uint256 word = nonceBitmap[user][wordPos];
        if (word & mask != 0) revert NonceAlreadyUsed();
        nonceBitmap[user][wordPos] = word | mask;
    }

    function _noncePosition(bytes32 nonce) internal pure returns (uint256 wordPos, uint256 mask) {
        uint256 value = uint256(nonce);
        wordPos = value >> 8;
        mask = uint256(1) << (value & 0xff);
    }

    function _headersEqual(NettingTypes.BatchHeader calldata a, NettingTypes.BatchHeader memory b)
        internal
        pure
        returns (bool)
    {
        return a.batchId == b.batchId && a.orderCount == b.orderCount && a.total0 == b.total0 && a.total1 == b.total1
            && a.matchedEachSide == b.matchedEachSide && a.residual0 == b.residual0 && a.residual1 == b.residual1
            && a.exposureReduction == b.exposureReduction;
    }

    function _contextMatchesHeader(BatchContext memory context, NettingTypes.BatchHeader calldata header)
        internal
        pure
        returns (bool)
    {
        return context.batchId == header.batchId && context.orderCount == header.orderCount
            && context.total0 == header.total0 && context.total1 == header.total1
            && context.matchedEachSide == header.matchedEachSide
            && header.residual0 == header.total0 - header.matchedEachSide
            && header.residual1 == header.total1 - header.matchedEachSide
            && header.exposureReduction == header.matchedEachSide * 2;
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        revert NotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        revert NotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        override
        returns (bytes4, int128)
    {
        revert NotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert NotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert NotImplemented();
    }
}
