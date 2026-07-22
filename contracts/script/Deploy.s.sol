// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";

import {CNFIssuer} from "../src/CNFIssuer.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {ComplianceHook} from "../src/ComplianceHook.sol";
import {ILALRouter} from "../src/ILALRouter.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";

/// @notice Deploys the full ILAL protocol stack with a properly mined hook address.
///
/// Required env vars:
///   POOL_MANAGER      — Uniswap v4 PoolManager address
///   EAS_ADDRESS       — EAS contract (Base: 0x4200000000000000000000000000000000000021)
///   SCHEMA_UID        — Coinbase Account Verification schema UID
///   TRUSTED_ATTESTER  — Coinbase Verifications attester address
///   DEPLOYER          — Deployer address when Foundry manages the signer
///   USE_FOUNDRY_WALLET — true for Foundry keystore/unlocked-account signing
///   PRIVATE_KEY       — Testnet-only compatibility signer when USE_FOUNDRY_WALLET=false
///   ADMIN             — Optional Safe/admin that receives issuer + registry ownership
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
contract Deploy is Script {
    // ComplianceHook requires beforeSwap + beforeAddLiquidity + beforeRemoveLiquidity
    uint160 constant HOOK_FLAGS =
        Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG;

    address constant FOUNDRY_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        address poolManager = vm.envAddress("POOL_MANAGER");
        address easAddress = vm.envAddress("EAS_ADDRESS");
        bytes32 schemaUID = vm.envBytes32("SCHEMA_UID");
        address trustedAttester = vm.envAddress("TRUSTED_ATTESTER");
        bool useFoundryWallet = vm.envOr("USE_FOUNDRY_WALLET", false);
        uint256 deployerKey;
        address deployer;
        if (useFoundryWallet) {
            deployer = vm.envAddress("DEPLOYER");
        } else {
            deployerKey = vm.envUint("PRIVATE_KEY");
            deployer = vm.addr(deployerKey);
        }
        address admin = vm.envOr("ADMIN", deployer);
        require(admin != address(0), "Deploy: zero admin");

        if (useFoundryWallet) vm.startBroadcast();
        else vm.startBroadcast(deployerKey);

        // 1. Deploy PolicyRegistry
        PolicyRegistry registry = new PolicyRegistry();
        console.log("PolicyRegistry:", address(registry));

        // 2. Deploy CNFIssuer
        CNFIssuer cnfIssuer = new CNFIssuer(
            easAddress,
            schemaUID,
            trustedAttester,
            0, // default 90-day lifetime
            CNFIssuer.IssuerMetadata({
                name: vm.envOr("ISSUER_NAME", string("ILAL Production Issuer")),
                jurisdiction: vm.envOr("ISSUER_JURISDICTION", string("")),
                credentialStandard: vm.envOr("ISSUER_STANDARD", string("Coinbase Account Verification / ILAL CNF")),
                uri: vm.envOr("ISSUER_URI", string(""))
            }),
            CNFIssuer.InitialZKConfig({
                verifier: vm.envOr("ZK_VERIFIER", address(0)),
                merkleRoot: vm.envOr("INITIAL_MERKLE_ROOT", uint256(0)),
                issuerHash: vm.envOr("ZK_ISSUER_HASH", uint256(0)),
                schemaHash: vm.envOr("ZK_SCHEMA_HASH", uint256(0))
            })
        );
        console.log("CNFIssuer:      ", address(cnfIssuer));

        // 3. Deploy ILALRouter. The hook only accepts PoolManager calls whose
        // sender is this router, so protocol fee capture cannot be bypassed by
        // direct PoolManager calls.
        address treasury = vm.envOr("TREASURY", deployer);
        uint24 protocolFeePips = uint24(vm.envOr("PROTOCOL_FEE_PIPS", uint256(50)));
        ILALRouter router = new ILALRouter(IPoolManager(poolManager), treasury, protocolFeePips);
        console.log("ILALRouter:     ", address(router));

        // 4. Mine and deploy ComplianceHook at a v4-valid CREATE2 address.
        ComplianceHook hook = _deployHook(poolManager, registry, address(router));

        // Keep production control off the hot deployer key. The CLI requires
        // ADMIN for Base mainnet broadcasts so ownership handoff is not an
        // optional post-deployment checklist item.
        if (admin != deployer) {
            registry.transferOwnership(admin);
            cnfIssuer.transferOwnership(admin);
        }
        require(registry.owner() == admin, "Deploy: registry owner mismatch");
        require(cnfIssuer.owner() == admin, "Deploy: issuer owner mismatch");

        vm.stopBroadcast();

        // ─── Summary ──────────────────────────────────────────────────────────
        console.log("\n========== ILAL Deployment ==========");
        console.log("Chain ID:        ", block.chainid);
        console.log("PolicyRegistry:  ", address(registry));
        console.log("CNFIssuer:       ", address(cnfIssuer));
        console.log("ILALRouter:      ", address(router));
        console.log("ComplianceHook:  ", address(hook));
        console.log("Admin owner:     ", admin);
        console.log("DomainSeparator: ", vm.toString(hook.domainSeparator()));
        console.log("Hook flags OK:   ", uint160(address(hook)) & HOOK_FLAGS == HOOK_FLAGS);
        console.log("======================================");
    }

    function _deployHook(address poolManager, PolicyRegistry registry, address router)
        internal
        returns (ComplianceHook hook)
    {
        bytes memory constructorArgs = abi.encode(IPoolManager(poolManager), registry, router);
        (address expectedHook, bytes32 salt) =
            HookMiner.find(FOUNDRY_CREATE2_DEPLOYER, HOOK_FLAGS, type(ComplianceHook).creationCode, constructorArgs);
        console.log("Mined hook address:", expectedHook);
        console.log("Salt:", vm.toString(salt));

        hook = new ComplianceHook{salt: salt}(IPoolManager(poolManager), registry, router);
        require(address(hook) == expectedHook, "Deploy: hook address mismatch");
        console.log("ComplianceHook: ", address(hook));
    }
}
