pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/mux1.circom";

/*
 * MerkleProof — Poseidon Merkle inclusion proof.
 *
 * Compatible with @zk-kit/incremental-merkle-tree (same Poseidon constants,
 * same left/right convention).
 *
 * pathIndices[i]:
 *   0 = the current node is the LEFT child  → sibling goes right
 *   1 = the current node is the RIGHT child → sibling goes left
 *
 * Each internal node: Poseidon(left, right)
 */
template MerkleProof(DEPTH) {
    signal input  leaf;
    signal input  pathElements[DEPTH];
    signal input  pathIndices[DEPTH];

    signal output root;

    component hashers[DEPTH];
    component muxes[DEPTH];

    signal levelHashes[DEPTH + 1];
    levelHashes[0] <== leaf;

    for (var i = 0; i < DEPTH; i++) {
        // Enforce pathIndices[i] is binary
        pathIndices[i] * (pathIndices[i] - 1) === 0;

        // Select (left, right) based on pathIndex
        //   pathIndex=0: left=current, right=sibling
        //   pathIndex=1: left=sibling, right=current
        muxes[i] = MultiMux1(2);
        muxes[i].c[0][0] <== levelHashes[i];   // left  when idx=0
        muxes[i].c[0][1] <== pathElements[i];  // left  when idx=1
        muxes[i].c[1][0] <== pathElements[i];  // right when idx=0
        muxes[i].c[1][1] <== levelHashes[i];   // right when idx=1
        muxes[i].s        <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== muxes[i].out[0];
        hashers[i].inputs[1] <== muxes[i].out[1];

        levelHashes[i + 1] <== hashers[i].out;
    }

    root <== levelHashes[DEPTH];
}
