# Privileged role matrix

The manifest must record holder, verification call, and result for every row, including “not applicable.” A stable deployment fails if the deployer holds an undeclared applicable role.

| Capability | Contract | Mechanism | Stable expectation |
|---|---|---|---|
| Policy manager / issuer allowlist | `PolicyRegistry` | `owner()` | `admin` Safe |
| Credential issuer, revoker, ZK/root manager | `CNFIssuer` | `owner()` | `admin` Safe |
| Mock attester/revoker | `MockEAS` | `owner()` | Demo `admin` Safe; testnet only |
| V2 policy manager | `EligibilityPolicyRegistryV2` | `owner()` | `admin` Safe when deployed |
| V2 grant revoker | `PolicyGrantManagerV2` | `owner()` | `admin` Safe when deployed |
| Treasury / fee recipient | `ILALRouter` | immutable `treasury()` | manifest `treasury` |
| Router authorization | Hook | immutable `authorizedRouter()` | deployed Router |
| Pool manager authority | Hook/Router | immutable `poolManager()` | configured Uniswap v4 PoolManager |
| Default admin | All current contracts | Not applicable; no AccessControl |
| Pauser | All current contracts | Not applicable; no pause role |
| Upgrader / ProxyAdmin | All current contracts | Not applicable; contracts are non-proxy |

Registered issuers in `PolicyRegistry` have scoped self-service policy rights and must also be listed in deployment evidence. They are not protocol owners.
