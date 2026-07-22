// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IEAS} from "./interfaces/IEAS.sol";
import {ICNFIssuer} from "./interfaces/ICNFIssuer.sol";
import {IGroth16Verifier} from "./interfaces/IGroth16Verifier.sol";

/// @title CNFIssuer
/// @notice Mints non-transferable compliance credentials.
///         Two issuance paths:
///           A. EAS  — direct Coinbase attestation verification (MVP A)
///           B. ZK   — Groth16 proof of eligibility without revealing identity (MVP B)
///         One credential per wallet. Soulbound — transfers blocked.
contract CNFIssuer is ICNFIssuer, ERC721, Ownable {
    // ─── Errors ───────────────────────────────────────────────────────────────

    error TransferNotAllowed();
    error ApprovalNotAllowed();
    error AttestationAlreadyUsed();
    error AttestationRevoked();
    error AttestationExpired();
    error WrongSchema();
    error WrongAttester();
    error WrongRecipient();
    error CredentialAlreadyExists();
    error CredentialNotFound();
    error ProofVerificationFailed();
    error ZKVerifierNotSet();
    error InvalidPublicInputs();
    error InvalidIssuerHash();
    error InvalidSchemaHash();
    error InvalidMerkleRoot();
    error InvalidZKVerifier();
    error CredentialPermanentlyRevoked();
    error InvalidZKDomain();
    error TooEarly(uint256 activatesAt);
    error NoPendingChange();

    // ─── Events ───────────────────────────────────────────────────────────────

    event CredentialMinted(address indexed holder, uint256 indexed tokenId, uint64 expiresAt);
    event CredentialRenewed(address indexed holder, uint256 indexed tokenId, uint64 newExpiresAt);
    event CredentialRevoked(address indexed holder, uint256 indexed tokenId);
    event ZKVerifierProposed(address indexed proposed, uint256 activatesAt);
    event ZKVerifierUpdated(address indexed oldVerifier, address indexed newVerifier);
    event MerkleRootProposed(uint256 indexed proposed, uint256 activatesAt);
    event MerkleRootUpdated(uint256 indexed oldRoot, uint256 indexed newRoot);
    event ZKPublicInputHashesProposed(uint256 indexed issuerHash, uint256 indexed schemaHash, uint256 activatesAt);
    event ZKPublicInputHashesUpdated(uint256 indexed issuerHash, uint256 indexed schemaHash);
    event SourceAttestationLinked(uint256 indexed tokenId, bytes32 indexed attestationUID);
    event IssuerMetadataSet(string name, string jurisdiction, string credentialStandard, string uri);

    // ─── Types ────────────────────────────────────────────────────────────────

    struct IssuerMetadata {
        string name;
        string jurisdiction;
        string credentialStandard;
        string uri;
    }

    struct InitialZKConfig {
        address verifier;
        uint256 merkleRoot;
        uint256 issuerHash;
        uint256 schemaHash;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    IEAS public immutable eas;
    bytes32 public immutable schemaUID;
    address public immutable trustedAttester;
    uint64 public immutable credentialLifetime;
    string public issuerName;
    string public issuerJurisdiction;
    string public issuerCredentialStandard;
    string public issuerURI;

    // ZK verifier — set after circuit deployment (Phase 4)
    IGroth16Verifier public zkVerifier;
    uint256 public zkIssuerHash;
    uint256 public zkSchemaHash;

    // Approved attestation Merkle root — updated by operator as new wallets are attested.
    // The circuit constrains publicInputs[PI_MERKLE_ROOT] == this value, preventing
    // anyone from building their own arbitrary Merkle tree to bypass compliance checks.
    uint256 public merkleRoot;

    // ─── Timelock state ───────────────────────────────────────────────────────
    // Prevents instant key-ceremony compromise: a 72-hour window lets anyone
    // detect a malicious verifier swap before it can be activated.
    uint256 public constant VERIFIER_DELAY = 72 hours;
    // Merkle root delay is shorter (48 h) because root updates are frequent
    // during normal operation (new attested wallets), but still long enough
    // for off-chain monitoring to catch a forged tree.
    uint256 public constant ROOT_DELAY = 48 hours;
    uint256 public constant ZK_DOMAIN_DELAY = 72 hours;

    address public pendingZKVerifier;
    uint256 public pendingVerifierActivatesAt;

    uint256 public pendingRoot;
    uint256 public pendingRootActivatesAt;

    uint256 public pendingZKIssuerHash;
    uint256 public pendingZKSchemaHash;
    uint256 public pendingZKDomainActivatesAt;

    uint256 private _nextTokenId;
    mapping(address => uint256) private _holderToken;
    mapping(uint256 => Credential) private _credentials;
    mapping(bytes32 => bool) private _usedAttestations;
    mapping(uint256 => bytes32) public sourceAttestationUID;
    mapping(address => bool) public permanentlyBanned;

    // ─── Public input indices (must match Circom circuit ilal.circom) ────────
    uint256 constant PI_WALLET_HASH = 0;
    uint256 constant PI_ISSUER_HASH = 1;
    uint256 constant PI_SCHEMA_HASH = 2;
    uint256 constant PI_EXPIRES_AT = 3;
    uint256 constant PI_REVEAL_FLAGS = 4;
    uint256 constant PI_MERKLE_ROOT = 5;
    uint256 constant PI_MIN_INPUTS = 6;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(
        address _eas,
        bytes32 _schemaUID,
        address _trustedAttester,
        uint64 _credentialLifetime,
        IssuerMetadata memory _metadata,
        InitialZKConfig memory _initialZK
    ) ERC721("ILAL Compliance Credential", "CNF") Ownable(msg.sender) {
        eas = IEAS(_eas);
        schemaUID = _schemaUID;
        trustedAttester = _trustedAttester;
        credentialLifetime = _credentialLifetime == 0 ? uint64(90 days) : _credentialLifetime;

        issuerName = _metadata.name;
        issuerJurisdiction = _metadata.jurisdiction;
        issuerCredentialStandard = _metadata.credentialStandard;
        issuerURI = _metadata.uri;
        emit IssuerMetadataSet(_metadata.name, _metadata.jurisdiction, _metadata.credentialStandard, _metadata.uri);

        if ((_initialZK.issuerHash == 0) != (_initialZK.schemaHash == 0)) revert InvalidZKDomain();
        if (_initialZK.verifier != address(0)) {
            zkVerifier = IGroth16Verifier(_initialZK.verifier);
            emit ZKVerifierUpdated(address(0), _initialZK.verifier);
        }
        if (_initialZK.merkleRoot != 0) {
            merkleRoot = _initialZK.merkleRoot;
            emit MerkleRootUpdated(0, _initialZK.merkleRoot);
        }
        if (_initialZK.issuerHash != 0) {
            zkIssuerHash = _initialZK.issuerHash;
            zkSchemaHash = _initialZK.schemaHash;
            emit ZKPublicInputHashesUpdated(_initialZK.issuerHash, _initialZK.schemaHash);
        }
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /// @notice Begin a timelock to replace the ZK verifier contract.
    ///         The new verifier cannot be activated until VERIFIER_DELAY (72 h) elapses,
    ///         giving off-chain monitors time to detect a malicious substitution.
    function proposeZKVerifier(address _verifier) external onlyOwner {
        if (_verifier == address(0)) revert InvalidZKVerifier();
        pendingZKVerifier = _verifier;
        pendingVerifierActivatesAt = block.timestamp + VERIFIER_DELAY;
        emit ZKVerifierProposed(_verifier, pendingVerifierActivatesAt);
    }

    /// @notice Activate the previously proposed ZK verifier after the timelock has elapsed.
    function activateZKVerifier() external onlyOwner {
        if (pendingZKVerifier == address(0)) revert NoPendingChange();
        if (block.timestamp < pendingVerifierActivatesAt) revert TooEarly(pendingVerifierActivatesAt);
        emit ZKVerifierUpdated(address(zkVerifier), pendingZKVerifier);
        zkVerifier = IGroth16Verifier(pendingZKVerifier);
        pendingZKVerifier = address(0);
        pendingVerifierActivatesAt = 0;
    }

    /// @notice Begin a timelock to replace the Merkle root.
    ///         ROOT_DELAY (48 h) lets off-chain monitors verify the new tree before it goes live.
    function proposeMerkleRoot(uint256 _root) external onlyOwner {
        if (_root == 0) revert InvalidMerkleRoot();
        pendingRoot = _root;
        pendingRootActivatesAt = block.timestamp + ROOT_DELAY;
        emit MerkleRootProposed(_root, pendingRootActivatesAt);
    }

    /// @notice Activate the previously proposed Merkle root after the timelock has elapsed.
    function activateMerkleRoot() external onlyOwner {
        if (pendingRootActivatesAt == 0) revert NoPendingChange();
        if (block.timestamp < pendingRootActivatesAt) revert TooEarly(pendingRootActivatesAt);
        emit MerkleRootUpdated(merkleRoot, pendingRoot);
        merkleRoot = pendingRoot;
        pendingRoot = 0;
        pendingRootActivatesAt = 0;
    }

    /// @notice Queue a new issuer/schema domain for ZK proofs. Both hashes are
    ///         mandatory so an admin cannot silently disable one of the bindings.
    function proposeZKPublicInputHashes(uint256 _issuerHash, uint256 _schemaHash) external onlyOwner {
        if (_issuerHash == 0 || _schemaHash == 0) revert InvalidZKDomain();
        pendingZKIssuerHash = _issuerHash;
        pendingZKSchemaHash = _schemaHash;
        pendingZKDomainActivatesAt = block.timestamp + ZK_DOMAIN_DELAY;
        emit ZKPublicInputHashesProposed(_issuerHash, _schemaHash, pendingZKDomainActivatesAt);
    }

    function activateZKPublicInputHashes() external onlyOwner {
        if (pendingZKDomainActivatesAt == 0) revert NoPendingChange();
        if (block.timestamp < pendingZKDomainActivatesAt) revert TooEarly(pendingZKDomainActivatesAt);
        zkIssuerHash = pendingZKIssuerHash;
        zkSchemaHash = pendingZKSchemaHash;
        emit ZKPublicInputHashesUpdated(zkIssuerHash, zkSchemaHash);
        pendingZKIssuerHash = 0;
        pendingZKSchemaHash = 0;
        pendingZKDomainActivatesAt = 0;
    }

    // ─── EAS path (MVP A) ─────────────────────────────────────────────────────

    function mintWithEAS(bytes32 attestationUID) external returns (uint256 tokenId) {
        if (permanentlyBanned[msg.sender]) revert CredentialPermanentlyRevoked();
        if (_holderToken[msg.sender] != 0) revert CredentialAlreadyExists();

        uint64 sourceExpiresAt = _verifyAttestation(attestationUID, msg.sender);
        _usedAttestations[attestationUID] = true;

        return _mint(msg.sender, sourceExpiresAt, attestationUID);
    }

    function renewWithEAS(bytes32 attestationUID) external {
        uint256 tokenId = _holderToken[msg.sender];
        if (tokenId == 0) revert CredentialNotFound();

        uint64 sourceExpiresAt = _verifyAttestation(attestationUID, msg.sender);
        _usedAttestations[attestationUID] = true;

        _renew(tokenId, sourceExpiresAt, attestationUID);
    }

    // ─── ZK proof path (MVP B) ────────────────────────────────────────────────

    /// @notice Mint a CNF using a Groth16 ZK proof of eligibility.
    /// @param proof         ABI-encoded (a, b, c) proof points
    /// @param publicInputs  Circuit public inputs — see PI_* constants for layout
    function mintWithProof(bytes calldata proof, uint256[] calldata publicInputs) external returns (uint256 tokenId) {
        if (permanentlyBanned[msg.sender]) revert CredentialPermanentlyRevoked();
        if (address(zkVerifier) == address(0)) revert ZKVerifierNotSet();
        if (_holderToken[msg.sender] != 0) revert CredentialAlreadyExists();

        _verifyProof(proof, publicInputs);

        return _mint(msg.sender, uint64(publicInputs[PI_EXPIRES_AT]), bytes32(0));
    }

    /// @notice Renew a CNF using a Groth16 ZK proof.
    function renewWithProof(bytes calldata proof, uint256[] calldata publicInputs) external {
        if (address(zkVerifier) == address(0)) revert ZKVerifierNotSet();

        uint256 tokenId = _holderToken[msg.sender];
        if (tokenId == 0) revert CredentialNotFound();

        _verifyProof(proof, publicInputs);
        _renew(tokenId, uint64(publicInputs[PI_EXPIRES_AT]), bytes32(0));
    }

    // ─── Management ───────────────────────────────────────────────────────────

    function revoke(address wallet) external onlyOwner {
        uint256 tokenId = _holderToken[wallet];
        if (tokenId == 0) revert CredentialNotFound();

        permanentlyBanned[wallet] = true;
        _credentials[tokenId].revoked = true;
        emit CredentialRevoked(wallet, tokenId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function isValid(address wallet) external view returns (bool) {
        uint256 tokenId = _holderToken[wallet];
        if (tokenId == 0) return false;
        Credential storage cred = _credentials[tokenId];
        if (cred.revoked || cred.expiresAt <= block.timestamp) return false;

        bytes32 uid = sourceAttestationUID[tokenId];
        if (uid == bytes32(0)) return true;
        return _isSourceAttestationValid(uid, wallet);
    }

    function credentialOf(address wallet) external view returns (uint256 tokenId) {
        return _holderToken[wallet];
    }

    function getCredential(uint256 tokenId) external view returns (Credential memory) {
        return _credentials[tokenId];
    }

    function issuerMetadata()
        external
        view
        returns (string memory name, string memory jurisdiction, string memory credentialStandard, string memory uri)
    {
        return (issuerName, issuerJurisdiction, issuerCredentialStandard, issuerURI);
    }

    // ─── Soulbound ────────────────────────────────────────────────────────────

    function approve(address, uint256) public pure override {
        revert ApprovalNotAllowed();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert ApprovalNotAllowed();
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) revert TransferNotAllowed();
        return super._update(to, tokenId, auth);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────

    function _mint(address holder, uint64 sourceExpiresAt, bytes32 attestationUID) internal returns (uint256 tokenId) {
        tokenId = ++_nextTokenId;
        uint64 expiresAt = _effectiveExpiry(sourceExpiresAt);

        _credentials[tokenId] = Credential({
            holder: holder,
            issuer: address(this),
            credentialType: schemaUID,
            issuedAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            revoked: false
        });

        _holderToken[holder] = tokenId;
        sourceAttestationUID[tokenId] = attestationUID;
        _safeMint(holder, tokenId);
        if (attestationUID != bytes32(0)) emit SourceAttestationLinked(tokenId, attestationUID);
        emit CredentialMinted(holder, tokenId, expiresAt);
    }

    function _renew(uint256 tokenId, uint64 sourceExpiresAt, bytes32 attestationUID) internal {
        Credential storage cred = _credentials[tokenId];
        if (permanentlyBanned[cred.holder]) revert CredentialPermanentlyRevoked();
        cred.expiresAt = _effectiveExpiry(sourceExpiresAt);
        cred.revoked = false;
        sourceAttestationUID[tokenId] = attestationUID;
        if (attestationUID != bytes32(0)) emit SourceAttestationLinked(tokenId, attestationUID);
        emit CredentialRenewed(msg.sender, tokenId, cred.expiresAt);
    }

    function _effectiveExpiry(uint64 sourceExpiresAt) internal view returns (uint64) {
        uint64 localExpiresAt = uint64(block.timestamp) + credentialLifetime;
        if (sourceExpiresAt != 0 && sourceExpiresAt < localExpiresAt) return sourceExpiresAt;
        return localExpiresAt;
    }

    function _verifyAttestation(bytes32 uid, address expectedRecipient) internal view returns (uint64 expirationTime) {
        if (_usedAttestations[uid]) revert AttestationAlreadyUsed();

        IEAS.Attestation memory a = eas.getAttestation(uid);

        if (a.schema != schemaUID) revert WrongSchema();
        if (a.attester != trustedAttester) revert WrongAttester();
        if (a.recipient != expectedRecipient) revert WrongRecipient();
        if (a.revocationTime != 0) revert AttestationRevoked();
        if (a.expirationTime != 0 && a.expirationTime <= block.timestamp) revert AttestationExpired();
        return a.expirationTime;
    }

    function _isSourceAttestationValid(bytes32 uid, address expectedRecipient) internal view returns (bool) {
        IEAS.Attestation memory a = eas.getAttestation(uid);
        return a.uid == uid && a.schema == schemaUID && a.attester == trustedAttester
            && a.recipient == expectedRecipient && a.revocationTime == 0
            && (a.expirationTime == 0 || a.expirationTime > block.timestamp);
    }

    function _verifyProof(bytes calldata proof, uint256[] calldata publicInputs) internal view {
        if (publicInputs.length < PI_MIN_INPUTS) revert InvalidPublicInputs();
        if (zkIssuerHash == 0 || zkSchemaHash == 0) revert InvalidZKDomain();

        // Wallet hash must match msg.sender — prevents using someone else's proof
        uint256 expectedWalletHash = uint256(keccak256(abi.encodePacked(msg.sender))) >> 4;
        if (publicInputs[PI_WALLET_HASH] != expectedWalletHash) revert InvalidPublicInputs();

        if (publicInputs[PI_ISSUER_HASH] != zkIssuerHash) revert InvalidIssuerHash();
        if (publicInputs[PI_SCHEMA_HASH] != zkSchemaHash) revert InvalidSchemaHash();

        // Merkle root must match the current operator-approved attestation set —
        // prevents provers from building a fake tree with their own wallet
        if (publicInputs[PI_MERKLE_ROOT] != merkleRoot) revert InvalidMerkleRoot();

        // Credential must not already be expired
        if (publicInputs[PI_EXPIRES_AT] <= block.timestamp || publicInputs[PI_EXPIRES_AT] > type(uint64).max) {
            revert AttestationExpired();
        }

        // Decode and verify Groth16 proof
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));

        if (!zkVerifier.verifyProof(a, b, c, publicInputs)) revert ProofVerificationFailed();
    }
}
