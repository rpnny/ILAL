// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";

import {MockEAS} from "../src/test/MockEAS.sol";
import {CNFIssuer} from "../src/CNFIssuer.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {ComplianceHook} from "../src/ComplianceHook.sol";
import {ILALRouter} from "../src/ILALRouter.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";

/// @notice Testnet deployment: deploys MockEAS + full ILAL stack, then seeds a
///         test attestation and mints a CNF for WALLET_TO_SEED.
///
/// Required env vars:
///   POOL_MANAGER    — Uniswap v4 PoolManager (Base Sepolia: 0x05E73354...)
///   WALLET_TO_SEED  — Address that receives the test CNF (can be your wallet)
///   PRIVATE_KEY     — Deployer private key
///
/// Optional:
///   SCHEMA_UID      — Use a custom schema (defaults to Coinbase schema UID)
///
/// Usage:
///   forge script script/DeployMock.s.sol --rpc-url https://sepolia.base.org --broadcast
contract DeployMock is Script {
    // Same flags as production ComplianceHook
    uint160 constant HOOK_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;

    address constant FOUNDRY_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    bytes32 constant DEFAULT_SCHEMA = 0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9;

    function run() external {
        address poolManager = vm.envAddress("POOL_MANAGER");
        address walletToSeed = vm.envAddress("WALLET_TO_SEED");
        bytes32 schemaUID = vm.envOr("SCHEMA_UID", DEFAULT_SCHEMA);

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        // 1. Deploy MockEAS — deployer is the trusted attester
        MockEAS mockEAS = new MockEAS();
        address attester = msg.sender;
        console.log("MockEAS:         ", address(mockEAS));

        // 2. Deploy CNFIssuer pointing to MockEAS
        CNFIssuer cnfIssuer = new CNFIssuer(
            address(mockEAS),
            schemaUID,
            attester,
            0, // default 90-day lifetime
            CNFIssuer.IssuerMetadata({
                name: vm.envOr("ISSUER_NAME", string("ILAL Mock Demo Issuer")),
                jurisdiction: vm.envOr("ISSUER_JURISDICTION", string("US testnet")),
                credentialStandard: vm.envOr("ISSUER_STANDARD", string("Coinbase Account Verification / ILAL CNF")),
                uri: vm.envOr("ISSUER_URI", string("https://www.ilal.tech/demo-issuer"))
            }),
            CNFIssuer.InitialZKConfig({
                verifier: vm.envOr("ZK_VERIFIER", address(0)),
                merkleRoot: vm.envOr("INITIAL_MERKLE_ROOT", uint256(0)),
                issuerHash: vm.envOr("ZK_ISSUER_HASH", uint256(0)),
                schemaHash: vm.envOr("ZK_SCHEMA_HASH", uint256(0))
            })
        );
        console.log("CNFIssuer:       ", address(cnfIssuer));

        // 3. Deploy PolicyRegistry
        PolicyRegistry registry = new PolicyRegistry();
        console.log("PolicyRegistry:  ", address(registry));

        // 4. Deploy ILALRouter
        address treasury = vm.envOr("TREASURY", msg.sender);
        uint24 protocolFeePips = uint24(vm.envOr("PROTOCOL_FEE_PIPS", uint256(50)));
        ILALRouter router = new ILALRouter(IPoolManager(poolManager), treasury, protocolFeePips);
        console.log("ILALRouter:      ", address(router));

        // 5. Mine + deploy ComplianceHook
        bytes memory constructorArgs = abi.encode(IPoolManager(poolManager), registry, address(router));
        (, bytes32 salt) =
            HookMiner.find(FOUNDRY_CREATE2_DEPLOYER, HOOK_FLAGS, type(ComplianceHook).creationCode, constructorArgs);

        ComplianceHook hook = new ComplianceHook{salt: salt}(IPoolManager(poolManager), registry, address(router));
        console.log("ComplianceHook:  ", address(hook));

        // 6. Seed: create a test attestation for walletToSeed
        bytes32 attestationUID = mockEAS.attest(
            schemaUID,
            walletToSeed,
            attester,
            0, // no expiration
            ""
        );
        console.log("AttestationUID:  ", vm.toString(attestationUID));

        // 7. Mint CNF for walletToSeed
        //    (must be called by walletToSeed — use vm.prank only in tests)
        //    In real usage, walletToSeed calls mintWithEAS themselves.
        //    Here we deploy and the wallet calls separately via CLI.

        vm.stopBroadcast();

        console.log("\n========== ILAL Mock Deployment ==========");
        console.log("Chain ID:        ", block.chainid);
        console.log("MockEAS:         ", address(mockEAS));
        console.log("CNFIssuer:       ", address(cnfIssuer));
        console.log("PolicyRegistry:  ", address(registry));
        console.log("ILALRouter:      ", address(router));
        console.log("ComplianceHook:  ", address(hook));
        console.log("AttestationUID:  ", vm.toString(attestationUID));
        console.log("WalletToSeed:    ", walletToSeed);
        console.log("");
        console.log("Next step - mint your CNF:");
        console.log("  ilal credential mint \\");
        console.log("    --attestation", vm.toString(attestationUID), "\\");
        console.log("    --issuer", address(cnfIssuer), "\\");
        console.log("    --chain", block.chainid);
        console.log("==========================================");
    }
}
