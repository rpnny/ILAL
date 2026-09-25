# Mixed v1 migration boundary

Mixed v1 is a new protocol version, not an in-place upgrade. Legacy Hookathon orders, Session tokens, V2 activations, nonces, grants, pool positions and deployment attestations are not converted.

For a future migration:

1. Freeze the exact source revision, build digest, verifier runtime, ceremony transcript, Hook flags and deployment configuration.
2. Deploy the new modular contracts and initialize a new Hook-bound pool. Do not point old routers at the new Hook.
3. Configure the issuer, policy source, feeds, heartbeat, sequencer and all price thresholds explicitly; run the read-only preflight.
4. Users activate a new Mixed grant, approve the new canonical router and sign new domain-separated authorizations.
5. Existing LPs exit the legacy position through its existing ownership path and independently add liquidity to Mixed v1. No administrator migrates or takes user positions.
6. Keep old deployments and evidence labeled with their original version and status. Deprecation does not imply funds were moved.

Emergency policy disable, root retirement or a user ban stops new qualified operations immediately. It does not block a signed owner EXIT or COLLECT in Mixed v1.
