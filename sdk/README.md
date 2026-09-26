# ILAL SDK

TypeScript/viem client for the unified ILAL protocol. This development package is private and unpublished.

The root exports only the unified protocol: deployment validation, policy/grant queries, typed authorizations, batch/direct quotes and execution, LP operations, cancellation and the integer matching model. `Mixed*` names and wire formats remain stable to match the candidate contracts.

```typescript
import { validateMixedDeployment, checkMixedDeployment, readMixedPolicy } from '@ilal/sdk';

validateMixedDeployment(deployment);
await checkMixedDeployment(publicClient, deployment);
const policy = await readMixedPolicy(publicClient, deployment);
```

Supply a manifest in `ilal-mixed-deployment-v1` format and a viem client connected to its chain. Use `quoteMixedOrders`, `signMixedOrder`, `executeMixedOrders`, `activateMixedGrant` and `modifyMixedLiquidity` for the complete lifecycle.

Legacy session helpers and encoders are no longer exported. A grant caches eligibility while individual orders retain explicit signatures, limits and nonce protection. See [the specification](../docs/mixed/SPEC.md) and [migration notes](../docs/HISTORY.md).

```bash
npm ci
npm run build
npm test
```
