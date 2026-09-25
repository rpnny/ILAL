// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MixedPolicyRegistry is Ownable {
    enum Mode {
        UNSET,
        CNF_ONLY,
        ZK_ONLY,
        EITHER,
        BOTH
    }

    struct Config {
        Mode mode;
        address cnfIssuer;
        bytes32 credentialType;
        uint256 issuerHash;
        uint256 schemaHash;
        uint256 acceptedRoot;
        uint256 jurisdictionRoot;
        uint256 zkPolicyHash;
        uint8 minKycLevel;
        uint64 maxGrantTTL;
    }

    struct Policy {
        Config config;
        bytes32 executionPolicyHash;
        uint64 revision;
        uint64 rootEpoch;
        bool enabled;
        bool zkEnabled;
    }

    struct Pending {
        Config config;
        uint64 activateAfter;
    }
    uint256 public constant DELAY = 48 hours;
    uint256 private constant FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    mapping(bytes32 => Policy) private _policies;
    mapping(bytes32 => Pending) private _pending;
    mapping(bytes32 => mapping(uint256 => bool)) public retiredRoot;
    mapping(bytes32 => mapping(address => bool)) public banned;
    mapping(bytes32 => mapping(address => uint64)) public userEpoch;
    mapping(bytes32 => mapping(address => uint64)) public unbanAfter;
    event PolicyChanged(
        bytes32 indexed poolId, bytes32 executionPolicyHash, uint64 revision, uint64 rootEpoch, bool enabled
    );
    event PolicyProposed(bytes32 indexed poolId, uint64 activateAfter, bytes32 configHash);
    event RootRetired(bytes32 indexed poolId, uint256 root);
    event UserBan(bytes32 indexed poolId, address indexed user, bool banned, uint64 epoch);
    event UnbanProposed(bytes32 indexed poolId, address indexed user, uint64 activateAfter);
    constructor(address admin) Ownable(admin) {}

    function getPolicy(bytes32 poolId) external view returns (Policy memory) {
        return _policies[poolId];
    }

    function getPending(bytes32 poolId) external view returns (Pending memory) {
        return _pending[poolId];
    }

    function configure(bytes32 poolId, Config calldata c) external onlyOwner {
        _validate(poolId, c);
        if (_policies[poolId].revision == 0) {
            _apply(poolId, c);
        } else {
            uint64 at = uint64(block.timestamp + DELAY);
            _pending[poolId] = Pending(c, at);
            emit PolicyProposed(poolId, at, keccak256(abi.encode(c)));
        }
    }

    function activate(bytes32 poolId) external onlyOwner {
        Pending memory p = _pending[poolId];
        require(p.activateAfter != 0 && block.timestamp >= p.activateAfter, "TIMELOCK");
        _validate(poolId, p.config);
        delete _pending[poolId];
        _apply(poolId, p.config);
    }

    function cancelProposal(bytes32 poolId) external onlyOwner {
        delete _pending[poolId];
    }

    function disable(bytes32 poolId) external onlyOwner {
        Policy storage p = _policies[poolId];
        require(p.revision > 0, "POLICY");
        p.enabled = false;
        ++p.revision;
        ++p.rootEpoch;
        delete _pending[poolId];
        _hash(poolId, p);
    }

    function invalidateRoot(bytes32 poolId) external onlyOwner {
        Policy storage p = _policies[poolId];
        require(p.revision > 0 && p.config.acceptedRoot != 0, "ROOT");
        retiredRoot[poolId][p.config.acceptedRoot] = true;
        p.zkEnabled = false;
        ++p.revision;
        ++p.rootEpoch;
        delete _pending[poolId];
        _hash(poolId, p);
        emit RootRetired(poolId, p.config.acceptedRoot);
    }

    function ban(bytes32 poolId, address user) external onlyOwner {
        require(user != address(0) && _policies[poolId].revision > 0, "USER");
        banned[poolId][user] = true;
        ++userEpoch[poolId][user];
        delete unbanAfter[poolId][user];
        emit UserBan(poolId, user, true, userEpoch[poolId][user]);
    }

    function proposeUnban(bytes32 poolId, address user) external onlyOwner {
        require(banned[poolId][user], "NOT_BANNED");
        uint64 at = uint64(block.timestamp + DELAY);
        unbanAfter[poolId][user] = at;
        emit UnbanProposed(poolId, user, at);
    }

    function activateUnban(bytes32 poolId, address user) external onlyOwner {
        uint64 at = unbanAfter[poolId][user];
        require(at != 0 && block.timestamp >= at, "TIMELOCK");
        delete unbanAfter[poolId][user];
        banned[poolId][user] = false;
        ++userEpoch[poolId][user];
        emit UserBan(poolId, user, false, userEpoch[poolId][user]);
    }

    function _apply(bytes32 poolId, Config memory c) private {
        Policy storage p = _policies[poolId];
        if (p.config.acceptedRoot != 0 && p.config.acceptedRoot != c.acceptedRoot) {
            retiredRoot[poolId][p.config.acceptedRoot] = true;
        }
        p.config = c;
        ++p.revision;
        ++p.rootEpoch;
        p.enabled = true;
        p.zkEnabled = c.mode != Mode.CNF_ONLY;
        _hash(poolId, p);
    }

    function _hash(bytes32 poolId, Policy storage p) private {
        p.executionPolicyHash = keccak256(
            abi.encode(
                "ILAL Mixed policy v1",
                block.chainid,
                address(this),
                poolId,
                p.config,
                p.revision,
                p.rootEpoch,
                p.enabled,
                p.zkEnabled
            )
        );
        emit PolicyChanged(poolId, p.executionPolicyHash, p.revision, p.rootEpoch, p.enabled);
    }

    function _validate(bytes32 poolId, Config memory c) private view {
        require(
            c.mode != Mode.UNSET && c.maxGrantTTL > 0 && c.maxGrantTTL <= 7 days && c.minKycLevel <= 3, "POLICY_CONFIG"
        );
        if (c.mode != Mode.ZK_ONLY) {
            require(c.cnfIssuer.code.length > 0 && c.credentialType != bytes32(0), "CNF_CONFIG");
        }
        if (c.mode != Mode.CNF_ONLY) {
            require(
                _field(c.issuerHash) && _field(c.schemaHash) && _field(c.acceptedRoot) && _field(c.jurisdictionRoot)
                    && _field(c.zkPolicyHash),
                "ZK_CONFIG"
            );
            require(!retiredRoot[poolId][c.acceptedRoot], "RETIRED_ROOT");
        }
    }

    function _field(uint256 x) private pure returns (bool) {
        return x > 0 && x < FIELD;
    }
}
