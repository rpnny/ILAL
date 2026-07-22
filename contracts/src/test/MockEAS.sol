// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IEAS} from "../interfaces/IEAS.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockEAS
/// @notice A minimal EAS implementation for testnet use.
///         Lets the owner create and revoke attestations without real KYC.
///         Deploy this on testnets in place of the real EAS predeploy.
contract MockEAS is IEAS, Ownable {
    mapping(bytes32 => Attestation) private _attestations;
    uint256 private _nonce;

    event AttestationCreated(bytes32 indexed uid, address indexed recipient, address indexed attester);
    event AttestationRevoked(bytes32 indexed uid);

    constructor() Ownable(msg.sender) {}

    /// @notice Create a test attestation. Returns the generated UID.
    function attest(bytes32 schema, address recipient, address attester, uint64 expirationTime, bytes calldata data)
        external
        onlyOwner
        returns (bytes32 uid)
    {
        uid = keccak256(abi.encodePacked(schema, recipient, attester, block.timestamp, _nonce++));

        _attestations[uid] = Attestation({
            uid: uid,
            schema: schema,
            time: uint64(block.timestamp),
            expirationTime: expirationTime,
            revocationTime: 0,
            refUID: bytes32(0),
            recipient: recipient,
            attester: attester,
            revocable: true,
            data: data
        });

        emit AttestationCreated(uid, recipient, attester);
    }

    /// @notice Revoke an existing attestation.
    function revoke(bytes32 uid) external onlyOwner {
        require(_attestations[uid].uid != bytes32(0), "MockEAS: attestation not found");
        _attestations[uid].revocationTime = uint64(block.timestamp);
        emit AttestationRevoked(uid);
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }

    function isAttestationValid(bytes32 uid) external view returns (bool) {
        Attestation storage a = _attestations[uid];
        return a.uid != bytes32(0) && a.revocationTime == 0;
    }
}
