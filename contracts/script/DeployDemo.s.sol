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
import {MockEAS} from "../src/test/MockEAS.sol";
import {CNFIssuer} from "../src/CNFIssuer.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {ComplianceHook} from "../src/ComplianceHook.sol";
import {ILALRouter} from "../src/ILALRouter.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {Groth16Verifier} from "../src/verifier/ILALVerifier.sol";
import {Groth16VerifierAdapter} from "../src/verifier/Groth16VerifierAdapter.sol";

/// @notice Deploy the full ILAL demo stack on Base Sepolia:
///   MockERC20 tokenA + tokenB
///   ILALRouter (unlock callback router)
///   Existing CNFIssuer + ComplianceHook (read from env or deploy fresh)
///   Initialize pool (tokenA/tokenB, 0.3% fee, ComplianceHook)
///   Register pool policy in PolicyRegistry
///   Mint test tokens → wallet
///
/// Required env vars:
///   POOL_MANAGER   — Uniswap v4 PoolManager address
///   DEPLOYER       — Deployer address when Foundry manages the signer
///   USE_FOUNDRY_WALLET — true for Foundry keystore/unlocked-account signing
///   PRIVATE_KEY    — Testnet-only compatibility signer when USE_FOUNDRY_WALLET=false
///
/// Optional env vars (if not set, fresh contracts are deployed):
///   CNF_ISSUER     — Existing CNFIssuer address
///   HOOK_ADDR      — Existing ComplianceHook address
///   REGISTRY_ADDR  — Existing PolicyRegistry address
///   WALLET         — Wallet to receive test tokens (defaults to deployer)
///   MINT_AMOUNT    — Amount of each token to mint (default: 1_000_000 × 1e18)
///   TREASURY       — ILAL protocol fee receiver (defaults to deployer)
///   ADMIN          — Safe/admin that receives MockEAS, CNFIssuer, and PolicyRegistry ownership
///   PROTOCOL_FEE_PIPS — ILAL fee on verified exact-input swaps (default: 50 = 0.005%)
///   MOCK_EAS       — If true, deploy MockEAS + seed an attestation for WALLET
///   SCHEMA_UID     — Optional schema UID for MockEAS mode
///   DEPLOY_ZK      — If true, deploy ILALVerifier + Groth16VerifierAdapter
///   ZK_VERIFIER    — Optional existing verifier adapter address
///   INITIAL_MERKLE_ROOT — Optional active root at deployment, no timelock needed
///   ISSUER_NAME / ISSUER_JURISDICTION / ISSUER_STANDARD / ISSUER_URI
///
/// Usage:
///   forge script script/DeployDemo.s.sol \
///     --rpc-url https://sepolia.base.org \
///     --broadcast \
///     --sig "run()"
contract DeployDemo is Script {
    using PoolIdLibrary for PoolKey;

    uint160 constant HOOK_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;

    address constant FOUNDRY_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Dynamic fee pool by default. ComplianceHook overrides verified flow to 0.05%.
    uint24 constant DEFAULT_FEE = LPFeeLibrary.DYNAMIC_FEE_FLAG;
    int24 constant TICK_SPACING = 60;

    // Initial price: 1 tokenA = 1 tokenB  →  sqrtPriceX96 = sqrt(1) × 2^96
    uint160 constant INITIAL_SQRT_PRICE = 79228162514264337593543950336; // 2^96

    uint256 constant DEFAULT_MINT = 1_000_000 ether;
    uint24 constant DEFAULT_PROTOCOL_FEE_PIPS = 50; // 0.005%
    bytes32 constant DEFAULT_SCHEMA = 0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9;

    struct ResolveArgs {
        address poolManager;
        address deployer;
        address wallet;
        bool mockEAS;
        address router;
    }

    struct CoreContracts {
        PolicyRegistry registry;
        CNFIssuer cnfIssuer;
        ComplianceHook hook;
        MockEAS mockEAS;
        bool registryDeployed;
        bool issuerDeployed;
    }

    function run() external {
        address poolManager = vm.envAddress("POOL_MANAGER");
        bool useFoundryWallet = vm.envOr("USE_FOUNDRY_WALLET", false);
        uint256 deployerKey;
        address deployer;
        if (useFoundryWallet) {
            deployer = vm.envAddress("DEPLOYER");
        } else {
            deployerKey = vm.envUint("PRIVATE_KEY");
            deployer = vm.addr(deployerKey);
        }
        uint256 mintAmount = vm.envOr("MINT_AMOUNT", DEFAULT_MINT);
        uint24 fee = uint24(vm.envOr("FEE", uint256(DEFAULT_FEE)));
        bool mockEAS = vm.envOr("MOCK_EAS", false);
        address admin = vm.envOr("ADMIN", deployer);
        require(admin != address(0), "DeployDemo: zero admin");

        if (useFoundryWallet) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);
        address wallet = vm.envOr("WALLET", deployer);

        // ── 1. Deploy mock tokens ──────────────────────────────────────────────
        MockERC20 tokenA = new MockERC20("ILAL Token A", "TOKA", 18);
        MockERC20 tokenB = new MockERC20("ILAL Token B", "TOKB", 18);

        // Ensure currency0 < currency1 (v4 requirement)
        if (address(tokenA) > address(tokenB)) {
            (tokenA, tokenB) = (tokenB, tokenA);
        }

        tokenA.mint(wallet, mintAmount);
        tokenB.mint(wallet, mintAmount);
        console.log("TokenA (currency0): ", address(tokenA));
        console.log("TokenB (currency1): ", address(tokenB));
        console.log("Minted to wallet:   ", wallet);

        // ── 2. Deploy ILALRouter ───────────────────────────────────────────────
        address router = _deployRouter(poolManager, deployer);

        // ── 3. Deploy or use existing CNFIssuer / PolicyRegistry / ComplianceHook
        CoreContracts memory core = _resolveCoreContracts(_resolveArgs(poolManager, deployer, wallet, mockEAS, router));

        _initializeAndRegisterPool(poolManager, tokenA, tokenB, fee, core.hook, core.registry, core.cnfIssuer);
        _handoffOwnership(deployer, admin, core);

        vm.stopBroadcast();

        console.log("\n========== ILAL Demo Deployment ==========");
        console.log("Copy the printed addresses into .ilal.json or run ilal init with flags.");
        console.log("Admin owner:          ", admin);
        console.log("Next steps:");
        if (mockEAS) {
            console.log("  Trader:   ilal credential mint --attestation <AttestationUID>");
        } else {
            console.log("  Operator: ilal oracle propose-root --root <newMerkleRoot>");
            console.log("  Operator: ilal oracle activate-root   # after ROOT_DELAY");
            console.log("  Trader:   ilal credential prove --wallet", wallet);
        }
        console.log(
            "  Trader:   ilal swap --amount-in 100 --token-in", address(tokenA), "--min-amount-out <quotedMinRaw>"
        );
        console.log("==========================================");
    }

    function _deployRouter(address poolManager, address deployer) internal returns (address router) {
        address treasury = vm.envOr("TREASURY", deployer);
        uint24 protocolFeePips = uint24(vm.envOr("PROTOCOL_FEE_PIPS", uint256(DEFAULT_PROTOCOL_FEE_PIPS)));
        router = address(new ILALRouter(IPoolManager(poolManager), treasury, protocolFeePips));
        console.log("ILALRouter:         ", router);
        console.log("ILAL Treasury:      ", treasury);
    }

    function _resolveArgs(address poolManager, address deployer, address wallet, bool mockEAS, address router)
        internal
        pure
        returns (ResolveArgs memory args)
    {
        args = ResolveArgs({
            poolManager: poolManager, deployer: deployer, wallet: wallet, mockEAS: mockEAS, router: router
        });
    }

    function _initializeAndRegisterPool(
        address poolManager,
        MockERC20 tokenA,
        MockERC20 tokenB,
        uint24 fee,
        ComplianceHook hook,
        PolicyRegistry registry,
        CNFIssuer cnfIssuer
    ) internal {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(tokenA)),
            currency1: Currency.wrap(address(tokenB)),
            fee: fee,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });

        bytes32 poolId = PoolId.unwrap(key.toId());

        IPoolManager(poolManager).initialize(key, INITIAL_SQRT_PRICE);
        console.log("Pool initialized.   poolId:");
        console.logBytes32(poolId);

        registry.setPolicy(poolId, address(cnfIssuer), cnfIssuer.schemaUID());
        console.log("Policy registered for pool.");
    }

    function _resolveCoreContracts(ResolveArgs memory cfg) internal returns (CoreContracts memory core) {
        address issuerAddr = vm.envOr("CNF_ISSUER", address(0));
        address hookAddr = vm.envOr("HOOK_ADDR", address(0));
        address registryAddr = vm.envOr("REGISTRY_ADDR", address(0));

        if (registryAddr != address(0)) {
            core.registry = PolicyRegistry(registryAddr);
        } else {
            core.registry = new PolicyRegistry();
            core.registryDeployed = true;
            console.log("PolicyRegistry:     ", address(core.registry));
        }

        if (issuerAddr != address(0)) {
            core.cnfIssuer = CNFIssuer(issuerAddr);
        } else if (cfg.mockEAS) {
            bytes32 schemaUID = vm.envOr("SCHEMA_UID", DEFAULT_SCHEMA);
            core.mockEAS = new MockEAS();
            console.log("MockEAS:            ", address(core.mockEAS));
            core.cnfIssuer =
                new CNFIssuer(address(core.mockEAS), schemaUID, cfg.deployer, 0, _issuerMetadata(), _initialZKConfig());
            core.issuerDeployed = true;
            console.log("CNFIssuer:          ", address(core.cnfIssuer));
            bytes32 attestationUID = core.mockEAS.attest(schemaUID, cfg.wallet, cfg.deployer, 0, "");
            console.log("AttestationUID:     ");
            console.logBytes32(attestationUID);
        } else {
            // Minimal issuer — no EAS (ZK-only mode)
            core.cnfIssuer =
                new CNFIssuer(address(0), bytes32(0), cfg.deployer, 0, _issuerMetadata(), _initialZKConfig());
            core.issuerDeployed = true;
            console.log("CNFIssuer:          ", address(core.cnfIssuer));
        }

        if (hookAddr != address(0)) {
            core.hook = ComplianceHook(hookAddr);
        } else {
            bytes memory args = abi.encode(IPoolManager(cfg.poolManager), core.registry, cfg.router);
            (address expectedHook, bytes32 salt) =
                HookMiner.find(FOUNDRY_CREATE2_DEPLOYER, HOOK_FLAGS, type(ComplianceHook).creationCode, args);
            console.log("Expected hook:      ", expectedHook);
            console.log("Hook salt:          ", vm.toString(salt));
            core.hook = new ComplianceHook{salt: salt}(IPoolManager(cfg.poolManager), core.registry, cfg.router);
            console.log("ComplianceHook:     ", address(core.hook));
        }
    }

    function _handoffOwnership(address deployer, address admin, CoreContracts memory core) internal {
        if (core.registryDeployed && admin != deployer) core.registry.transferOwnership(admin);
        if (core.issuerDeployed && admin != deployer) core.cnfIssuer.transferOwnership(admin);
        if (address(core.mockEAS) != address(0) && admin != deployer) core.mockEAS.transferOwnership(admin);

        require(core.registry.owner() == admin, "DeployDemo: registry owner mismatch");
        require(core.cnfIssuer.owner() == admin, "DeployDemo: issuer owner mismatch");
        if (address(core.mockEAS) != address(0)) {
            require(core.mockEAS.owner() == admin, "DeployDemo: MockEAS owner mismatch");
        }
        if (admin != deployer) {
            require(core.registry.owner() != deployer, "DeployDemo: deployer retains registry ownership");
            require(core.cnfIssuer.owner() != deployer, "DeployDemo: deployer retains issuer ownership");
            if (address(core.mockEAS) != address(0)) {
                require(core.mockEAS.owner() != deployer, "DeployDemo: deployer retains MockEAS ownership");
            }
        }
    }

    function _issuerMetadata() internal view returns (CNFIssuer.IssuerMetadata memory) {
        return CNFIssuer.IssuerMetadata({
            name: vm.envOr("ISSUER_NAME", string("ILAL Demo Issuer")),
            jurisdiction: vm.envOr("ISSUER_JURISDICTION", string("US testnet")),
            credentialStandard: vm.envOr("ISSUER_STANDARD", string("Coinbase Account Verification / ILAL CNF")),
            uri: vm.envOr("ISSUER_URI", string("https://www.ilal.tech/demo-issuer"))
        });
    }

    function _initialZKConfig() internal returns (CNFIssuer.InitialZKConfig memory) {
        address verifier = vm.envOr("ZK_VERIFIER", address(0));
        if (verifier == address(0) && vm.envOr("DEPLOY_ZK", false)) {
            Groth16Verifier rawVerifier = new Groth16Verifier();
            Groth16VerifierAdapter adapter = new Groth16VerifierAdapter(address(rawVerifier));
            verifier = address(adapter);
            console.log("ILALVerifier:       ", address(rawVerifier));
            console.log("ZKVerifierAdapter:  ", verifier);
        }

        return CNFIssuer.InitialZKConfig({
            verifier: verifier,
            merkleRoot: vm.envOr("INITIAL_MERKLE_ROOT", uint256(0)),
            issuerHash: vm.envOr("ZK_ISSUER_HASH", uint256(0)),
            schemaHash: vm.envOr("ZK_SCHEMA_HASH", uint256(0))
        });
    }
}
