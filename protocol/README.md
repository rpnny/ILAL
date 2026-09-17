# @ilalv3/protocol

Institutional execution protocol objects and verification for ILAL's frozen
Base Sepolia Hookathon settlement engine.

```ts
import { createOrderIntent, signOrder } from "@ilalv3/protocol/order";
import { buildBatch, previewBatch } from "@ilalv3/protocol/batch";
import { preflightBatch } from "@ilalv3/protocol/preflight";
import { executeBatch, inspectSettlement } from "@ilalv3/protocol/settlement";
```

The package does not contact an ILAL-operated server. Object construction,
signing with a local signer, and batch preview are offline. Preflight,
execution, and settlement inspection accept caller-supplied standard JSON-RPC
clients.

Use `stringifyProtocolJson` from the root export for wire artifacts. It sorts
object keys and writes every integer as a decimal string, including chain IDs,
pool fees, and order indices. In-memory objects retain numeric fields needed
by viem; parsers accept the wire representation and existing legacy files.

The institutional preview is unaudited, Base Sepolia only, and not production
ready.
