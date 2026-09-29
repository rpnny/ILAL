# Independent Groth16 ceremony runbook

## Scope

The ceremony is Groth16 phase 2 for the exact circuit source set in `CIRCUIT_V2_FREEZE.json`. The existing development zkey and `.3` verifier are reference test artifacts and must never seed, contribute to or be relabeled as the independent output.

The coordinator, independent verifier and every contributor must be distinct entities. ILAL may provide the frozen source and answer technical questions, but it must not control contributor entropy, the coordinator environment, the final beacon choice or the independent verification environment.

## Before contributions

1. Independently reproduce the R1CS and WASM from the frozen source set and pinned compiler/dependencies.
2. Compare the R1CS hash, constraint count, public-input count and public-signal order with the freeze manifest.
3. Select and verify a phase-1 Powers of Tau file with sufficient capacity. Record its origin, hash and verification log.
4. Create the initial phase-2 zkey from the reproduced R1CS and verified ptau. Record both input hashes and the preparation log.
5. Create a ceremony manifest from `docs/data-room/templates/independent-ceremony.template.json`.

## Contribution sequence

For every contributor:

1. The coordinator sends the exact prior zkey hash and a challenge package.
2. The contributor verifies the input hash, contributes entropy on an environment they control, verifies the output and returns the output plus response log.
3. The coordinator verifies the response and records the input zkey, output zkey, challenge, response, verification-log and signed-attestation SHA-256 values.
4. The next contribution must name the preceding output as its input. Parallel or unchained outputs are rejected.
5. Raw entropy, seeds and local shell history containing secrets are destroyed by the contributor and never sent to ILAL.

At least two independent contributions are required by the package validator. More participants improve trust distribution but do not replace participant vetting or transcript verification.

## Public beacon and final artifacts

Choose a future, unpredictable and publicly verifiable randomness source before its value exists. Record the source commitment before the event, then record the resulting public entropy hash, application time, input zkey, output zkey and verification log.

Export the final zkey, verification key and Solidity verifier from the beacon output. Record SHA-256 values for files and the expected deployed runtime code hash. The independent verifier must use a separate environment to verify the ptau, the complete contribution chain, the final zkey against the frozen R1CS and the generated verifier behavior.

## Required attestations

- Coordinator: scope, participant sequence, hash chain, beacon selection and handling controls.
- Each contributor: input/output hashes, independent entropy generation, no entropy disclosure and local secret destruction.
- Independent verifier: reproduced R1CS, verified chain, final artifacts and runtime-code correspondence.

Attestations may stay in a controlled data room. Their SHA-256 digests belong in the public ceremony manifest.

## Stop conditions

Stop and restart with a new manifest if any source differs from the freeze, an input/output link is missing, an entity is reused, a contributor cannot verify its input, the beacon was knowable before commitment, an artifact hash changes or the independent verifier cannot reproduce the result.
