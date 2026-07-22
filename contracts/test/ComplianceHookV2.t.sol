// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BeforeSwapDelta} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";

import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";
import {MockERC1271Wallet} from "./mocks/MockERC1271Wallet.sol";
import {ComplianceHookV2} from "../src/v2/ComplianceHookV2.sol";
import {EligibilityPolicyRegistryV2} from "../src/v2/EligibilityPolicyRegistryV2.sol";
import {PolicyGrantManagerV2} from "../src/v2/PolicyGrantManagerV2.sol";
import {SessionLibV2} from "../src/v2/SessionLibV2.sol";

contract ComplianceHookV2Test is Test {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant ISSUER_HASH = 11;
    uint256 internal constant SCHEMA_HASH = 22;
    uint256 internal constant CREDENTIAL_ROOT = 33;
    uint256 internal constant JURISDICTION_ROOT = 44;
    uint256 internal constant POLICY_HASH = 55;
    uint256 internal constant ILAL_V2_SECP256K1_ORDER =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint256 internal traderKey = 0xA11CE;
    address internal trader;
    address internal admin = makeAddr("admin");
    address internal poolManagerAddress = makeAddr("poolManager");
    address internal authorizedRouter = makeAddr("authorizedRouter");

    MockGroth16Verifier internal verifier;
    EligibilityPolicyRegistryV2 internal registry;
    PolicyGrantManagerV2 internal grantManager;
    ComplianceHookV2 internal hook;
    PoolKey internal poolKey;
    SwapParams internal swapParams;
    ModifyLiquidityParams internal liquidityParams;
    uint256 internal nonceCounter;

    function setUp() public {
        trader = vm.addr(traderKey);
        verifier = new MockGroth16Verifier();
        registry = new EligibilityPolicyRegistryV2(admin);
        grantManager = new PolicyGrantManagerV2(admin, verifier, registry);
        hook = new ComplianceHookV2(IPoolManager(poolManagerAddress), registry, grantManager, authorizedRouter);

        poolKey = PoolKey({
            currency0: Currency.wrap(address(0x1000)),
            currency1: Currency.wrap(address(0x2000)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });
        swapParams = SwapParams({zeroForOne: true, amountSpecified: -1 ether, sqrtPriceLimitX96: 4295128740});
        liquidityParams =
            ModifyLiquidityParams({tickLower: -60, tickUpper: 60, liquidityDelta: 1 ether, salt: bytes32(0)});

        _setPolicy(POLICY_HASH);
        _activateGrant(trader, block.timestamp + 30 days);
    }

    function _poolId() internal view returns (bytes32) {
        return PoolId.unwrap(poolKey.toId());
    }

    function _setPolicy(uint256 policyHash) internal {
        vm.prank(admin);
        registry.setEligibilityPolicy(
            _poolId(), ISSUER_HASH, SCHEMA_HASH, CREDENTIAL_ROOT, 2, JURISDICTION_ROOT, policyHash, 1 days
        );
    }

    function _proof() internal pure returns (bytes memory) {
        return abi.encode(
            [uint256(1), uint256(2)], [[uint256(3), uint256(4)], [uint256(5), uint256(6)]], [uint256(7), uint256(8)]
        );
    }

    function _grantInputs(address user, uint256 expiresAt) internal pure returns (uint256[] memory inputs) {
        inputs = new uint256[](9);
        inputs[0] = uint256(keccak256(abi.encodePacked(user))) >> 4;
        inputs[1] = ISSUER_HASH;
        inputs[2] = SCHEMA_HASH;
        inputs[3] = expiresAt;
        inputs[4] = CREDENTIAL_ROOT;
        inputs[5] = 2;
        inputs[6] = JURISDICTION_ROOT;
        inputs[7] = POLICY_HASH;
        inputs[8] = 2;
    }

    function _activateGrant(address user, uint256 expiresAt) internal {
        vm.prank(user);
        grantManager.activatePolicyGrant(_poolId(), _proof(), _grantInputs(user, expiresAt));
    }

    function _token(uint8 action) internal returns (SessionLibV2.SessionTokenV2 memory token) {
        token = SessionLibV2.SessionTokenV2({
            user: trader,
            authorizedCaller: authorizedRouter,
            policyHash: POLICY_HASH,
            policyRevision: registry.getEligibilityPolicy(_poolId()).revision,
            chainId: block.chainid,
            verifyingHook: address(hook),
            poolId: _poolId(),
            action: action,
            deadline: uint64(block.timestamp + 10 minutes),
            nonce: bytes32(++nonceCounter)
        });
    }

    function _sign(SessionLibV2.SessionTokenV2 memory token) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, SessionLibV2.digest(token, hook.domainSeparator()));
        return abi.encodePacked(r, s, v);
    }

    function _hookData(uint8 action) internal returns (bytes memory) {
        SessionLibV2.SessionTokenV2 memory token = _token(action);
        return abi.encode(token, _sign(token));
    }

    function _beforeSwap(bytes memory hookData) internal returns (bytes4, BeforeSwapDelta, uint24) {
        vm.prank(poolManagerAddress);
        return hook.beforeSwap(authorizedRouter, poolKey, swapParams, hookData);
    }

    function test_beforeSwap_success() public {
        (bytes4 selector,, uint24 fee) = _beforeSwap(_hookData(SessionLibV2.ACTION_SWAP));
        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(fee, 0);
    }

    function test_beforeSwap_dynamicFee_success() public {
        poolKey.fee = LPFeeLibrary.DYNAMIC_FEE_FLAG;
        _setPolicy(POLICY_HASH);
        _activateGrant(trader, block.timestamp + 30 days);
        (bytes4 selector,, uint24 fee) = _beforeSwap(_hookData(SessionLibV2.ACTION_SWAP));
        assertEq(selector, IHooks.beforeSwap.selector);
        assertEq(fee, uint24(500) | LPFeeLibrary.OVERRIDE_FEE_FLAG);
    }

    function test_beforeAddLiquidity_success() public {
        bytes memory hookData = _hookData(SessionLibV2.ACTION_ADD_LIQUIDITY);
        vm.prank(poolManagerAddress);
        bytes4 selector = hook.beforeAddLiquidity(authorizedRouter, poolKey, liquidityParams, hookData);
        assertEq(selector, IHooks.beforeAddLiquidity.selector);
    }

    function test_removeLiquidity_remainsAvailableAfterGrantRevocation() public {
        vm.prank(admin);
        grantManager.revokePolicyGrant(_poolId(), trader);

        bytes memory hookData = _hookData(SessionLibV2.ACTION_REMOVE_LIQUIDITY);
        vm.prank(poolManagerAddress);
        bytes4 selector = hook.beforeRemoveLiquidity(authorizedRouter, poolKey, liquidityParams, hookData);
        assertEq(selector, IHooks.beforeRemoveLiquidity.selector);
    }

    function test_revert_withoutValidGrant() public {
        vm.prank(admin);
        grantManager.revokePolicyGrant(_poolId(), trader);

        bytes memory hookData = _hookData(SessionLibV2.ACTION_SWAP);
        vm.expectRevert(ComplianceHookV2.PolicyGrantInvalid.selector);
        _beforeSwap(hookData);
    }

    function test_revert_afterGrantExpiry() public {
        (, uint64 expiresAt,) = grantManager.grants(_poolId(), trader);
        vm.warp(expiresAt);
        bytes memory hookData = _hookData(SessionLibV2.ACTION_SWAP);
        vm.expectRevert(ComplianceHookV2.PolicyGrantInvalid.selector);
        _beforeSwap(hookData);
    }

    function test_policyUpdateInvalidatesOldGrantAndSession() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        bytes memory hookData = abi.encode(token, _sign(token));
        _setPolicy(POLICY_HASH + 1);

        vm.expectRevert(ComplianceHookV2.SessionPolicyMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_wrongPolicyRevision() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        token.policyRevision += 1;
        bytes memory hookData = abi.encode(token, _sign(token));

        vm.expectRevert(ComplianceHookV2.SessionPolicyRevisionMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_disabledPolicy() public {
        vm.prank(admin);
        registry.disableEligibilityPolicy(_poolId());
        bytes memory hookData = _hookData(SessionLibV2.ACTION_SWAP);
        vm.expectRevert(ComplianceHookV2.PolicyNotConfigured.selector);
        _beforeSwap(hookData);
    }

    function test_revert_replayedNonce() public {
        bytes memory hookData = _hookData(SessionLibV2.ACTION_SWAP);
        _beforeSwap(hookData);
        vm.expectRevert(ComplianceHookV2.NonceAlreadyUsed.selector);
        _beforeSwap(hookData);
    }

    function test_revert_notPoolManager() public {
        bytes memory hookData = _hookData(SessionLibV2.ACTION_SWAP);
        vm.expectRevert(ComplianceHookV2.OnlyPoolManager.selector);
        hook.beforeSwap(authorizedRouter, poolKey, swapParams, hookData);
    }

    function test_revert_routerNotAuthorized() public {
        bytes memory hookData = _hookData(SessionLibV2.ACTION_SWAP);
        vm.prank(poolManagerAddress);
        vm.expectRevert(ComplianceHookV2.RouterNotAuthorized.selector);
        hook.beforeSwap(makeAddr("otherRouter"), poolKey, swapParams, hookData);
    }

    function test_revert_expiredSession() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        token.deadline = uint64(block.timestamp - 1);
        bytes memory hookData = abi.encode(token, _sign(token));
        vm.expectRevert(ComplianceHookV2.SessionExpired.selector);
        _beforeSwap(hookData);
    }

    function test_revert_wrongCallerBinding() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        token.authorizedCaller = makeAddr("wrongCaller");
        bytes memory hookData = abi.encode(token, _sign(token));
        vm.expectRevert(ComplianceHookV2.SessionCallerMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_wrongChain() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        token.chainId += 1;
        bytes memory hookData = abi.encode(token, _sign(token));
        vm.expectRevert(ComplianceHookV2.SessionChainIdMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_wrongHook() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        token.verifyingHook = makeAddr("wrongHook");
        bytes memory hookData = abi.encode(token, _sign(token));
        vm.expectRevert(ComplianceHookV2.SessionHookMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_wrongPool() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        token.poolId = keccak256("wrongPool");
        bytes memory hookData = abi.encode(token, _sign(token));
        vm.expectRevert(ComplianceHookV2.SessionPoolMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_wrongAction() public {
        bytes memory hookData = _hookData(SessionLibV2.ACTION_ADD_LIQUIDITY);
        vm.expectRevert(ComplianceHookV2.SessionActionMismatch.selector);
        _beforeSwap(hookData);
    }

    function test_revert_invalidSignature() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        (, bytes32 r, bytes32 s) = vm.sign(0xB0B, SessionLibV2.digest(token, hook.domainSeparator()));
        vm.expectRevert(ComplianceHookV2.SessionSignatureInvalid.selector);
        _beforeSwap(abi.encode(token, abi.encodePacked(r, s, uint8(27))));
    }

    function test_revert_malleableHighSSignature() public {
        SessionLibV2.SessionTokenV2 memory token = _token(SessionLibV2.ACTION_SWAP);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, SessionLibV2.digest(token, hook.domainSeparator()));
        bytes32 highS = bytes32(ILAL_V2_SECP256K1_ORDER - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;

        vm.expectRevert(ComplianceHookV2.SessionSignatureInvalid.selector);
        _beforeSwap(abi.encode(token, abi.encodePacked(r, highS, flippedV)));
    }

    function test_erc1271SmartWallet_success() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet(trader);
        _activateGrant(address(wallet), block.timestamp + 30 days);
        SessionLibV2.SessionTokenV2 memory token = SessionLibV2.SessionTokenV2({
            user: address(wallet),
            authorizedCaller: authorizedRouter,
            policyHash: POLICY_HASH,
            policyRevision: registry.getEligibilityPolicy(_poolId()).revision,
            chainId: block.chainid,
            verifyingHook: address(hook),
            poolId: _poolId(),
            action: SessionLibV2.ACTION_SWAP,
            deadline: uint64(block.timestamp + 10 minutes),
            nonce: keccak256("v2-smart-wallet")
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderKey, SessionLibV2.digest(token, hook.domainSeparator()));

        (bytes4 selector,,) = _beforeSwap(abi.encode(token, abi.encodePacked(r, s, v)));
        assertEq(selector, IHooks.beforeSwap.selector);
    }
}
