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

import {SessionLib} from "./libraries/SessionLib.sol";
import {ICNFIssuer} from "./interfaces/ICNFIssuer.sol";
import {IPolicyRegistry} from "./interfaces/IPolicyRegistry.sol";

interface IERC1271 {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4);
}

/// @title ComplianceHook
/// @notice Uniswap v4 hook that gates swap and liquidity actions behind ILAL compliance credentials.
///
/// Deployment requirement — the hook address must have these bits set in its LSBs:
///   beforeSwap            bit 7  → 0x0080
///   beforeAddLiquidity    bit 11 → 0x0800
///   beforeRemoveLiquidity bit 9  → 0x0200
///   Required address mask: 0x0A80
///
/// On every gated action the hook:
///   1. Decodes (SessionToken, signature) from hookData
///   2. Validates deadline, chainId, hook address, poolId, action
///   3. Verifies the signature — EOA via ecrecover, smart wallets via ERC-1271
///   4. For swaps/adds, checks pool policy and CNFIssuer.isValid(token.user)
///   5. For removes, preserves a signed ownership-only exit regardless of mutable policy state
///   6. Consumes the session nonce (Permit2-style bitmap — one-time use)
contract ComplianceHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using BeforeSwapDeltaLibrary for BeforeSwapDelta;
    using LPFeeLibrary for uint24;

    bytes4 private constant ERC1271_MAGIC = 0x1626ba7e;
    uint24 public constant VERIFIED_FLOW_FEE = 500; // 0.05%, denominated in hundredths of a bip.

    // ─── Errors ───────────────────────────────────────────────────────────────

    error OnlyPoolManager();
    error SessionExpired();
    error SessionChainIdMismatch();
    error SessionHookMismatch();
    error SessionPoolMismatch();
    error SessionActionMismatch();
    error SessionCallerMismatch();
    error SessionSignatureInvalid();
    error CredentialInvalid();
    error CredentialTypeMismatch();
    error PolicyNotConfigured();
    error PolicyIssuerMismatch();
    error NonceAlreadyUsed();
    error RouterNotAuthorized();
    error NotImplemented();

    // ─── Events ──────────────────────────────────────────────────────────────

    event VerifiedFlowFeeApplied(bytes32 indexed poolId, address indexed user, uint24 fee);

    // ─── Immutables ───────────────────────────────────────────────────────────

    IPoolManager public immutable poolManager;
    IPolicyRegistry public immutable policyRegistry;
    address public immutable authorizedRouter;
    bytes32 public immutable domainSeparator;

    // ─── Storage ──────────────────────────────────────────────────────────────

    // Permit2-style nonce bitmap. nonce bytes32 layout:
    //   upper 248 bits (nonce >> 8) = word position
    //   lower 8 bits  (nonce & 0xff) = bit position within that word
    mapping(address => mapping(uint256 => uint256)) public nonceBitmap;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(IPoolManager _poolManager, IPolicyRegistry _policyRegistry, address _authorizedRouter) {
        poolManager = _poolManager;
        policyRegistry = _policyRegistry;
        authorizedRouter = _authorizedRouter;
        domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ILAL ComplianceHook"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    // ─── Active hooks ─────────────────────────────────────────────────────────

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata, bytes calldata hookData)
        external
        override
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        bytes32 poolId = PoolId.unwrap(key.toId());
        address user = _verifySession(sender, poolId, SessionLib.ACTION_SWAP, hookData);
        uint24 feeOverride = _verifiedFlowFee(key.fee, poolId, user);
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, feeOverride);
    }

    function beforeAddLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4) {
        _verifySession(sender, PoolId.unwrap(key.toId()), SessionLib.ACTION_ADD_LIQUIDITY, hookData);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(
        address sender,
        PoolKey calldata key,
        ModifyLiquidityParams calldata,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4) {
        _verifySession(sender, PoolId.unwrap(key.toId()), SessionLib.ACTION_REMOVE_LIQUIDITY, hookData);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    // ─── Inactive hooks (address bits not set) ────────────────────────────────

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        revert NotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
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

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _verifySession(address caller, bytes32 poolId, uint8 action, bytes calldata hookData)
        internal
        returns (address user)
    {
        (SessionLib.SessionToken memory token, bytes memory sig) =
            abi.decode(hookData, (SessionLib.SessionToken, bytes));

        if (caller != authorizedRouter) revert RouterNotAuthorized();
        if (block.timestamp > token.deadline) revert SessionExpired();
        if (token.authorizedCaller != caller) revert SessionCallerMismatch();
        if (token.chainId != block.chainid) revert SessionChainIdMismatch();
        if (token.verifyingHook != address(this)) revert SessionHookMismatch();
        if (token.poolId != poolId) revert SessionPoolMismatch();
        if (token.action != action) revert SessionActionMismatch();

        bytes32 h = SessionLib.digest(token, domainSeparator);
        _checkSignature(token.user, h, sig);

        bool isExit = action == SessionLib.ACTION_REMOVE_LIQUIDITY;
        // Removing liquidity is an ownership operation, not new risk admission.
        // It remains bound to the fixed router, user signature, hook, pool, action
        // and nonce, while deliberately ignoring mutable policy/credential state.
        // This prevents issuer rotation, policy shutdown, expiry or revocation from
        // trapping principal that the same user previously supplied.
        if (!isExit) {
            IPolicyRegistry.Policy memory policy = policyRegistry.getPolicy(poolId);
            if (!policy.enabled || policy.cnfIssuer == address(0)) revert PolicyNotConfigured();
            if (policy.cnfIssuer != token.cnfIssuer) revert PolicyIssuerMismatch();
            if (!ICNFIssuer(token.cnfIssuer).isValid(token.user)) revert CredentialInvalid();
            uint256 tokenId = ICNFIssuer(token.cnfIssuer).credentialOf(token.user);
            ICNFIssuer.Credential memory credential = ICNFIssuer(token.cnfIssuer).getCredential(tokenId);
            if (credential.credentialType != policy.requiredCredentialType) revert CredentialTypeMismatch();
        }

        _useNonce(token.user, token.nonce);
        user = token.user;
    }

    function _verifiedFlowFee(uint24 poolFee, bytes32 poolId, address user) internal returns (uint24) {
        if (!poolFee.isDynamicFee()) return 0;
        emit VerifiedFlowFeeApplied(poolId, user, VERIFIED_FLOW_FEE);
        return VERIFIED_FLOW_FEE | LPFeeLibrary.OVERRIDE_FEE_FLAG;
    }

    /// @dev Accepts EOA (65-byte ECDSA) or ERC-1271 smart wallet signatures.
    function _checkSignature(address user, bytes32 h, bytes memory sig) internal view {
        if (sig.length == 65) {
            address recovered = SessionLib.recoverFromDigest(h, sig);
            if (recovered != address(0) && recovered == user) return;
        }
        // ERC-1271 fallback for smart wallets
        if (user.code.length > 0) {
            try IERC1271(user).isValidSignature(h, sig) returns (bytes4 magic) {
                if (magic == ERC1271_MAGIC) return;
            } catch {}
        }
        revert SessionSignatureInvalid();
    }

    /// @dev Marks nonce as used. Reverts if already consumed (replay protection).
    function _useNonce(address user, bytes32 nonce) internal {
        uint256 wordPos = uint256(nonce) >> 8;
        uint256 bitPos = uint256(nonce) & 0xff;
        uint256 mask = uint256(1) << bitPos;
        uint256 word = nonceBitmap[user][wordPos];
        if (word & mask != 0) revert NonceAlreadyUsed();
        nonceBitmap[user][wordPos] = word | mask;
    }
}
