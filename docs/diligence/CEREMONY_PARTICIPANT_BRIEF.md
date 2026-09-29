# Ceremony participant brief

ILAL is seeking independent organizations to contribute to and verify a Groth16 phase-2 ceremony for the frozen `ILALEligibilityPolicyV2` circuit. This is a technical participation request, not an endorsement of ILAL or a representation that the protocol is production-ready.

## What a contributor does

- independently verify the received zkey hash and ceremony challenge;
- generate private entropy on infrastructure controlled by the contributor;
- produce and verify one chained phase-2 contribution;
- return the output artifact, response and verification log;
- sign an attestation binding the input/output hashes and confirming that entropy was not disclosed and local secret material was destroyed.

ILAL does not receive raw entropy, seeds, credentials, shell history or private signing keys. A contributor may publish its attestation or keep it in a controlled data room while publishing only its SHA-256 digest.

## What the coordinator does

The coordinator reproduces the frozen R1CS, verifies the phase-1 file, controls the contribution sequence, verifies every response, commits to a future public beacon source and publishes the non-secret manifest. The coordinator must be organizationally distinct from ILAL, the contributors and the independent verifier.

## What the independent verifier does

The verifier uses a separate environment to reproduce the R1CS, verify the full contribution chain and beacon, derive the verification key and Solidity verifier, and confirm all published hashes. It does not rely on ILAL's build directory or development zkey.

## Expected output

The complete package follows `ilal-independent-ceremony-v1` and passes:

```sh
node scripts/diligence/verify-package.mjs \
  docs/data-room/CIRCUIT_V2_FREEZE.json \
  ceremony-manifest.json \
  --require-complete
```

The current `.3` artifacts are explicitly excluded because they were generated with an unsafe development ceremony.
