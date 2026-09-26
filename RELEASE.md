# ILAL release status

The current source is an unpublished, private development version of the unified ILAL protocol. `protocol.json` selects the implementation, package version and candidate manifest. CLI and SDK versions must match it.

The retained `releases/` and `deployments/` records describe historical releases and chain evidence. They are not rewritten by source consolidation. In particular, the historical v0.3.3 active record does not make it a supported path in the current CLI, and the Mixed candidate has not been promoted to stable.

Old Session/V2 release and npm publication workflows have been removed. A future release needs a reviewed unified-protocol manifest and explicit publication workflow before removing package `private: true`. No npm publication, deployment or migration is performed by this change.

Run `make verify` for the current implementation. See [history](docs/HISTORY.md), [the runbook](docs/mixed/RUNBOOK.md) and [audit scope](docs/mixed/AUDIT_SCOPE.md).
