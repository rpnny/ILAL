// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CNFIssuer} from "../src/CNFIssuer.sol";
import {IEAS} from "../src/interfaces/IEAS.sol";
import {EligibilityPolicyRegistryV2} from "../src/v2/EligibilityPolicyRegistryV2.sol";
import {PolicyGrantManagerV2} from "../src/v2/PolicyGrantManagerV2.sol";
import {MockEAS} from "./mocks/MockEAS.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";

contract StudyAllowlist {
    mapping(address => bool) public allowed;

    function setAllowed(address user, bool value) external {
        allowed[user] = value;
    }
}

contract InstitutionalTcoStudy is Test {
    bytes32 internal constant POOL_ID = keccak256("tco-pool");
    bytes32 internal constant SCHEMA_UID = keccak256("institutional-kyc-v1");
    address internal admin = makeAddr("admin");
    address internal alice = makeAddr("alice");
    address internal attester = makeAddr("attester");

    function testStudy_tcoGasPrimitives() public {
        MockEAS eas = new MockEAS();
        CNFIssuer issuer = new CNFIssuer(
            address(eas),
            SCHEMA_UID,
            attester,
            0,
            CNFIssuer.IssuerMetadata({name: "Study", jurisdiction: "synthetic", credentialStandard: "study", uri: ""}),
            CNFIssuer.InitialZKConfig({verifier: address(0), merkleRoot: 0, issuerHash: 0, schemaHash: 0})
        );
        bytes32 uid = keccak256("study-attestation");
        IEAS.Attestation memory attestation = IEAS.Attestation({
            uid: uid,
            schema: SCHEMA_UID,
            time: uint64(block.timestamp),
            expirationTime: 0,
            revocationTime: 0,
            refUID: bytes32(0),
            recipient: alice,
            attester: attester,
            revocable: true,
            data: ""
        });
        uint256 start = gasleft();
        eas.setAttestation(uid, attestation);
        uint256 v1AttestationGas = start - gasleft();
        start = gasleft();
        vm.prank(alice);
        issuer.mintWithEAS(uid);
        uint256 v1MintGas = start - gasleft();

        EligibilityPolicyRegistryV2 registry = new EligibilityPolicyRegistryV2(admin);
        MockGroth16Verifier verifier = new MockGroth16Verifier();
        PolicyGrantManagerV2 grants = new PolicyGrantManagerV2(admin, verifier, registry);
        start = gasleft();
        vm.prank(admin);
        registry.setEligibilityPolicy(POOL_ID, 11, 22, 33, 2, 44, 55, 1 days);
        uint256 v2PolicyGas = start - gasleft();
        uint256[] memory inputs = new uint256[](9);
        inputs[0] = uint256(keccak256(abi.encodePacked(alice))) >> 4;
        inputs[1] = 11;
        inputs[2] = 22;
        inputs[3] = block.timestamp + 30 days;
        inputs[4] = 33;
        inputs[5] = 2;
        inputs[6] = 44;
        inputs[7] = 55;
        inputs[8] = 2;
        bytes memory proof = abi.encode(
            [uint256(1), uint256(2)], [[uint256(3), uint256(4)], [uint256(5), uint256(6)]], [uint256(7), uint256(8)]
        );
        start = gasleft();
        vm.prank(alice);
        grants.activatePolicyGrant(POOL_ID, proof, inputs);
        uint256 v2GrantGas = start - gasleft();

        StudyAllowlist allowlist = new StudyAllowlist();
        start = gasleft();
        allowlist.setAllowed(alice, true);
        uint256 allowlistWriteGas = start - gasleft();

        emit log_string(string.concat(
                "TCOGAS|v1Attestation=",
                vm.toString(v1AttestationGas),
                "|v1Mint=",
                vm.toString(v1MintGas),
                "|v2Policy=",
                vm.toString(v2PolicyGas),
                "|v2Grant=",
                vm.toString(v2GrantGas),
                "|allowlistWrite=",
                vm.toString(allowlistWriteGas)
            ));
    }
}
