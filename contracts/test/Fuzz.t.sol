// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {CNFIssuer} from "../src/CNFIssuer.sol";
import {ICNFIssuer} from "../src/interfaces/ICNFIssuer.sol";
import {IEAS} from "../src/interfaces/IEAS.sol";
import {MockEAS} from "./mocks/MockEAS.sol";
import {MockGroth16Verifier} from "./mocks/MockGroth16Verifier.sol";

// ─── Fuzz: CNFIssuer soulbound ────────────────────────────────────────────────

/// @notice Fuzz and invariant tests covering:
///   1. Soulbound — any transfer always reverts regardless of params
///   2. isValid consistency — matches on-chain credential data
///   3. Timelock early-activation guard
///   4. Permanent ban survives renew attempts via both paths
contract FuzzCNFIssuer is Test {
    CNFIssuer internal issuer;
    MockEAS internal eas;
    MockGroth16Verifier internal verifier;

    address internal admin = makeAddr("admin");
    address internal attester = makeAddr("attester");

    bytes32 internal constant SCHEMA_UID = keccak256("coinbase.account.verification");
    uint256 internal constant MOCK_ROOT = 0xdeadbeef;

    function setUp() public {
        eas = new MockEAS();
        verifier = new MockGroth16Verifier();
        vm.startPrank(admin);
        issuer = new CNFIssuer(
            address(eas),
            SCHEMA_UID,
            attester,
            0,
            CNFIssuer.IssuerMetadata({
                name: "ILAL Test Issuer",
                jurisdiction: "US testnet",
                credentialStandard: "Coinbase Account Verification / ILAL CNF",
                uri: "https://www.ilal.tech/demo-issuer"
            }),
            CNFIssuer.InitialZKConfig({verifier: address(0), merkleRoot: 0, issuerHash: 0, schemaHash: 0})
        );
        issuer.proposeZKVerifier(address(verifier));
        issuer.proposeMerkleRoot(MOCK_ROOT);
        vm.warp(block.timestamp + 73 hours);
        issuer.activateZKVerifier();
        issuer.activateMerkleRoot();
        vm.stopPrank();
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _mintForAlice(address alice) internal returns (uint256 tokenId) {
        bytes32 attUID = keccak256(abi.encodePacked("att", alice));
        eas.setAttestation(
            attUID,
            IEAS.Attestation({
                uid: attUID,
                schema: SCHEMA_UID,
                time: 1000,
                expirationTime: 0,
                revocationTime: 0,
                refUID: bytes32(0),
                recipient: alice,
                attester: attester,
                revocable: true,
                data: ""
            })
        );
        vm.prank(alice);
        tokenId = issuer.mintWithEAS(attUID);
    }

    function _assumeEOAWallet(address wallet) internal view {
        vm.assume(wallet != address(0));
        vm.assume(wallet.code.length == 0);
    }

    // ─── Fuzz: transfer always reverts ───────────────────────────────────────

    /// @notice Fuzzing `from`, `to`, and any amount — soulbound must always block.
    function testFuzz_transfer_alwaysReverts(address from, address to) public {
        _assumeEOAWallet(from);
        vm.assume(to != address(0));
        vm.assume(from != to);

        // Only mint if `from` doesn't already have a token
        if (issuer.credentialOf(from) == 0) {
            _mintForAlice(from);
        }
        uint256 tokenId = issuer.credentialOf(from);
        if (tokenId == 0) return; // skip if mint somehow failed (shouldn't happen)

        vm.prank(from);
        vm.expectRevert(CNFIssuer.TransferNotAllowed.selector);
        issuer.transferFrom(from, to, tokenId);
    }

    /// @notice Fuzzing destination addresses — safeTransferFrom also must always block.
    function testFuzz_safeTransfer_alwaysReverts(address to) public {
        vm.assume(to != address(0));
        address alice = makeAddr("fuzzAlice");
        _mintForAlice(alice);
        uint256 tokenId = issuer.credentialOf(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.TransferNotAllowed.selector);
        issuer.safeTransferFrom(alice, to, tokenId);
    }

    /// @notice ERC-721 approvals must also be disabled because CNF is soulbound.
    function testFuzz_approve_alwaysReverts(address operator) public {
        vm.assume(operator != address(0));
        address alice = makeAddr("approvalAlice");
        _mintForAlice(alice);
        uint256 tokenId = issuer.credentialOf(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.ApprovalNotAllowed.selector);
        issuer.approve(operator, tokenId);
    }

    /// @notice Operator-wide approvals are disabled as well.
    function testFuzz_setApprovalForAll_alwaysReverts(address operator, bool approved) public {
        vm.assume(operator != address(0));
        address alice = makeAddr("approvalAllAlice");
        _mintForAlice(alice);

        vm.prank(alice);
        vm.expectRevert(CNFIssuer.ApprovalNotAllowed.selector);
        issuer.setApprovalForAll(operator, approved);
    }

    // ─── Fuzz: isValid consistent with expiresAt ─────────────────────────────

    /// @notice isValid(wallet) == (!revoked && expiresAt > block.timestamp)
    ///         This invariant must hold for any time warp and any wallet.
    function testFuzz_isValid_consistentWithCredential(address wallet, uint32 warpDelta) public {
        _assumeEOAWallet(wallet);
        if (issuer.credentialOf(wallet) == 0) {
            _mintForAlice(wallet);
        }
        uint256 tokenId = issuer.credentialOf(wallet);
        if (tokenId == 0) return;

        vm.warp(block.timestamp + uint256(warpDelta));

        ICNFIssuer.Credential memory cred = issuer.getCredential(tokenId);
        bool expected = !cred.revoked && cred.expiresAt > block.timestamp;
        assertEq(issuer.isValid(wallet), expected, "isValid must equal !revoked && expiresAt > now");
    }

    // ─── Fuzz: permanent ban — renew via EAS always reverts ──────────────────

    function testFuzz_permanentBan_blocksRenewEAS(address wallet) public {
        _assumeEOAWallet(wallet);
        vm.assume(wallet != admin);

        // Mint
        bytes32 attUID1 = keccak256(abi.encodePacked("att1", wallet));
        eas.setAttestation(
            attUID1,
            IEAS.Attestation({
                uid: attUID1,
                schema: SCHEMA_UID,
                time: 1000,
                expirationTime: 0,
                revocationTime: 0,
                refUID: bytes32(0),
                recipient: wallet,
                attester: attester,
                revocable: true,
                data: ""
            })
        );
        vm.prank(wallet);
        issuer.mintWithEAS(attUID1);

        // Revoke (permanently bans)
        vm.prank(admin);
        issuer.revoke(wallet);
        assertTrue(issuer.permanentlyBanned(wallet));

        // Renew via EAS must revert
        bytes32 attUID2 = keccak256(abi.encodePacked("att2", wallet));
        eas.setAttestation(
            attUID2,
            IEAS.Attestation({
                uid: attUID2,
                schema: SCHEMA_UID,
                time: 1000,
                expirationTime: 0,
                revocationTime: 0,
                refUID: bytes32(0),
                recipient: wallet,
                attester: attester,
                revocable: true,
                data: ""
            })
        );
        vm.prank(wallet);
        vm.expectRevert(CNFIssuer.CredentialPermanentlyRevoked.selector);
        issuer.renewWithEAS(attUID2);
    }

    // ─── Fuzz: timelock — activate before delay always reverts ───────────────

    function testFuzz_timelock_verifier_tooEarlyAlwaysReverts(uint32 elapsed) public {
        vm.assume(elapsed < issuer.VERIFIER_DELAY()); // strictly before the deadline

        address newVerifier = makeAddr("newVerifier");
        vm.startPrank(admin);
        issuer.proposeZKVerifier(newVerifier);
        uint256 activatesAt = issuer.pendingVerifierActivatesAt();

        vm.warp(block.timestamp + uint256(elapsed));
        if (block.timestamp < activatesAt) {
            vm.expectRevert(abi.encodeWithSelector(CNFIssuer.TooEarly.selector, activatesAt));
            issuer.activateZKVerifier();
        }
        vm.stopPrank();
    }

    function testFuzz_timelock_root_tooEarlyAlwaysReverts(uint32 elapsed) public {
        vm.assume(elapsed < issuer.ROOT_DELAY());

        vm.startPrank(admin);
        issuer.proposeMerkleRoot(0xc0ffee);
        uint256 activatesAt = issuer.pendingRootActivatesAt();

        vm.warp(block.timestamp + uint256(elapsed));
        if (block.timestamp < activatesAt) {
            vm.expectRevert(abi.encodeWithSelector(CNFIssuer.TooEarly.selector, activatesAt));
            issuer.activateMerkleRoot();
        }
        vm.stopPrank();
    }

    // ─── Fuzz: one-token-per-wallet invariant ─────────────────────────────────

    /// @notice A wallet can never hold more than one CNF token.
    function testFuzz_oneTokenPerWallet_cannotMintTwice(address wallet) public {
        _assumeEOAWallet(wallet);
        _mintForAlice(wallet);

        // Second mint must revert regardless of attestation
        bytes32 attUID2 = keccak256(abi.encodePacked("att2", wallet));
        eas.setAttestation(
            attUID2,
            IEAS.Attestation({
                uid: attUID2,
                schema: SCHEMA_UID,
                time: 1000,
                expirationTime: 0,
                revocationTime: 0,
                refUID: bytes32(0),
                recipient: wallet,
                attester: attester,
                revocable: true,
                data: ""
            })
        );
        vm.prank(wallet);
        vm.expectRevert(CNFIssuer.CredentialAlreadyExists.selector);
        issuer.mintWithEAS(attUID2);
    }
}
