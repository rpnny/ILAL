# Documentation

Use this directory for implementation guidance, release operations, and
public technical diligence.

| Document | Purpose |
|---|---|
| [`CODEBASE_GUIDE.md`](CODEBASE_GUIDE.md) | Active v1 flow, isolated v2 design, invariants, and source-of-truth order |
| [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) | Source freeze, deployment evidence, tags, and package publication |
| [`data-room/`](data-room) | Threat model, privileged roles, risk remediation, and public diligence index |
| [`pitch/`](pitch) | Presentation material; not protocol specification |

Behavior is defined by contract and TypeScript source. Deployment status is
defined by `../deployments/index.json` and its active manifest.
