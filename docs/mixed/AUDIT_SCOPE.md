# Mixed v1 audit and release scope

The security boundary includes `contracts/src/mixed`, the existing Chainlink guard, the V2 verifier adapter and generated verifier, the exact v4-core revision, SDK typed-data/model/client code, CLI/Console request validation, issuer tree construction and deployment/preflight scripts.

Review must cover transient execution contexts, forced-revert unsigned quoting, callback sender and canonical Hook binding, currency-delta closure, fee accounting, ERC-1271 reentrancy behavior, EIP-712 domains, six nonce namespaces, commitment ordering, rounding, partial residual behavior, root retirement, source switching, global bans, timelocks, LP salt isolation, fee ownership and EXIT/COLLECT availability during shutdown.

External release gates remain: issuer acceptance against real credential lifecycle behavior, reviewed production Groth16 ceremony and verifier configuration, independent Solidity/circuit/SDK audit, token behavior review, feed and sequencer selection, governance role review, deployment simulation and approval, and live operational monitoring. Local tests and code-size checks do not satisfy those gates.
