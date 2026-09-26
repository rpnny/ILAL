# ILAL proving metadata

This directory records development-only Groth16 artifact provenance. It is not an npm package and the current artifacts are not production-approved.

`PROVENANCE.json` binds circuit hashes, tool versions, the undocumented development ptau hash, zkey/vkey/WASM hashes, and reproduction commands. Large proving files stay out of Git and may be attached to a release only with their checksums and explicit non-production ceremony warning.

Never publish witnesses, user inputs, identity/compliance data, ceremony private entropy, or customer material.
