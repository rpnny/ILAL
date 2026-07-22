# R1–R9 remediation status

| ID | Risk | Status for v0.3.3 |
|---|---|---|
| R1 | Fragmented repositories and lost CLI history | Implemented locally: external bundle/archive/patch/checksums and non-squash subtree ancestry; public clone verification pending |
| R2 | Plain environment private-key dependency | Implemented: encrypted keystore, restricted testnet compatibility; production operator validation pending |
| R3 | JSON-RPC overstated as HSM/custody | Implemented: explicit RPC-managed account semantics and capability checks; vendor adapters out of scope |
| R4 | Safe treated as an EOA | Implemented: offline proposer, owner proposal submission, separate execution; live Safe integration pending |
| R5 | Admin and treasury coupled | Implemented in CLI/script/schema; deployment proof pending |
| R6 | Incomplete privilege handoff/evidence | Script handoff and manifest schema implemented; live verification pending |
| R7 | Source/release provenance ambiguity | Process and schema implemented; commit values pending clean freeze |
| R8 | Stale npm/site/deployment claims | Local docs/presets corrected; external npm deprecation and website publication pending |
| R9 | ZK/production/audit overstatement | Corrected labels and proving provenance added; independent audit and production ceremony remain open |

“Implemented locally” is not equivalent to publicly released, deployed, audited, or operationally proven.
