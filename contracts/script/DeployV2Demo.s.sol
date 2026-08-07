// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "v4-core/src/libraries/LPFeeLibrary.sol";

import {MockERC20} from "../src/mocks/MockERC20.sol";
import {ILALRouter} from "../src/ILALRouter.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {ILALPolicyVerifierV2} from "../src/verifier/ILALPolicyVerifierV2.sol";
import {ComplianceHookV2} from "../src/v2/ComplianceHookV2.sol";
import {EligibilityPolicyRegistryV2} from "../src/v2/EligibilityPolicyRegistryV2.sol";
import {Groth16VerifierAdapterV2, IILALPolicyVerifierV2} from "../src/v2/Groth16VerifierAdapterV2.sol";
import {PolicyGrantManagerV2} from "../src/v2/PolicyGrantManagerV2.sol";

/// @notice Deploys the isolated ILAL v2 policy-grant stack on Base Sepolia.
/// @dev The checked-in verifier was produced by the explicitly unsafe development
///      ceremony. This script refuses mainnet and is only for public PoC evidence.
contract DeployV2Demo is Script {
    using PoolIdLibrary for PoolKey;

    uint160 private constant HOOK_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;
    address private constant FOUNDRY_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint24 private constant DYNAMIC_FEE = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 private constant TICK_SPACING = 60;
    uint160 private constant INITIAL_SQRT_PRICE = 79228162514264337593543950336;
    uint256 private constant DEFAULT_MINT = 1_000_000 ether;
    uint24 private constant DEFAULT_PROTOCOL_FEE_PIPS = 50;

    struct PolicyInput {
        uint256 issuerHash;
        uint256 schemaHash;
        uint256 credentialRoot;
        uint8 minKycLevel;
        uint256 jurisdictionRoot;
        uint256 policyHash;
        uint64 maxGrantTTL;
    }

    struct DeployConfig {
        address poolManager;
        address deployer;
        address admin;
        address treasury;
        address wallet;
        uint256 mintAmount;
        uint24 protocolFeePips;
    }

    struct Deployment {
        MockERC20 tokenA;
        MockERC20 tokenB;
        ILALRouter router;
        EligibilityPolicyRegistryV2 registry;
        ILALPolicyVerifierV2 rawVerifier;
        Groth16VerifierAdapterV2 adapter;
        PolicyGrantManagerV2 grantManager;
        ComplianceHookV2 hook;
    }

    function run() external {
        require(block.chainid == 84532, "DeployV2Demo: Base Sepolia only");

        (bool useFoundryWallet, uint256 deployerKey, DeployConfig memory cfg) = _config();
        PolicyInput memory policy = _policyInput();

        if (useFoundryWallet) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        Deployment memory deployed = _deployCore(cfg);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(deployed.tokenA)),
            currency1: Currency.wrap(address(deployed.tokenB)),
            fee: DYNAMIC_FEE,
            tickSpacing: TICK_SPACING,
            hooks: deployed.hook
        });
        bytes32 poolId = PoolId.unwrap(key.toId());
        IPoolManager(cfg.poolManager).initialize(key, INITIAL_SQRT_PRICE);
        deployed.registry
            .setEligibilityPolicy(
                poolId,
                policy.issuerHash,
                policy.schemaHash,
                policy.credentialRoot,
                policy.minKycLevel,
                policy.jurisdictionRoot,
                policy.policyHash,
                policy.maxGrantTTL
            );

        if (cfg.admin != cfg.deployer) deployed.registry.transferOwnership(cfg.admin);
        require(deployed.registry.owner() == cfg.admin, "DeployV2Demo: registry owner mismatch");
        require(deployed.grantManager.owner() == cfg.admin, "DeployV2Demo: grant manager owner mismatch");

        vm.stopBroadcast();

        console.log("\n========== ILAL v2 Base Sepolia PoC ==========");
        console.log("TESTNET ONLY: unsafe development ceremony artifacts");
        console.log("Deployer:             ", cfg.deployer);
        console.log("Admin:                ", cfg.admin);
        console.log("Treasury:             ", cfg.treasury);
        console.log("Policy wallet:        ", cfg.wallet);
        console.log("TokenA (currency0):   ", address(deployed.tokenA));
        console.log("TokenB (currency1):   ", address(deployed.tokenB));
        console.log("ILALRouter:           ", address(deployed.router));
        console.log("PolicyRegistryV2:     ", address(deployed.registry));
        console.log("PolicyVerifierV2:     ", address(deployed.rawVerifier));
        console.log("VerifierAdapterV2:    ", address(deployed.adapter));
        console.log("PolicyGrantManagerV2: ", address(deployed.grantManager));
        console.log("ComplianceHookV2:     ", address(deployed.hook));
        console.log("Pool ID:");
        console.logBytes32(poolId);
        console.log("Policy hash:          ", policy.policyHash);
        console.log("Policy revision:      ", uint256(1));
        console.log("===============================================");

        string memory outputPath = vm.envOr("V2_DEPLOYMENT_OUTPUT", string(""));
        if (bytes(outputPath).length != 0) {
            _writeDeploymentJson(outputPath, cfg, deployed, poolId, policy);
            console.log("Deployment JSON:      ", outputPath);
        }
    }

    function _config() private view returns (bool useFoundryWallet, uint256 deployerKey, DeployConfig memory cfg) {
        useFoundryWallet = vm.envOr("USE_FOUNDRY_WALLET", false);
        address deployer;
        if (useFoundryWallet) {
            deployer = vm.envAddress("DEPLOYER");
        } else {
            deployerKey = vm.envUint("PRIVATE_KEY");
            deployer = vm.addr(deployerKey);
        }
        cfg = DeployConfig({
            poolManager: vm.envAddress("POOL_MANAGER"),
            deployer: deployer,
            admin: vm.envOr("ADMIN", deployer),
            treasury: vm.envOr("TREASURY", deployer),
            wallet: vm.envOr("WALLET", deployer),
            mintAmount: vm.envOr("MINT_AMOUNT", DEFAULT_MINT),
            protocolFeePips: uint24(vm.envOr("PROTOCOL_FEE_PIPS", uint256(DEFAULT_PROTOCOL_FEE_PIPS)))
        });
        require(
            cfg.admin != address(0) && cfg.treasury != address(0) && cfg.wallet != address(0),
            "DeployV2Demo: zero address"
        );
    }

    function _deployCore(DeployConfig memory cfg) private returns (Deployment memory deployed) {
        deployed.tokenA = new MockERC20("ILAL v2 Token A", "V2A", 18);
        deployed.tokenB = new MockERC20("ILAL v2 Token B", "V2B", 18);
        if (address(deployed.tokenA) > address(deployed.tokenB)) {
            (deployed.tokenA, deployed.tokenB) = (deployed.tokenB, deployed.tokenA);
        }
        deployed.tokenA.mint(cfg.wallet, cfg.mintAmount);
        deployed.tokenB.mint(cfg.wallet, cfg.mintAmount);
        deployed.router = new ILALRouter(IPoolManager(cfg.poolManager), cfg.treasury, cfg.protocolFeePips);
        deployed.registry = new EligibilityPolicyRegistryV2(cfg.deployer);
        deployed.rawVerifier = new ILALPolicyVerifierV2();
        deployed.adapter = new Groth16VerifierAdapterV2(IILALPolicyVerifierV2(address(deployed.rawVerifier)));
        deployed.grantManager = new PolicyGrantManagerV2(cfg.admin, deployed.adapter, deployed.registry);
        deployed.hook = _deployHook(cfg.poolManager, deployed.registry, deployed.grantManager, address(deployed.router));
    }

    function _policyInput() private view returns (PolicyInput memory policy) {
        policy = PolicyInput({
            issuerHash: vm.envUint("V2_ISSUER_HASH"),
            schemaHash: vm.envUint("V2_SCHEMA_HASH"),
            credentialRoot: vm.envUint("V2_CREDENTIAL_ROOT"),
            minKycLevel: uint8(vm.envUint("V2_MIN_KYC_LEVEL")),
            jurisdictionRoot: vm.envUint("V2_JURISDICTION_ROOT"),
            policyHash: vm.envUint("V2_POLICY_HASH"),
            maxGrantTTL: uint64(vm.envOr("V2_MAX_GRANT_TTL", uint256(1 days)))
        });
    }

    function _deployHook(
        address poolManager,
        EligibilityPolicyRegistryV2 registry,
        PolicyGrantManagerV2 grantManager,
        address router
    ) private returns (ComplianceHookV2 hook) {
        bytes memory constructorArgs = abi.encode(IPoolManager(poolManager), registry, grantManager, router);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(FOUNDRY_CREATE2_DEPLOYER, HOOK_FLAGS, type(ComplianceHookV2).creationCode, constructorArgs);
        hook = new ComplianceHookV2{salt: salt}(IPoolManager(poolManager), registry, grantManager, router);
        require(address(hook) == expectedHook, "DeployV2Demo: hook address mismatch");
        require(uint160(address(hook)) & HOOK_FLAGS == HOOK_FLAGS, "DeployV2Demo: invalid hook flags");
        console.log("Hook CREATE2 salt:   ", vm.toString(salt));
    }

    function _writeDeploymentJson(
        string memory outputPath,
        DeployConfig memory cfg,
        Deployment memory deployed,
        bytes32 poolId,
        PolicyInput memory policy
    ) private {
        string memory objectKey = "ilal-v2-deployment";
        vm.serializeUint(objectKey, "protocolVersion", 2);
        vm.serializeUint(objectKey, "chainId", block.chainid);
        vm.serializeAddress(objectKey, "poolManager", cfg.poolManager);
        vm.serializeAddress(objectKey, "admin", cfg.admin);
        vm.serializeAddress(objectKey, "treasury", cfg.treasury);
        vm.serializeAddress(objectKey, "wallet", cfg.wallet);
        vm.serializeAddress(objectKey, "tokenA", address(deployed.tokenA));
        vm.serializeAddress(objectKey, "tokenB", address(deployed.tokenB));
        vm.serializeAddress(objectKey, "router", address(deployed.router));
        vm.serializeAddress(objectKey, "registry", address(deployed.registry));
        vm.serializeAddress(objectKey, "rawVerifier", address(deployed.rawVerifier));
        vm.serializeAddress(objectKey, "verifierAdapter", address(deployed.adapter));
        vm.serializeAddress(objectKey, "grantManager", address(deployed.grantManager));
        vm.serializeAddress(objectKey, "hook", address(deployed.hook));
        vm.serializeBytes32(objectKey, "poolId", poolId);
        vm.serializeUint(objectKey, "fee", DYNAMIC_FEE);
        vm.serializeInt(objectKey, "tickSpacing", TICK_SPACING);
        vm.serializeUint(objectKey, "issuerHash", policy.issuerHash);
        vm.serializeUint(objectKey, "schemaHash", policy.schemaHash);
        vm.serializeUint(objectKey, "credentialRoot", policy.credentialRoot);
        vm.serializeUint(objectKey, "minKycLevel", policy.minKycLevel);
        vm.serializeUint(objectKey, "jurisdictionRoot", policy.jurisdictionRoot);
        vm.serializeUint(objectKey, "policyHash", policy.policyHash);
        string memory json = vm.serializeUint(objectKey, "maxGrantTTL", policy.maxGrantTTL);
        vm.writeJson(json, outputPath);
    }
}
