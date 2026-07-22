// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";

import {ComplianceHook} from "../src/ComplianceHook.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {SessionLib} from "../src/libraries/SessionLib.sol";
import {MockCNFIssuer} from "./mocks/MockCNFIssuer.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";

contract ComplianceHookTest is Test {
    using PoolIdLibrary for PoolKey;

    ComplianceHook internal hook;
    PolicyRegistry internal registry;
    MockCNFIssuer internal cnfIssuer;

    address internal poolManager = makeAddr("poolManager");
    address internal authorizedRouter = makeAddr("authorizedRouter");
    address internal admin = makeAddr("admin");

    uint256 internal traderKey;
    address internal trader;

    PoolKey internal poolKey;
    PoolKey internal dynamicFeeKey;
    bytes32 internal poolId;
    bytes32 internal dynamicFeePoolId;

    bytes32 internal constant CRED_TYPE = keccak256("coinbase.kyc");
    uint256 internal constant ILAL_TEST_SECP256K1_ORDER =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    SwapParams internal defaultSwapParams =
        SwapParams({zeroForOne: true, amountSpecified: -1e18, sqrtPriceLimitX96: 0});

    ModifyLiquidityParams internal defaultLiqParams =
        ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1e18, salt: bytes32(0)});

    function setUp() public {
        (trader, traderKey) = makeAddrAndKey("trader");

        vm.prank(admin);
        registry = new PolicyRegistry();
        cnfIssuer = new MockCNFIssuer();

        // Deploy hook — for unit tests the PoolManager is mocked so address bits don't matter
        hook = new ComplianceHook(IPoolManager(poolManager), registry, authorizedRouter);

        // Build a pool key
        poolKey = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        poolId = PoolId.unwrap(poolKey.toId());

        dynamicFeeKey = PoolKey({
            currency0: Currency.wrap(address(0x1)),
            currency1: Currency.wrap(address(0x2)),
            fee: LPFeeLibrary.DYNAMIC_FEE_FLAG,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        dynamicFeePoolId = PoolId.unwrap(dynamicFeeKey.toId());

        // Register policy
        vm.prank(admin);
        registry.setPolicy(poolId, address(cnfIssuer), CRED_TYPE);
        vm.prank(admin);
        registry.setPolicy(dynamicFeePoolId, address(cnfIssuer), CRED_TYPE);

        // Give trader a valid credential
        cnfIssuer.setValid(trader, true);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _buildSession(uint8 action, uint64 deadline) internal view returns (SessionLib.SessionToken memory) {
        return _buildSessionForPool(action, deadline, poolId);
    }

    function _buildSessionForPool(uint8 action, uint64 deadline, bytes32 targetPoolId)
        internal
        view
        returns (SessionLib.SessionToken memory)
    {
        return SessionLib.SessionToken({
            user: trader,
            authorizedCaller: authorizedRouter,
            cnfIssuer: address(cnfIssuer),
            chainId: block.chainid,
            verifyingHook: address(hook),
            poolId: targetPoolId,
            action: action,
            deadline: deadline,
            nonce: keccak256(abi.encodePacked(block.timestamp, trader))
        });
    }

    function _sign(SessionLib.SessionToken memory token) internal view returns (bytes memory sig) {
        bytes32 d = SessionLib.digest(token, hook.domainSeparator());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, d);
        sig = abi.encodePacked(r, s, v);
    }

    function _hookData(uint8 action) internal view returns (bytes memory) {
        SessionLib.SessionToken memory token = _buildSession(action, uint64(block.timestamp + 600));
        return abi.encode(token, _sign(token));
    }

    function _hookDataForPool(uint8 action, bytes32 targetPoolId) internal view returns (bytes memory) {
        SessionLib.SessionToken memory token = _buildSessionForPool(action, uint64(block.timestamp + 600), targetPoolId);
        token.nonce = keccak256(abi.encodePacked(block.timestamp, trader, targetPoolId));
        return abi.encode(token, _sign(token));
    }

    function _callBeforeSwap(bytes memory hookData) internal returns (bytes4 sel, BeforeSwapDelta delta, uint24 fee) {
        vm.prank(poolManager);
        (sel, delta, fee) = hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    function _callBeforeAddLiquidity(bytes memory hookData) internal returns (bytes4 sel) {
        vm.prank(poolManager);
        sel = hook.beforeAddLiquidity(authorizedRouter, poolKey, defaultLiqParams, hookData);
    }

    function _callBeforeRemoveLiquidity(bytes memory hookData) internal returns (bytes4 sel) {
        vm.prank(poolManager);
        sel = hook.beforeRemoveLiquidity(authorizedRouter, poolKey, defaultLiqParams, hookData);
    }

    // ─── Happy path ───────────────────────────────────────────────────────────

    function test_beforeSwap_success() public {
        (bytes4 sel,,) = _callBeforeSwap(_hookData(SessionLib.ACTION_SWAP));
        assertEq(sel, IHooks.beforeSwap.selector);
    }

    function test_beforeSwap_staticPool_noFeeOverride() public {
        (bytes4 sel,, uint24 fee) = _callBeforeSwap(_hookData(SessionLib.ACTION_SWAP));
        assertEq(sel, IHooks.beforeSwap.selector);
        assertEq(fee, 0);
    }

    function test_beforeSwap_dynamicPool_returnsVerifiedFlowFeeOverride() public {
        bytes memory hookData = _hookDataForPool(SessionLib.ACTION_SWAP, dynamicFeePoolId);

        vm.expectEmit(true, true, false, true, address(hook));
        emit ComplianceHook.VerifiedFlowFeeApplied(dynamicFeePoolId, trader, hook.VERIFIED_FLOW_FEE());

        vm.prank(poolManager);
        (bytes4 sel,, uint24 fee) = hook.beforeSwap(authorizedRouter, dynamicFeeKey, defaultSwapParams, hookData);

        assertEq(sel, IHooks.beforeSwap.selector);
        assertEq(fee, hook.VERIFIED_FLOW_FEE() | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function test_beforeAddLiquidity_success() public {
        bytes4 sel = _callBeforeAddLiquidity(_hookData(SessionLib.ACTION_ADD_LIQUIDITY));
        assertEq(sel, IHooks.beforeAddLiquidity.selector);
    }

    function test_beforeRemoveLiquidity_success() public {
        bytes4 sel = _callBeforeRemoveLiquidity(_hookData(SessionLib.ACTION_REMOVE_LIQUIDITY));
        assertEq(sel, IHooks.beforeRemoveLiquidity.selector);
    }

    function test_beforeRemoveLiquidity_allowsExitAfterCredentialInvalidation() public {
        cnfIssuer.setValid(trader, false);
        bytes4 sel = _callBeforeRemoveLiquidity(_hookData(SessionLib.ACTION_REMOVE_LIQUIDITY));
        assertEq(sel, IHooks.beforeRemoveLiquidity.selector);
    }

    function test_beforeRemoveLiquidity_allowsExitAfterPolicyDisabled() public {
        vm.prank(admin);
        registry.disablePolicy(poolId);
        bytes4 sel = _callBeforeRemoveLiquidity(_hookData(SessionLib.ACTION_REMOVE_LIQUIDITY));
        assertEq(sel, IHooks.beforeRemoveLiquidity.selector);
    }

    function test_beforeRemoveLiquidity_allowsExitAfterIssuerRotation() public {
        vm.prank(admin);
        registry.setPolicy(poolId, makeAddr("replacementIssuer"), keccak256("replacement.credential"));
        bytes4 sel = _callBeforeRemoveLiquidity(_hookData(SessionLib.ACTION_REMOVE_LIQUIDITY));
        assertEq(sel, IHooks.beforeRemoveLiquidity.selector);
    }

    // ─── onlyPoolManager ──────────────────────────────────────────────────────

    function test_revert_notPoolManager() public {
        bytes memory hookData = _hookData(SessionLib.ACTION_SWAP);
        vm.expectRevert(ComplianceHook.OnlyPoolManager.selector);
        hook.beforeSwap(address(0), poolKey, defaultSwapParams, hookData);
    }

    function test_revert_routerNotAuthorized() public {
        bytes memory hookData = _hookData(SessionLib.ACTION_SWAP);
        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.RouterNotAuthorized.selector);
        hook.beforeSwap(trader, poolKey, defaultSwapParams, hookData);
    }

    function test_revert_wrongAuthorizedCaller() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        token.authorizedCaller = makeAddr("otherCaller");
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionCallerMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Session deadline ─────────────────────────────────────────────────────

    function test_revert_sessionExpired() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp - 1));
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionExpired.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── ChainId ──────────────────────────────────────────────────────────────

    function test_revert_wrongChainId() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        token.chainId = 9999;
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionChainIdMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Hook address ─────────────────────────────────────────────────────────

    function test_revert_wrongHook() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        token.verifyingHook = makeAddr("evilHook");
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionHookMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Pool ID ──────────────────────────────────────────────────────────────

    function test_revert_wrongPool() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        token.poolId = keccak256("wrong-pool");
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionPoolMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Action ───────────────────────────────────────────────────────────────

    function test_revert_wrongAction_swapTokenUsedForLiquidity() public {
        // Session signed for SWAP, used in addLiquidity
        bytes memory hookData = _hookData(SessionLib.ACTION_SWAP);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionActionMismatch.selector);
        hook.beforeAddLiquidity(authorizedRouter, poolKey, defaultLiqParams, hookData);
    }

    function test_revert_wrongAction_liquidityTokenUsedForSwap() public {
        bytes memory hookData = _hookData(SessionLib.ACTION_ADD_LIQUIDITY);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionActionMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Signature ────────────────────────────────────────────────────────────

    function test_revert_invalidSignature() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        (, uint256 evilKey) = makeAddrAndKey("evil");
        bytes32 d = SessionLib.digest(token, hook.domainSeparator());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(evilKey, d);
        bytes memory badSig = abi.encodePacked(r, s, v);
        bytes memory hookData = abi.encode(token, badSig);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionSignatureInvalid.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    function test_revert_malleableHighSSignature() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        bytes32 d = SessionLib.digest(token, hook.domainSeparator());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, d);

        bytes32 highS = bytes32(ILAL_TEST_SECP256K1_ORDER - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        bytes memory malleableSig = abi.encodePacked(r, highS, flippedV);
        bytes memory hookData = abi.encode(token, malleableSig);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionSignatureInvalid.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Policy ───────────────────────────────────────────────────────────────

    function test_revert_policyNotConfigured() public {
        // Build a session for an unknown pool
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        token.poolId = keccak256("unknown-pool");

        PoolKey memory otherKey = poolKey;
        otherKey.fee = 500;
        token.poolId = PoolId.unwrap(otherKey.toId());

        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.PolicyNotConfigured.selector);
        hook.beforeSwap(authorizedRouter, otherKey, defaultSwapParams, hookData);
    }

    function test_revert_policyDisabled() public {
        vm.prank(admin);
        registry.disablePolicy(poolId);
        bytes memory hookData = _hookData(SessionLib.ACTION_SWAP);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.PolicyNotConfigured.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    function test_revert_wrongIssuerInSession() public {
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        token.cnfIssuer = makeAddr("rogue-issuer");
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.PolicyIssuerMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    function test_revert_wrongCredentialType() public {
        cnfIssuer.setCredentialType(trader, keccak256("basic.kyc"));
        bytes memory hookData = _hookData(SessionLib.ACTION_SWAP);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.CredentialTypeMismatch.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Credential ───────────────────────────────────────────────────────────

    function test_revert_invalidCredential() public {
        cnfIssuer.setValid(trader, false);
        bytes memory hookData = _hookData(SessionLib.ACTION_SWAP);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.CredentialInvalid.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    function test_revert_noCredential() public {
        address noCredWallet = makeAddr("noCred");
        SessionLib.SessionToken memory token = SessionLib.SessionToken({
            user: noCredWallet,
            authorizedCaller: authorizedRouter,
            cnfIssuer: address(cnfIssuer),
            chainId: block.chainid,
            verifyingHook: address(hook),
            poolId: poolId,
            action: SessionLib.ACTION_SWAP,
            deadline: uint64(block.timestamp + 600),
            nonce: bytes32(0)
        });
        bytes32 d = SessionLib.digest(token, hook.domainSeparator());
        (, uint256 noCredKey) = makeAddrAndKey("noCred");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(noCredKey, d);
        bytes memory hookData = abi.encode(token, abi.encodePacked(r, s, v));

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.CredentialInvalid.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    // ─── Nonce replay protection ───────────────────────────────────────────────

    function test_revert_nonceReplay() public {
        // Use the same session data twice — second call must revert
        SessionLib.SessionToken memory token = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        bytes memory sig = _sign(token);
        bytes memory hookData = abi.encode(token, sig);

        vm.prank(poolManager);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.NonceAlreadyUsed.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, hookData);
    }

    function test_nonceBitmap_uniqueNoncesAccepted() public {
        // Two sessions with different nonces should both succeed.
        // Pre-compute hookData before vm.prank — _sign calls hook.domainSeparator()
        // (external call) which would otherwise consume the prank.
        SessionLib.SessionToken memory t1 = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        t1.nonce = keccak256("nonce-1");
        SessionLib.SessionToken memory t2 = _buildSession(SessionLib.ACTION_SWAP, uint64(block.timestamp + 600));
        t2.nonce = keccak256("nonce-2");
        bytes memory data1 = abi.encode(t1, _sign(t1));
        bytes memory data2 = abi.encode(t2, _sign(t2));

        vm.prank(poolManager);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, data1);

        vm.prank(poolManager);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, data2);
    }

    // ─── EIP-1271 smart wallet ────────────────────────────────────────────────

    function test_erc1271_success() public {
        // Deploy a smart wallet owned by the trader key
        MockERC1271Wallet wallet = new MockERC1271Wallet(trader);
        cnfIssuer.setValid(address(wallet), true);

        SessionLib.SessionToken memory token = SessionLib.SessionToken({
            user: address(wallet),
            authorizedCaller: authorizedRouter,
            cnfIssuer: address(cnfIssuer),
            chainId: block.chainid,
            verifyingHook: address(hook),
            poolId: poolId,
            action: SessionLib.ACTION_SWAP,
            deadline: uint64(block.timestamp + 600),
            nonce: keccak256("smart-wallet-nonce")
        });

        // Sign digest with trader key — wallet.isValidSignature will verify it
        bytes32 d = SessionLib.digest(token, hook.domainSeparator());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, d);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(poolManager);
        (bytes4 sel,,) = hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, abi.encode(token, sig));
        assertEq(sel, IHooks.beforeSwap.selector);
    }

    function test_erc1271_revert_walletRejects() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(trader);
        wallet.setRejectAll(true);
        cnfIssuer.setValid(address(wallet), true);

        SessionLib.SessionToken memory token = SessionLib.SessionToken({
            user: address(wallet),
            authorizedCaller: authorizedRouter,
            cnfIssuer: address(cnfIssuer),
            chainId: block.chainid,
            verifyingHook: address(hook),
            poolId: poolId,
            action: SessionLib.ACTION_SWAP,
            deadline: uint64(block.timestamp + 600),
            nonce: keccak256("rejected-nonce")
        });

        bytes32 d = SessionLib.digest(token, hook.domainSeparator());
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, d);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(poolManager);
        vm.expectRevert(ComplianceHook.SessionSignatureInvalid.selector);
        hook.beforeSwap(authorizedRouter, poolKey, defaultSwapParams, abi.encode(token, sig));
    }
}
