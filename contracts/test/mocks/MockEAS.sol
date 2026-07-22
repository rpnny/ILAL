// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IEAS} from "../../src/interfaces/IEAS.sol";

contract MockEAS is IEAS {
    mapping(bytes32 => Attestation) private _attestations;

    function setAttestation(bytes32 uid, Attestation memory attestation) external {
        _attestations[uid] = attestation;
    }

    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        return _attestations[uid];
    }

    function isAttestationValid(bytes32 uid) external view returns (bool) {
        return _attestations[uid].uid != bytes32(0);
    }
}
