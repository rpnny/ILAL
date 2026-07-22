// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";

import {SessionLib} from "../libraries/SessionLib.sol";
import {IEligibilityPolicyRegistryV2} from "./IEligibilityPolicyRegistryV2.sol";
import {IPolicyGrantManagerV2} from "./IPolicyGrantManagerV2.sol";
import {SessionLibV2} from "./SessionLibV2.sol";

interface IERC1271V2 {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4);
}

/// @notice Versioned Uniswap v4 Hook for cached private eligibility grants.
/// @dev This contract is isolated from the currently deployed v1 Hook.
contract ComplianceHookV2 is IHooks {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using LPFeeLibrary for uint24;

    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    uint24 public constant VERIFIED_FLOW_FEE = 500;

    error InvalidAddress();
    error OnlyPoolManager();
    error RouterNotAuthorized();
    error SessionExpired();
    error SessionCallerMismatch();
    error SessionChainIdMismatch();
    error SessionHookMismatch();
    error SessionPoolMismatch();
    error SessionActionMismatch();
    error SessionPolicyMismatch();
    error SessionPolicyRevisionMismatch();
    error SessionSignatureInvalid();
    error PolicyNotConfigured();
    error PolicyGrantInvalid();
    error NonceAlreadyUsed();
    error NotImplemented();

    event VerifiedPolicyFlowFeeApplied(
        bytes32 indexed poolId, address indexed user, uint256 indexed policyHash, uint24 fee
    );

    IPoolManager public immutable poolManager;
    IEligibilityPolicyRegistryV2 public immutable policyRegistry;
    IPolicyGrantManagerV2 public immutable grantManager;
    address public immutable authorizedRouter;
    bytes32 public immutable domainSeparator;

    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

    constructor(
        IPoolManager _poolManager,
        IEligibilityPolicyRegistryV2 _policyRegistry,
        IPolicyGrantManagerV2 _grantManager,
        address _authorizedRouter
    ) {
        if (
            address(_poolManager) == address(0) || address(_policyRegistry) == address(0)
                || address(_grantManager) == address(0) || _authorizedRouter == address(0)
        ) revert InvalidAddress();
        poolManager = _poolManager;
        policyRegistry = _policyRegistry;
        grantManager = _grantManager;
        authorizedRouter = _authorizedRouter;
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ILAL ComplianceHook"),
                keccak256("2"),
                block.chainid,
                address(this)
            )
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata hookData)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        (address user, uint256 policyHash) = _verifySession(sender, poolId, SessionLibV2.ACTION_SWAP, hookData);
        uint24 feeOverride = _verifiedFlowFee(key.fee, poolId, user, policyHash);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeOverride);
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4) {
        _verifySession(sender, PoolId.unwrap(key.toId()), SessionLibV2.ACTION_ADD_LIQUIDITY, hookData);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4) {
        _verifySession(sender, PoolId.unwrap(key.toId()), SessionLibV2.ACTION_REMOVE_LIQUIDITY, hookData);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function _verifySession(address caller, bytes32 poolId, uint8 action, bytes calldata hookData)
        internal
        returns (address user, uint256 policyHash)
    {
        (SessionLibV2.SessionTokenV2 memory token, bytes memory signature) =
            abi.decode(hookData, (SessionLibV2.SessionTokenV2, bytes));

        if (caller != authorizedRouter) revert RouterNotAuthorized();
        if (block.timestamp > token.deadline) revert SessionExpired();
        if (token.authorizedCaller != caller) revert SessionCallerMismatch();
        if (token.chainId != block.chainid) revert SessionChainIdMismatch();
        if (token.verifyingHook != address(this)) revert SessionHookMismatch();
        if (token.poolId != poolId) revert SessionPoolMismatch();
        if (token.action != action) revert SessionActionMismatch();

        bytes32 digest = SessionLibV2.digest(token, domainSeparator);
        _checkSignature(token.user, digest, signature);

        bool isExit = action == SessionLibV2.ACTION_REMOVE_LIQUIDITY;
        if (!isExit) {
            IEligibilityPolicyRegistryV2.EligibilityPolicy memory policy = policyRegistry.getEligibilityPolicy(poolId);
            if (!policy.enabled || policy.revision == 0) revert PolicyNotConfigured();
            if (token.policyHash != policy.policyHash) revert SessionPolicyMismatch();
            if (token.policyRevision != policy.revision) revert SessionPolicyRevisionMismatch();
            if (!grantManager.isPolicyGrantValid(poolId, token.user)) revert PolicyGrantInvalid();
        }

        _useNonce(token.user, token.nonce);
        return (token.user, token.policyHash);
    }

    function _checkSignature(address user, bytes32 digest, bytes memory signature) internal view {
        if (signature.length == 65) {
            address recovered = SessionLib.recoverFromDigest(digest, signature);
            if (recovered != address(0) && recovered == user) return;
        }
        if (user.code.length > 0) {
            try IERC1271V2(user).isValidSignature(digest, signature) returns (bytes4 magic) {
                if (magic == ERC1271_MAGIC) return;
            } catch {}
        }
        revert SessionSignatureInvalid();
    }

    function _useNonce(address user, bytes32 nonce) internal {
        uint256 wordPos = uint256(nonce) >> 8;
        uint256 bitPos = uint256(nonce) & 0xff;
        uint256 mask = uint256(1) << bitPos;
        uint256 word = nonceBitmap[user][wordPos];
        if (word & mask != 0) revert NonceAlreadyUsed();
        nonceBitmap[user][wordPos] = word | mask;
    }

    function _verifiedFlowFee(uint24 poolFee, bytes32 poolId, address user, uint256 policyHash)
        internal
        returns (uint24)
    {
        if (!poolFee.isDynamicFee()) return 0;
        emit VerifiedPolicyFlowFeeApplied(poolId, user, policyHash, VERIFIED_FLOW_FEE);
        return VERIFIED_FLOW_FEE | LPFeeLibrary.OVERRIDE_FEE_FLAG;
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert NotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert NotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert NotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        revert NotImplemented();
    }
}
