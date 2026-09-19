// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {MixedAuthorization} from "./MixedAuthorization.sol";
import {MixedTypes} from "./MixedTypes.sol";
import {MixedPolicyRegistry} from "./MixedPolicyRegistry.sol";
import {IMixedEligibility} from "./IMixedEligibility.sol";
import {ICNFIssuer} from "../interfaces/ICNFIssuer.sol";
import {IGroth16Verifier} from "../interfaces/IGroth16Verifier.sol";

contract MixedGrantManager is MixedAuthorization, IMixedEligibility {
    struct Grant {
        bytes32 policyHash;
        uint64 revision;
        uint64 rootEpoch;
        uint64 userEpoch;
        uint64 expiresAt;
        uint8 source;
        uint256 root;
        uint256 credentialId;
    }
    MixedPolicyRegistry public immutable registry;
    IGroth16Verifier public immutable verifier;
    mapping(bytes32 => mapping(address => Grant)) public grants;
    event GrantActivated(
        bytes32 indexed poolId, address indexed user, uint8 source, uint64 revision, uint64 rootEpoch, uint64 expiresAt
    );

    constructor(MixedPolicyRegistry r, IGroth16Verifier v) MixedAuthorization("ILAL Mixed Grant") {
        require(address(r).code.length > 0 && address(v).code.length > 0, "CONFIG");
        registry = r;
        verifier = v;
    }

    function activationDigest(MixedTypes.Activation calldata a) external view returns (bytes32) {
        return _hashTypedDataV4(MixedTypes.hashActivation(a));
    }

    function activate(
        MixedTypes.Activation calldata a,
        bytes calldata signature,
        bytes calldata proof,
        uint256[] calldata inputs
    ) external {
        _authorize(a.user, MixedTypes.hashActivation(a), a.deadline, signature);
        require(a.evidenceHash == keccak256(abi.encode(proof, inputs)), "EVIDENCE");
        MixedPolicyRegistry.Policy memory p = registry.getPolicy(a.poolId);
        require(p.enabled && p.revision == a.policyRevision && p.executionPolicyHash == a.executionPolicyHash, "POLICY");
        require(
            p.config.acceptedRoot == a.acceptedRoot && p.rootEpoch == a.rootEpoch && !registry.banned(a.poolId, a.user),
            "ROOT_OR_BAN"
        );
        require(_sourceAllowed(p.config.mode, a.source), "SOURCE");
        _consume(a.user, MixedTypes.GRANT_ACTIVATION, a.nonce);
        uint64 expiry = uint64(block.timestamp + p.config.maxGrantTTL);
        uint256 id;
        if (a.source & 1 != 0) {
            uint64 cnfExpiry;
            (id, cnfExpiry) = _cnf(p.config, a.user);
            if (cnfExpiry < expiry) expiry = cnfExpiry;
        }
        if (a.source & 2 != 0) {
            require(p.zkEnabled, "ROOT_DISABLED");
            uint64 zkExpiry = _proof(p.config, a.user, proof, inputs);
            if (zkExpiry < expiry) expiry = zkExpiry;
        } else {
            require(proof.length == 0 && inputs.length == 0, "UNUSED_PROOF");
        }
        grants[a.poolId][a.user] = Grant(
            p.executionPolicyHash,
            p.revision,
            p.rootEpoch,
            registry.userEpoch(a.poolId, a.user),
            expiry,
            a.source,
            p.config.acceptedRoot,
            id
        );
        emit GrantActivated(a.poolId, a.user, a.source, p.revision, p.rootEpoch, expiry);
    }

    function isEligible(bytes32 poolId, address user, bytes32 policyHash, uint64 revision)
        external
        view
        returns (bool)
    {
        Grant memory g = grants[poolId][user];
        MixedPolicyRegistry.Policy memory p = registry.getPolicy(poolId);
        if (
            !p.enabled || p.revision != revision || p.executionPolicyHash != policyHash || g.policyHash != policyHash
                || g.revision != revision || g.expiresAt <= block.timestamp
        ) return false;
        if (
            registry.banned(poolId, user) || g.userEpoch != registry.userEpoch(poolId, user)
                || !_sourceAllowed(p.config.mode, g.source)
        ) return false;
        if (g.source & 2 != 0 && (!p.zkEnabled || g.root != p.config.acceptedRoot || g.rootEpoch != p.rootEpoch)) {
            return false;
        }
        if (g.source & 1 != 0) {
            ICNFIssuer issuer = ICNFIssuer(p.config.cnfIssuer);
            try issuer.isValid(user) returns (bool valid) {
                if (!valid) return false;
            } catch {
                return false;
            }
            try issuer.credentialOf(user) returns (uint256 id) {
                if (id == 0 || id != g.credentialId) return false;
            } catch {
                return false;
            }
            try issuer.getCredential(g.credentialId) returns (ICNFIssuer.Credential memory c) {
                if (
                    c.holder != user || c.credentialType != p.config.credentialType || c.revoked
                        || c.expiresAt <= block.timestamp
                ) return false;
            } catch {
                return false;
            }
        }
        return true;
    }

    function _cnf(MixedPolicyRegistry.Config memory c, address user) private view returns (uint256 id, uint64 expiry) {
        ICNFIssuer issuer = ICNFIssuer(c.cnfIssuer);
        require(issuer.isValid(user), "CNF_INVALID");
        id = issuer.credentialOf(user);
        ICNFIssuer.Credential memory credential = issuer.getCredential(id);
        require(
            id != 0 && credential.holder == user && credential.credentialType == c.credentialType && !credential.revoked
                && credential.expiresAt > block.timestamp,
            "CNF_TYPE"
        );
        expiry = credential.expiresAt;
    }

    function _proof(MixedPolicyRegistry.Config memory c, address user, bytes calldata proof, uint256[] calldata inputs)
        private
        view
        returns (uint64)
    {
        require(inputs.length == 9, "PUBLIC_INPUTS");
        require(
            inputs[0] == uint256(keccak256(abi.encodePacked(user))) >> 4 && inputs[1] == c.issuerHash
                && inputs[2] == c.schemaHash,
            "PROOF_DOMAIN"
        );
        require(
            inputs[3] > block.timestamp && inputs[3] <= type(uint64).max && inputs[4] == c.acceptedRoot
                && inputs[5] == c.minKycLevel,
            "PROOF_CREDENTIAL"
        );
        require(inputs[6] == c.jurisdictionRoot && inputs[7] == c.zkPolicyHash && inputs[8] == 2, "PROOF_POLICY");
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory cc) =
            abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
        require(verifier.verifyProof(a, b, cc, inputs), "PROOF_INVALID");
        return uint64(inputs[3]);
    }

    function _sourceAllowed(MixedPolicyRegistry.Mode mode, uint8 source) private pure returns (bool) {
        if (mode == MixedPolicyRegistry.Mode.CNF_ONLY) return source == 1;
        if (mode == MixedPolicyRegistry.Mode.ZK_ONLY) return source == 2;
        if (mode == MixedPolicyRegistry.Mode.EITHER) return source == 1 || source == 2;
        return mode == MixedPolicyRegistry.Mode.BOTH && source == 3;
    }
}
