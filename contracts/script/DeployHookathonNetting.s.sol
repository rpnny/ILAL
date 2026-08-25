// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {IChainlinkAggregatorV3} from "../src/interfaces/IChainlinkAggregatorV3.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockEAS} from "../src/test/MockEAS.sol";
import {CNFIssuer} from "../src/CNFIssuer.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {InstitutionalNettingHook} from "../src/netting/InstitutionalNettingHook.sol";
import {InstitutionalBatchRouter} from "../src/netting/InstitutionalBatchRouter.sol";
import {ChainlinkStablecoinOracleGuard} from "../src/oracle/ChainlinkStablecoinOracleGuard.sol";

interface IERC20Deploy {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Base Sepolia-only deployment for the Hookathon atomic stablecoin netting candidate.
/// @dev Uses separate testnet keys for deployment, institutions and LP. Never use these
///      environment-key inputs for production. The admin must be a separately deployed Safe.
contract DeployHookathonNetting is Script {
    using PoolIdLibrary for PoolKey;

    address internal constant POOL_MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address internal constant POSITION_MANAGER = 0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant FOUNDRY_CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant CHAINLINK_USDC_USD = 0xd30e2101a97dcbAeBCBC04F14C3f624E67A35165;
    address internal constant CHAINLINK_USDT_USD = 0x3ec8593F930EA45ea58c968260e6e9FF53FC934f;
    address internal constant CIRCLE_TEST_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    uint160 internal constant INITIAL_SQRT_PRICE = 79228162514264337593543950336;
    uint160 internal constant HOOK_FLAGS = Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG;
    uint24 internal constant FEE = 500;
    int24 internal constant TICK_SPACING = 10;
    int24 internal constant MAX_ABS_TICK = 100;
    bytes32 internal constant SCHEMA_UID = keccak256("ilal.hookathon.institution.v1");
    uint256 internal constant DEFAULT_HUSDT_MINT = 1_000e6;
    uint256 internal constant DEFAULT_INSTITUTION_USDC = 100_000;
    uint256 internal constant DEFAULT_LP_USDC = 450_000;
    uint128 internal constant DEFAULT_LIQUIDITY = 1_000_000;
    uint128 internal constant DEFAULT_STABILIZER_LIQUIDITY = 10_000_000;

    struct Roles {
        address deployer;
        address admin;
        address institutionA;
        address institutionB;
        address solver;
        address lp;
    }

    struct Stack {
        IERC20Deploy token0;
        IERC20Deploy token1;
        MockERC20 hUSDT;
        MockEAS eas;
        CNFIssuer issuer;
        PolicyRegistry registry;
        ChainlinkStablecoinOracleGuard oracleGuard;
        InstitutionalBatchRouter router;
        InstitutionalNettingHook hook;
    }

    function run() external {
        require(block.chainid == 84532, "DeployHookathonNetting: Base Sepolia only");
        require(POOL_MANAGER.code.length != 0, "DeployHookathonNetting: PoolManager missing");
        require(POSITION_MANAGER.code.length != 0, "DeployHookathonNetting: PositionManager missing");
        require(PERMIT2.code.length != 0, "DeployHookathonNetting: Permit2 missing");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 institutionAKey = vm.envUint("INSTITUTION_A_PRIVATE_KEY");
        uint256 institutionBKey = vm.envUint("INSTITUTION_B_PRIVATE_KEY");
        uint256 lpKey = vm.envUint("LP_PRIVATE_KEY");
        uint256 usdcFunderKey = vm.envUint("USDC_FUNDER_PRIVATE_KEY");
        Roles memory roles = Roles({
            deployer: vm.addr(deployerKey),
            admin: vm.envAddress("SAFE_ADMIN"),
            institutionA: vm.addr(institutionAKey),
            institutionB: vm.addr(institutionBKey),
            solver: vm.envAddress("SOLVER"),
            lp: vm.addr(lpKey)
        });
        _validateRoles(roles);
        _requireUsdcAllocation(usdcFunderKey);

        vm.startBroadcast(deployerKey);
        Stack memory stack = _deployStack(roles);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(stack.token0)),
            currency1: Currency.wrap(address(stack.token1)),
            fee: FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(stack.hook))
        });
        bytes32 poolId = PoolId.unwrap(key.toId());
        IPoolManager(POOL_MANAGER).initialize(key, INITIAL_SQRT_PRICE);
        stack.registry.setPolicy(poolId, address(stack.issuer), SCHEMA_UID);

        uint64 sourceExpiry = uint64(block.timestamp + 90 days);
        bytes32 expectedAttestationA = stack.eas.nextUID(SCHEMA_UID, roles.institutionA, roles.admin, sourceExpiry, "");
        bytes32 attestationA = stack.eas.attest(SCHEMA_UID, roles.institutionA, roles.admin, sourceExpiry, "");
        require(attestationA == expectedAttestationA, "DeployHookathonNetting: attestation A UID mismatch");
        bytes32 expectedAttestationB = stack.eas.nextUID(SCHEMA_UID, roles.institutionB, roles.admin, sourceExpiry, "");
        bytes32 attestationB = stack.eas.attest(SCHEMA_UID, roles.institutionB, roles.admin, sourceExpiry, "");
        require(attestationB == expectedAttestationB, "DeployHookathonNetting: attestation B UID mismatch");
        _mintMockAssets(stack, roles);
        stack.registry.transferOwnership(roles.admin);
        stack.issuer.transferOwnership(roles.admin);
        stack.eas.transferOwnership(roles.admin);
        vm.stopBroadcast();

        _fundOfficialUsdc(usdcFunderKey, roles);
        _onboardInstitution(institutionAKey, stack, attestationA);
        _onboardInstitution(institutionBKey, stack, attestationB);
        _seedLiquidity(lpKey, stack, key);
        _printDeployment(stack, roles, key, poolId, attestationA, attestationB);
    }

    function _deployStack(Roles memory roles) internal returns (Stack memory stack) {
        stack.hUSDT = new MockERC20("ILAL Hookathon USDT Representation", "hUSDT", 6);
        IChainlinkAggregatorV3 feed0;
        IChainlinkAggregatorV3 feed1;
        if (CIRCLE_TEST_USDC < address(stack.hUSDT)) {
            stack.token0 = IERC20Deploy(CIRCLE_TEST_USDC);
            stack.token1 = IERC20Deploy(address(stack.hUSDT));
            feed0 = IChainlinkAggregatorV3(CHAINLINK_USDC_USD);
            feed1 = IChainlinkAggregatorV3(CHAINLINK_USDT_USD);
        } else {
            stack.token0 = IERC20Deploy(address(stack.hUSDT));
            stack.token1 = IERC20Deploy(CIRCLE_TEST_USDC);
            feed0 = IChainlinkAggregatorV3(CHAINLINK_USDT_USD);
            feed1 = IChainlinkAggregatorV3(CHAINLINK_USDC_USD);
        }
        stack.eas = new MockEAS();
        stack.issuer = new CNFIssuer(
            address(stack.eas),
            SCHEMA_UID,
            roles.admin,
            90 days,
            CNFIssuer.IssuerMetadata({
                name: "ILAL Hookathon Demo Issuer",
                jurisdiction: "Base Sepolia testnet",
                credentialStandard: "ILAL Institutional CNF v1",
                uri: "https://github.com/rpnny/ILAL"
            }),
            CNFIssuer.InitialZKConfig({verifier: address(0), merkleRoot: 0, issuerHash: 0, schemaHash: 0})
        );
        stack.registry = new PolicyRegistry();
        stack.router = new InstitutionalBatchRouter(IPoolManager(POOL_MANAGER));
        stack.oracleGuard = new ChainlinkStablecoinOracleGuard(
            feed0, feed1, 90_000, 90_000, 100, 100, IChainlinkAggregatorV3(address(0)), 0
        );
        stack.oracleGuard.validate();

        bytes memory constructorArgs = abi.encode(
            IPoolManager(POOL_MANAGER),
            stack.registry,
            stack.oracleGuard,
            address(stack.router),
            address(stack.token0),
            address(stack.token1),
            FEE,
            TICK_SPACING,
            MAX_ABS_TICK
        );
        (address expectedHook, bytes32 salt) = HookMiner.find(
            FOUNDRY_CREATE2_DEPLOYER, HOOK_FLAGS, type(InstitutionalNettingHook).creationCode, constructorArgs
        );
        stack.hook = new InstitutionalNettingHook{salt: salt}(
            IPoolManager(POOL_MANAGER),
            stack.registry,
            stack.oracleGuard,
            address(stack.router),
            address(stack.token0),
            address(stack.token1),
            FEE,
            TICK_SPACING,
            MAX_ABS_TICK
        );
        require(address(stack.hook) == expectedHook, "DeployHookathonNetting: hook address mismatch");
        require(uint160(address(stack.hook)) & uint160((1 << 14) - 1) == HOOK_FLAGS, "invalid hook flags");
        console.log("Hook CREATE2 salt:");
        console.logBytes32(salt);
    }

    function _mintMockAssets(Stack memory stack, Roles memory roles) internal {
        uint256 amount = vm.envOr("HUSDT_MINT", DEFAULT_HUSDT_MINT);
        stack.hUSDT.mint(roles.institutionA, amount);
        stack.hUSDT.mint(roles.institutionB, amount);
        stack.hUSDT.mint(roles.lp, amount);
    }

    function _fundOfficialUsdc(uint256 funderKey, Roles memory roles) internal {
        IERC20Deploy usdc = IERC20Deploy(CIRCLE_TEST_USDC);
        uint256 institutionAmount = vm.envOr("INSTITUTION_USDC", DEFAULT_INSTITUTION_USDC);
        uint256 lpAmount = vm.envOr("LP_USDC", DEFAULT_LP_USDC);
        vm.startBroadcast(funderKey);
        require(usdc.transfer(roles.institutionA, institutionAmount), "DeployHookathonNetting: USDC transfer A failed");
        require(usdc.transfer(roles.institutionB, institutionAmount), "DeployHookathonNetting: USDC transfer B failed");
        require(usdc.transfer(roles.lp, lpAmount), "DeployHookathonNetting: USDC transfer LP failed");
        vm.stopBroadcast();
    }

    function _requireUsdcAllocation(uint256 funderKey) internal view {
        uint256 institutionAmount = vm.envOr("INSTITUTION_USDC", DEFAULT_INSTITUTION_USDC);
        uint256 lpAmount = vm.envOr("LP_USDC", DEFAULT_LP_USDC);
        uint256 required = institutionAmount * 2 + lpAmount;
        uint256 available = IERC20Deploy(CIRCLE_TEST_USDC).balanceOf(vm.addr(funderKey));
        if (available < required) {
            console.log("Circle test USDC available:", available);
            console.log("Circle test USDC required: ", required);
            console.log("Circle test USDC deficit:  ", required - available);
            revert("DeployHookathonNetting: fund USDC role before deployment");
        }
        console.log("Circle test USDC preflight available:", available);
        console.log("Circle test USDC preflight required: ", required);
    }

    function _onboardInstitution(uint256 institutionKey, Stack memory stack, bytes32 attestation) internal {
        vm.startBroadcast(institutionKey);
        stack.issuer.mintWithEAS(attestation);
        stack.token0.approve(address(stack.router), type(uint256).max);
        stack.token1.approve(address(stack.router), type(uint256).max);
        vm.stopBroadcast();
    }

    function _seedLiquidity(uint256 lpKey, Stack memory stack, PoolKey memory key) internal {
        uint128 liquidity = uint128(vm.envOr("INITIAL_LIQUIDITY", uint256(DEFAULT_LIQUIDITY)));
        uint128 stabilizerLiquidity = uint128(vm.envOr("STABILIZER_LIQUIDITY", uint256(DEFAULT_STABILIZER_LIQUIDITY)));
        vm.startBroadcast(lpKey);
        stack.token0.approve(PERMIT2, type(uint256).max);
        stack.token1.approve(PERMIT2, type(uint256).max);
        IAllowanceTransfer(PERMIT2)
            .approve(address(stack.token0), POSITION_MANAGER, type(uint160).max, type(uint48).max);
        IAllowanceTransfer(PERMIT2)
            .approve(address(stack.token1), POSITION_MANAGER, type(uint160).max, type(uint48).max);

        bytes memory actions = abi.encodePacked(uint8(0x02), uint8(0x02), uint8(0x12), uint8(0x12));
        bytes[] memory params = new bytes[](4);
        params[0] = abi.encode(
            key,
            int24(-10000),
            int24(10000),
            uint256(liquidity),
            type(uint128).max,
            type(uint128).max,
            vm.addr(lpKey),
            bytes("")
        );
        params[1] = abi.encode(
            key,
            int24(-100),
            int24(100),
            uint256(stabilizerLiquidity),
            type(uint128).max,
            type(uint128).max,
            vm.addr(lpKey),
            bytes("")
        );
        params[2] = abi.encode(key.currency0);
        params[3] = abi.encode(key.currency1);
        IPositionManager(POSITION_MANAGER).modifyLiquidities(abi.encode(actions, params), block.timestamp + 10 minutes);
        vm.stopBroadcast();

        console.log("Wide-range liquidity:       ", liquidity);
        console.log("Wide range:                  [-10000, 10000]");
        console.log("Stabilizer liquidity:        ", stabilizerLiquidity);
        console.log("Stabilizer range:             [-100, 100]");
    }

    function _validateRoles(Roles memory roles) internal pure {
        address[5] memory named = [roles.admin, roles.institutionA, roles.institutionB, roles.solver, roles.lp];
        for (uint256 i; i < named.length; ++i) {
            require(named[i] != address(0), "DeployHookathonNetting: zero role");
            for (uint256 j = i + 1; j < named.length; ++j) {
                require(named[i] != named[j], "DeployHookathonNetting: roles must be distinct");
            }
        }
    }

    function _printDeployment(
        Stack memory stack,
        Roles memory roles,
        PoolKey memory key,
        bytes32 poolId,
        bytes32 attestationA,
        bytes32 attestationB
    ) internal view {
        console.log("\n===== ILAL Hookathon netting candidate =====");
        console.log("PoolManager:       ", POOL_MANAGER);
        console.log("PositionManager:   ", POSITION_MANAGER);
        console.log("Permit2:           ", PERMIT2);
        console.log("Token0:            ", address(stack.token0));
        console.log("Token1:            ", address(stack.token1));
        console.log("Circle test USDC:  ", CIRCLE_TEST_USDC);
        console.log("hUSDT:             ", address(stack.hUSDT));
        console.log("OracleGuard:       ", address(stack.oracleGuard));
        console.log("Oracle feed0:      ", address(stack.oracleGuard.feed0()));
        console.log("Oracle feed1:      ", address(stack.oracleGuard.feed1()));
        _printFeed("feed0", stack.oracleGuard.feed0());
        _printFeed("feed1", stack.oracleGuard.feed1());
        console.log("Oracle max age:     ", stack.oracleGuard.maxAge0());
        console.log("Oracle USD max bps: ", stack.oracleGuard.maxUsdDeviationBps());
        console.log("Oracle pair max bps:", stack.oracleGuard.maxPairDeviationBps());
        console.log("Sequencer check:     disabled on Base Sepolia");
        console.log("MockEAS:           ", address(stack.eas));
        console.log("CNFIssuer:         ", address(stack.issuer));
        console.log("PolicyRegistry:    ", address(stack.registry));
        console.log("BatchRouter:       ", address(stack.router));
        console.log("NettingHook:       ", address(stack.hook));
        console.log("Safe admin:        ", roles.admin);
        console.log("Institution A:     ", roles.institutionA);
        console.log("Institution B:     ", roles.institutionB);
        console.log("Solver:            ", roles.solver);
        console.log("LP:                ", roles.lp);
        console.log("Pool fee:          ", uint256(key.fee));
        console.log("Tick spacing:      ", key.tickSpacing);
        console.log("Hook flags:        ", uint256(HOOK_FLAGS));
        console.log("PoolId:");
        console.logBytes32(poolId);
        console.log("Institution A attestation:");
        console.logBytes32(attestationA);
        console.log("Institution B attestation:");
        console.logBytes32(attestationB);
        console.log("============================================");
    }

    function _printFeed(string memory label, IChainlinkAggregatorV3 feed) internal view {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        console.log(string.concat("Oracle ", label, " description: "), feed.description());
        console.log(string.concat("Oracle ", label, " decimals:    "), uint256(feed.decimals()));
        console.log(string.concat("Oracle ", label, " round:       "), uint256(roundId));
        console.log(string.concat("Oracle ", label, " answer:      "));
        console.logInt(answer);
        console.log(string.concat("Oracle ", label, " updatedAt:   "), updatedAt);
        console.log(string.concat("Oracle ", label, " answered:    "), uint256(answeredInRound));
    }
}
