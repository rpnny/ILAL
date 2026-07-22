// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CNFIssuer} from "../src/CNFIssuer.sol";
import {ICNFIssuer} from "../src/interfaces/ICNFIssuer.sol";
import {IEAS} from "../src/interfaces/IEAS.sol";
import {MockEAS} from "./mocks/MockEAS.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";

contract CNFIssuerTest is Test {
    CNFIssuer internal issuer;
    MockEAS internal eas;
    MockGroth16Verifier internal verifier;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal admin = makeAddr("admin");
    address internal attester = makeAddr("attester");

    bytes32 internal constant SCHEMA_UID = keccak256("coinbase.account.verification");
    bytes32 internal constant ATT_UID_1 = keccak256("attestation-1");
    bytes32 internal constant ATT_UID_2 = keccak256("attestation-2");
    bytes32 internal constant ATT_UID_3 = keccak256("attestation-3");

    // Matches PI_MERKLE_ROOT = 5 in CNFIssuer
    uint256 internal constant MOCK_MERKLE_ROOT = 0xdeadbeef;
    uint256 internal constant MOCK_ISSUER_HASH = 0x1111;
    uint256 internal constant MOCK_SCHEMA_HASH = 0x2222;

    function setUp() public {
        eas = new MockEAS();
        verifier = new MockGroth16Verifier();
        vm.startPrank(admin);
        issuer = new CNFIssuer(address(eas), SCHEMA_UID, attester, 0, _metadata(), _emptyZK());
        // Timelock: propose → warp past longest delay → activate
        issuer.proposeZKVerifier(address(verifier));
        issuer.proposeMerkleRoot(MOCK_MERKLE_ROOT);
        issuer.proposeZKPublicInputHashes(MOCK_ISSUER_HASH, MOCK_SCHEMA_HASH);
        vm.warp(block.timestamp + 73 hours); // > VERIFIER_DELAY(72h) and ROOT_DELAY(48h)
        issuer.activateZKVerifier();
        issuer.activateMerkleRoot();
        issuer.activateZKPublicInputHashes();
        vm.stopPrank();
    }

    function _metadata() internal pure returns (CNFIssuer.IssuerMetadata memory) {
        return CNFIssuer.IssuerMetadata({
            name: "ILAL Test Issuer",
            jurisdiction: "US testnet",
            credentialStandard: "Coinbase Account Verification / ILAL CNF",
            uri: "https://www.ilal.tech/demo-issuer"
        });
    }

    function _emptyZK() internal pure returns (CNFIssuer.InitialZKConfig memory) {
        return CNFIssuer.InitialZKConfig({verifier: address(0), merkleRoot: 0, issuerHash: 0, schemaHash: 0});
    }

    // ─── ZK proof helpers ─────────────────────────────────────────────────────

    // Builds a valid-looking proof + 6-element publicInputs array.
    // inputs[0] must be overwritten per-caller before use.
    function _buildProof() internal view returns (bytes memory proof, uint256[] memory inputs) {
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];
        proof = abi.encode(a, b, c);

        inputs = new uint256[](6);
        // inputs[0] = walletHash — filled per-caller
        inputs[1] = MOCK_ISSUER_HASH; // issuerHash
        inputs[2] = MOCK_SCHEMA_HASH; // schemaHash
        inputs[3] = uint256(block.timestamp + 90 days); // expiresAt
        inputs[4] = 0; // revealFlags
        inputs[5] = MOCK_MERKLE_ROOT; // merkleRoot
    }

    function _walletHash(address wallet) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(wallet))) >> 4;
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function test_constructor_setsIssuerMetadata() public view {
        (string memory name, string memory jurisdiction, string memory credentialStandard, string memory uri) =
            issuer.issuerMetadata();

        assertEq(name, "ILAL Test Issuer");
        assertEq(jurisdiction, "US testnet");
        assertEq(credentialStandard, "Coinbase Account Verification / ILAL CNF");
        assertEq(uri, "https://www.ilal.tech/demo-issuer");
    }

    function test_constructor_setsInitialZKConfig() public {
        MockGroth16Verifier initialVerifier = new MockGroth16Verifier();

        vm.prank(admin);
        CNFIssuer initialized = new CNFIssuer(
            address(eas),
            SCHEMA_UID,
            attester,
            0,
            _metadata(),
            CNFIssuer.InitialZKConfig({
                verifier: address(initialVerifier),
                merkleRoot: MOCK_MERKLE_ROOT,
                issuerHash: MOCK_ISSUER_HASH,
                schemaHash: MOCK_SCHEMA_HASH
            })
        );

        assertEq(address(initialized.zkVerifier()), address(initialVerifier));
        assertEq(initialized.merkleRoot(), MOCK_MERKLE_ROOT);
        assertEq(initialized.zkIssuerHash(), MOCK_ISSUER_HASH);
        assertEq(initialized.zkSchemaHash(), MOCK_SCHEMA_HASH);
    }

    function test_constructor_revert_partialZKConfig() public {
        vm.expectRevert(CNFIssuer.InvalidZKDomain.selector);
        vm.prank(admin);
        new CNFIssuer(
            address(eas),
            SCHEMA_UID,
            attester,
            0,
            _metadata(),
            CNFIssuer.InitialZKConfig({
                verifier: address(0), merkleRoot: MOCK_MERKLE_ROOT, issuerHash: MOCK_ISSUER_HASH, schemaHash: 0
            })
        );
    }

    function _makeAttestation(bytes32 uid, address recipient) internal view returns (IEAS.Attestation memory) {
        return IEAS.Attestation({
            uid: uid,
            schema: SCHEMA_UID,
            time: 1000,
            expirationTime: 0,
            revocationTime: 0,
            refUID: bytes32(0),
            recipient: recipient,
            attester: attester,
            revocable: true,
            data: ""
        });
    }

    function _setupAttestation(bytes32 uid, address recipient) internal {
        eas.setAttestation(uid, _makeAttestation(uid, recipient));
    }

    function _activateZKDomain(uint256 issuerHash, uint256 schemaHash) internal {
        vm.startPrank(admin);
        issuer.proposeZKPublicInputHashes(issuerHash, schemaHash);
        vm.warp(block.timestamp + issuer.ZK_DOMAIN_DELAY() + 1);
        issuer.activateZKPublicInputHashes();
        vm.stopPrank();
    }

    // ─── mintWithEAS ──────────────────────────────────────────────────────────

    function test_mintWithEAS_success() public {
        _setupAttestation(ATT_UID_1, alice);

        vm.prank(alice);
        uint256 tokenId = issuer.mintWithEAS(ATT_UID_1);

        assertEq(tokenId, 1);
        assertEq(issuer.credentialOf(alice), 1);
        assertTrue(issuer.isValid(alice));
        assertEq(issuer.ownerOf(tokenId), alice);
    }

    function test_mintWithEAS_setsExpiry() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.warp(1_000_000);

        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        ICNFIssuer.Credential memory cred = issuer.getCredential(1);
        assertEq(cred.expiresAt, 1_000_000 + 90 days);
    }

    function test_mintWithEAS_capsExpiryAtSourceAttestation() public {
        vm.warp(1_000_000);
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        a.expirationTime = uint64(block.timestamp + 10 days);
        eas.setAttestation(ATT_UID_1, a);

        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        assertEq(issuer.getCredential(1).expiresAt, block.timestamp + 10 days);
        assertEq(issuer.sourceAttestationUID(1), ATT_UID_1);
    }

    function test_mintWithEAS_revert_alreadyExists() public {
        _setupAttestation(ATT_UID_1, alice);
        _setupAttestation(ATT_UID_2, alice);

        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.CredentialAlreadyExists.selector);
        issuer.mintWithEAS(ATT_UID_2);
    }

    function test_mintWithEAS_revert_usedAttestation() public {
        _setupAttestation(ATT_UID_1, alice);

        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        // burn the credential to allow a new mint attempt
        // (can't re-use attestation regardless)
        // Try with same uid from bob's perspective — wrong recipient anyway
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, bob);
        a.uid = ATT_UID_1;
        eas.setAttestation(ATT_UID_1, a);

        vm.prank(bob);
        vm.expectRevert(CNFIssuer.AttestationAlreadyUsed.selector);
        issuer.mintWithEAS(ATT_UID_1);
    }

    function test_mintWithEAS_revert_wrongSchema() public {
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        a.schema = keccak256("wrong.schema");
        eas.setAttestation(ATT_UID_1, a);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.WrongSchema.selector);
        issuer.mintWithEAS(ATT_UID_1);
    }

    function test_mintWithEAS_revert_wrongAttester() public {
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        a.attester = makeAddr("evil");
        eas.setAttestation(ATT_UID_1, a);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.WrongAttester.selector);
        issuer.mintWithEAS(ATT_UID_1);
    }

    function test_mintWithEAS_revert_wrongRecipient() public {
        _setupAttestation(ATT_UID_1, bob); // attested to bob, alice tries

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.WrongRecipient.selector);
        issuer.mintWithEAS(ATT_UID_1);
    }

    function test_mintWithEAS_revert_attestationRevoked() public {
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        a.revocationTime = 999;
        eas.setAttestation(ATT_UID_1, a);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.AttestationRevoked.selector);
        issuer.mintWithEAS(ATT_UID_1);
    }

    function test_mintWithEAS_revert_attestationExpired() public {
        vm.warp(10_000);
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        a.expirationTime = 5_000; // already expired
        eas.setAttestation(ATT_UID_1, a);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.AttestationExpired.selector);
        issuer.mintWithEAS(ATT_UID_1);
    }

    // ─── renewWithEAS ─────────────────────────────────────────────────────────

    function test_renewWithEAS_success() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        // Fast-forward close to expiry
        vm.warp(block.timestamp + 89 days);
        assertTrue(issuer.isValid(alice));

        _setupAttestation(ATT_UID_2, alice);
        vm.prank(alice);
        issuer.renewWithEAS(ATT_UID_2);

        ICNFIssuer.Credential memory cred = issuer.getCredential(1);
        assertEq(cred.expiresAt, block.timestamp + 90 days);
        assertTrue(issuer.isValid(alice));
    }

    function test_renewWithEAS_revert_permanentlyRevoked() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.prank(admin);
        issuer.revoke(alice);
        assertFalse(issuer.isValid(alice));

        _setupAttestation(ATT_UID_2, alice);
        vm.prank(alice);
        vm.expectRevert(CNFIssuer.CredentialPermanentlyRevoked.selector);
        issuer.renewWithEAS(ATT_UID_2);

        assertFalse(issuer.isValid(alice));
    }

    function test_renewWithEAS_revert_noCredential() public {
        _setupAttestation(ATT_UID_1, alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.CredentialNotFound.selector);
        issuer.renewWithEAS(ATT_UID_1);
    }

    // ─── revoke ───────────────────────────────────────────────────────────────

    function test_revoke_success() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);
        assertTrue(issuer.isValid(alice));

        vm.prank(admin);
        issuer.revoke(alice);
        assertFalse(issuer.isValid(alice));
        assertTrue(issuer.permanentlyBanned(alice));
    }

    function test_revoke_revert_notOwner() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.prank(alice);
        vm.expectRevert();
        issuer.revoke(alice);
    }

    function test_revoke_revert_noCredential() public {
        vm.prank(admin);
        vm.expectRevert(CNFIssuer.CredentialNotFound.selector);
        issuer.revoke(alice);
    }

    // ─── isValid ──────────────────────────────────────────────────────────────

    function test_isValid_expiredCredential() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.warp(block.timestamp + 91 days);
        assertFalse(issuer.isValid(alice));
    }

    function test_isValid_noCredential() public view {
        assertFalse(issuer.isValid(alice));
    }

    function test_isValid_tracksUpstreamEASRevocation() public {
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        eas.setAttestation(ATT_UID_1, a);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);
        assertTrue(issuer.isValid(alice));

        a.revocationTime = uint64(block.timestamp);
        eas.setAttestation(ATT_UID_1, a);

        assertFalse(issuer.isValid(alice));
    }

    function test_isValid_tracksUpstreamEASMutation() public {
        IEAS.Attestation memory a = _makeAttestation(ATT_UID_1, alice);
        eas.setAttestation(ATT_UID_1, a);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        a.recipient = bob;
        eas.setAttestation(ATT_UID_1, a);

        assertFalse(issuer.isValid(alice));
    }

    // ─── Soulbound ────────────────────────────────────────────────────────────

    function test_transfer_reverts() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        uint256 tokenId = issuer.mintWithEAS(ATT_UID_1);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.TransferNotAllowed.selector);
        issuer.transferFrom(alice, bob, tokenId);
    }

    function test_safeTransfer_reverts() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        uint256 tokenId = issuer.mintWithEAS(ATT_UID_1);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.TransferNotAllowed.selector);
        issuer.safeTransferFrom(alice, bob, tokenId);
    }

    function test_approve_reverts() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        uint256 tokenId = issuer.mintWithEAS(ATT_UID_1);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.ApprovalNotAllowed.selector);
        issuer.approve(bob, tokenId);
    }

    function test_setApprovalForAll_reverts() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.ApprovalNotAllowed.selector);
        issuer.setApprovalForAll(bob, true);
    }

    // ─── mintWithProof ────────────────────────────────────────────────────────

    function test_mintWithProof_success() public {
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.prank(alice);
        uint256 tokenId = issuer.mintWithProof(proof, inputs);

        assertEq(tokenId, 1);
        assertTrue(issuer.isValid(alice));
        assertEq(issuer.ownerOf(tokenId), alice);
    }

    function test_mintWithProof_setsExpiry() public {
        vm.warp(1_000_000);
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[3] = uint256(block.timestamp + 90 days);

        vm.prank(alice);
        issuer.mintWithProof(proof, inputs);

        ICNFIssuer.Credential memory cred = issuer.getCredential(1);
        assertEq(cred.expiresAt, 1_000_000 + 90 days);
    }

    function test_mintWithProof_capsExpiryAtProofExpiry() public {
        vm.warp(1_000_000);
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[3] = block.timestamp + 10 days;

        vm.prank(alice);
        issuer.mintWithProof(proof, inputs);

        assertEq(issuer.getCredential(1).expiresAt, block.timestamp + 10 days);
        assertEq(issuer.sourceAttestationUID(1), bytes32(0));
    }

    function test_mintWithProof_success_configuredZKDomain() public {
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[1] = MOCK_ISSUER_HASH;
        inputs[2] = MOCK_SCHEMA_HASH;

        vm.prank(alice);
        uint256 tokenId = issuer.mintWithProof(proof, inputs);

        assertEq(tokenId, 1);
        assertTrue(issuer.isValid(alice));
    }

    function test_mintWithProof_revert_verifierNotSet() public {
        // Deploy a fresh issuer with no verifier
        vm.prank(admin);
        CNFIssuer fresh = new CNFIssuer(address(eas), SCHEMA_UID, attester, 0, _metadata(), _emptyZK());

        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.ZKVerifierNotSet.selector);
        fresh.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_domainNotConfigured() public {
        vm.prank(admin);
        CNFIssuer fresh = new CNFIssuer(address(eas), SCHEMA_UID, attester, 0, _metadata(), _emptyZK());
        vm.startPrank(admin);
        fresh.proposeZKVerifier(address(verifier));
        fresh.proposeMerkleRoot(MOCK_MERKLE_ROOT);
        vm.warp(block.timestamp + fresh.VERIFIER_DELAY() + 1);
        fresh.activateZKVerifier();
        fresh.activateMerkleRoot();
        vm.stopPrank();

        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.expectRevert(CNFIssuer.InvalidZKDomain.selector);
        vm.prank(alice);
        fresh.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_alreadyExists() public {
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.prank(alice);
        issuer.mintWithProof(proof, inputs);

        (bytes memory proof2, uint256[] memory inputs2) = _buildProof();
        inputs2[0] = _walletHash(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.CredentialAlreadyExists.selector);
        issuer.mintWithProof(proof2, inputs2);
    }

    function test_mintWithProof_revert_wrongWalletHash() public {
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(bob); // bob's hash but alice is calling

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.InvalidPublicInputs.selector);
        issuer.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_tooFewInputs() public {
        (bytes memory proof,) = _buildProof();
        uint256[] memory shortInputs = new uint256[](4); // needs 6

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.InvalidPublicInputs.selector);
        issuer.mintWithProof(proof, shortInputs);
    }

    function test_mintWithProof_revert_wrongMerkleRoot() public {
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[5] = 0xbad; // wrong root

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.InvalidMerkleRoot.selector);
        issuer.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_wrongIssuerHash() public {
        _activateZKDomain(MOCK_ISSUER_HASH, MOCK_SCHEMA_HASH);

        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[1] = 0xbad;
        inputs[2] = MOCK_SCHEMA_HASH;

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.InvalidIssuerHash.selector);
        issuer.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_wrongSchemaHash() public {
        _activateZKDomain(MOCK_ISSUER_HASH, MOCK_SCHEMA_HASH);

        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[1] = MOCK_ISSUER_HASH;
        inputs[2] = 0xbad;

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.InvalidSchemaHash.selector);
        issuer.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_expiresInPast() public {
        vm.warp(10_000);
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[3] = 5_000; // already expired

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.AttestationExpired.selector);
        issuer.mintWithProof(proof, inputs);
    }

    function test_mintWithProof_revert_proofFails() public {
        verifier.setResult(false);
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.ProofVerificationFailed.selector);
        issuer.mintWithProof(proof, inputs);
    }

    // ─── renewWithProof ───────────────────────────────────────────────────────

    function test_renewWithProof_success() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.warp(block.timestamp + 89 days);

        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);
        inputs[3] = uint256(block.timestamp + 90 days); // update expiry after warp
        inputs[5] = MOCK_MERKLE_ROOT;

        vm.prank(alice);
        issuer.renewWithProof(proof, inputs);

        ICNFIssuer.Credential memory cred = issuer.getCredential(1);
        assertEq(cred.expiresAt, block.timestamp + 90 days);
        assertTrue(issuer.isValid(alice));
    }

    function test_renewWithProof_revert_permanentlyRevoked() public {
        _setupAttestation(ATT_UID_1, alice);
        vm.prank(alice);
        issuer.mintWithEAS(ATT_UID_1);

        vm.prank(admin);
        issuer.revoke(alice);

        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.CredentialPermanentlyRevoked.selector);
        issuer.renewWithProof(proof, inputs);
    }

    function test_renewWithProof_revert_noCredential() public {
        (bytes memory proof, uint256[] memory inputs) = _buildProof();
        inputs[0] = _walletHash(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.CredentialNotFound.selector);
        issuer.renewWithProof(proof, inputs);
    }

    // ─── Timelock — ZK verifier ───────────────────────────────────────────────

    function test_proposeZKVerifier_emitsEvent() public {
        address newVerifier = makeAddr("newVerifier");
        uint256 expectedActivatesAt = block.timestamp + issuer.VERIFIER_DELAY();
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit CNFIssuer.ZKVerifierProposed(newVerifier, expectedActivatesAt);
        issuer.proposeZKVerifier(newVerifier);

        assertEq(issuer.pendingZKVerifier(), newVerifier);
        assertEq(issuer.pendingVerifierActivatesAt(), expectedActivatesAt);
    }

    function test_activateZKVerifier_afterDelay() public {
        address newVerifier = makeAddr("newVerifier");
        vm.startPrank(admin);
        issuer.proposeZKVerifier(newVerifier);
        vm.warp(block.timestamp + issuer.VERIFIER_DELAY() + 1);
        issuer.activateZKVerifier();
        vm.stopPrank();

        assertEq(address(issuer.zkVerifier()), newVerifier);
        assertEq(issuer.pendingZKVerifier(), address(0));
    }

    function test_activateZKVerifier_revert_tooEarly() public {
        address newVerifier = makeAddr("newVerifier");
        vm.startPrank(admin);
        issuer.proposeZKVerifier(newVerifier);
        // Only 1 hour has passed — delay is 72 h
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(CNFIssuer.TooEarly.selector, block.timestamp + issuer.VERIFIER_DELAY() - 1 hours)
        );
        issuer.activateZKVerifier();
        vm.stopPrank();
    }

    function test_activateZKVerifier_revert_noPending() public {
        vm.prank(admin);
        vm.expectRevert(CNFIssuer.NoPendingChange.selector);
        issuer.activateZKVerifier();
    }

    function test_proposeZKVerifier_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        issuer.proposeZKVerifier(makeAddr("newVerifier"));
    }

    function test_proposeZKVerifier_revert_zeroAddress() public {
        vm.expectRevert(CNFIssuer.InvalidZKVerifier.selector);
        vm.prank(admin);
        issuer.proposeZKVerifier(address(0));
    }

    // ─── Timelock — Merkle root ───────────────────────────────────────────────

    function test_proposeMerkleRoot_emitsEvent() public {
        uint256 newRoot = 0xc0ffee;
        uint256 expectedActivatesAt = block.timestamp + issuer.ROOT_DELAY();
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit CNFIssuer.MerkleRootProposed(newRoot, expectedActivatesAt);
        issuer.proposeMerkleRoot(newRoot);

        assertEq(issuer.pendingRoot(), newRoot);
        assertEq(issuer.pendingRootActivatesAt(), expectedActivatesAt);
    }

    function test_activateMerkleRoot_afterDelay() public {
        uint256 newRoot = 0xc0ffee;
        vm.startPrank(admin);
        issuer.proposeMerkleRoot(newRoot);
        vm.warp(block.timestamp + issuer.ROOT_DELAY() + 1);
        issuer.activateMerkleRoot();
        vm.stopPrank();

        assertEq(issuer.merkleRoot(), newRoot);
        assertEq(issuer.pendingRootActivatesAt(), 0);
    }

    function test_activateMerkleRoot_revert_tooEarly() public {
        uint256 newRoot = 0xc0ffee;
        vm.startPrank(admin);
        issuer.proposeMerkleRoot(newRoot);
        vm.warp(block.timestamp + 1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(CNFIssuer.TooEarly.selector, block.timestamp + issuer.ROOT_DELAY() - 1 hours)
        );
        issuer.activateMerkleRoot();
        vm.stopPrank();
    }

    function test_activateMerkleRoot_revert_noPending() public {
        vm.prank(admin);
        vm.expectRevert(CNFIssuer.NoPendingChange.selector);
        issuer.activateMerkleRoot();
    }

    function test_proposeMerkleRoot_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        issuer.proposeMerkleRoot(0xc0ffee);
    }

    function test_proposeMerkleRoot_revert_zeroRoot() public {
        vm.expectRevert(CNFIssuer.InvalidMerkleRoot.selector);
        vm.prank(admin);
        issuer.proposeMerkleRoot(0);
    }

    // ─── Timelock — ZK public-input domain ────────────────────────────────────

    function test_proposeZKPublicInputHashes_revert_zeroDomain() public {
        vm.startPrank(admin);
        vm.expectRevert(CNFIssuer.InvalidZKDomain.selector);
        issuer.proposeZKPublicInputHashes(0, MOCK_SCHEMA_HASH);
        vm.expectRevert(CNFIssuer.InvalidZKDomain.selector);
        issuer.proposeZKPublicInputHashes(MOCK_ISSUER_HASH, 0);
        vm.stopPrank();
    }

    function test_activateZKPublicInputHashes_revert_tooEarly() public {
        vm.startPrank(admin);
        issuer.proposeZKPublicInputHashes(MOCK_ISSUER_HASH, MOCK_SCHEMA_HASH);
        uint256 activatesAt = issuer.pendingZKDomainActivatesAt();
        vm.expectRevert(abi.encodeWithSelector(CNFIssuer.TooEarly.selector, activatesAt));
        issuer.activateZKPublicInputHashes();
        vm.stopPrank();
    }

    function test_activateZKPublicInputHashes_afterDelay() public {
        _activateZKDomain(MOCK_ISSUER_HASH, MOCK_SCHEMA_HASH);

        assertEq(issuer.zkIssuerHash(), MOCK_ISSUER_HASH);
        assertEq(issuer.zkSchemaHash(), MOCK_SCHEMA_HASH);
        assertEq(issuer.pendingZKDomainActivatesAt(), 0);
    }
}
