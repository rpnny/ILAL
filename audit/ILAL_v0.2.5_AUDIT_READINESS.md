# ILAL v0.2.5 Smart Contract Audit Readiness Checklist

Project: ILAL - Institutional Liquidity Access Layer  
Version: v0.2.5  
Target network: Base Sepolia testnet -> Base mainnet  
Audit scope: Hook, CNFIssuer, ZK verifier adapter, PolicyRegistry, ILALRouter  
Repository: https://github.com/rpnny/ilal-cli  

## Status Legend

| Status | Meaning |
|---|---|
| PASS | Implemented and covered by tests or live transaction evidence. |
| PARTIAL | Implemented, but auditors should review design assumptions or extra evidence. |
| DESIGN | Intentional design choice, not a code vulnerability by itself. |
| OPEN | Mainnet-blocking operational or documentation item remains. |
| N/A | Not applicable to current architecture. |

## Base Sepolia Deployment

| Component | Address |
|---|---|
| CNFIssuer | `0x33541301e35d33eDf554c4DFba1e04d04FCc52F4` |
| MockEAS | `0x6A98096DF6F54DBF40498dC5525d84AEA840663A` |
| ZKVerifierAdapter | `0x9467ED8d962221e3C1865a387481B862B1b5bE95` |
| PolicyRegistry | `0x83d8111B415E97bA91eaAe717c2D9Ae6f0DD19d4` |
| ComplianceHook | `0x4847B222d11938A70073292d97cDB98ff8D64a80` |
| ILALRouter | `0xA571F7f41c8abC19F20ABAe648e26a75fbe1F434` |
| Treasury | `0xc0807D4778a9E5FE15ad68A8500e64d65BA78D58` |
| Currency0 / TOKA | `0x8C38061e31FB02df445576685975d85F01D8686d` |
| Currency1 / TOKB | `0xD0e6467D562829d215dB48CDfF4C289095D90B6B` |
| Pool ID | `0x426925fe1ebecf2da7184f9749622ab1a4b8870c888d75da10332aee2080c86f` |

Live evidence:

| Flow | Transaction |
|---|---|
| ZK CNF mint | `0xb9aa16c9604a575c8b2281cbfe9ba24fedbf205283a7b05638fbc413ed78de41` |
| Add liquidity | `0xc3dba6d488933e1568541ece17ce43307fb173eb747dff303f3631456eccb16a` |
| Swap | `0x360461d2a3c19acdc3ba125e55689679fcf809946d8a5092e833eb9e94b0f52f` |
| Router binding | `ComplianceHook.authorizedRouter() = 0xA571F7f41c8abC19F20ABAe648e26a75fbe1F434` |

## 1. ComplianceHook

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 1.1 | `beforeSwap` access control: unauthorized callers cannot bypass pool gate | Critical | PASS | Active hooks use `onlyPoolManager`; hook sender must equal immutable `authorizedRouter`; tests cover `OnlyPoolManager`, `RouterNotAuthorized`, and invalid credential paths in `contracts/test/ComplianceHook.t.sol`. |
| 1.2 | Hook return values comply with Uniswap v4 `IHooks` interface | Critical | PASS | `beforeSwap` returns selector, zero delta, fee override; add/remove liquidity return selectors. Covered by hook tests. |
| 1.3 | Fee override cannot be manipulated into arbitrary fee tier | Critical | PASS | Only dynamic-fee pools receive constant `VERIFIED_FLOW_FEE = 500` plus `OVERRIDE_FEE_FLAG`; static pools return no override. |
| 1.4 | Session verification failure reverts instead of silently passing | Critical | PASS | Dedicated custom errors for expired, wrong chain, wrong hook, wrong pool, wrong action, wrong caller, invalid signature. Tests cover each. |
| 1.5 | Reentrancy surface in `beforeSwap` | Critical | PARTIAL | Hook performs registry/CNF reads and nonce write, no token transfer. Auditors should still review ERC-1271 external call reentrancy assumptions. |
| 1.6 | Hook deployment salt/address bits match v4 hook permissions | High | PASS | `HookMiner.find` used in deploy scripts; live hook address ends with required bits for `0x0A80`. |
| 1.7 | Pool initialization cannot be polluted by malicious issuer | High | PARTIAL | Pool policy is separate from pool initialization; owner/registered issuer controls policy. Mainnet issuer onboarding process must be operationally documented. |
| 1.8 | Multi-issuer isolation when sharing hook | High | PASS | Policy binds `poolId -> cnfIssuer + credentialType`; session also binds `cnfIssuer`, `poolId`, and action. Tests include wrong issuer/type. |

## 2. CNFIssuer / Compliance NFT

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 2.1 | Soulbound: transfer and approval paths are fully disabled | Critical | PASS | `_update` blocks transfers; `approve` and `setApprovalForAll` now revert with `ApprovalNotAllowed`. Unit and fuzz tests added. |
| 2.2 | Mint authorization: arbitrary addresses cannot self-mint without valid EAS/ZK eligibility | Critical | PASS | `mintWithEAS` validates schema, attester, recipient, revocation, expiry, attestation uniqueness. `mintWithProof` validates proof and public inputs. |
| 2.3 | Revocation is accurate and immediate | Critical | PASS | `revoke` sets `permanentlyBanned` and `revoked`; `isValid` immediately returns false. Renew paths check permanent ban. |
| 2.4 | CNF state queried by hook cannot be forged by user | Critical | PASS | Hook reads the issuer address from pool policy and checks issuer equality against session `cnfIssuer`. User cannot choose arbitrary issuer for a configured pool. |
| 2.5 | One address cannot hold multiple CNFs | High | PASS | `_holderToken[holder]` enforces one credential per address. Unit/fuzz tests cover duplicate mint attempts. |
| 2.6 | Metadata does not expose private identity | High | PASS | CNF has no per-token URI or identity data. Issuer metadata is issuer-level only: name, jurisdiction, standard, URI. |
| 2.7 | Expiry timestamp and upstream source validity | Medium | PASS | CNF expiry is capped to the EAS attestation or ZK public-input expiry. EAS-backed CNFs also fail closed when the source attestation is revoked, expired, or mutated. |

## 3. ZK Verifier

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 3.1 | Verifier cannot accept empty or arbitrary proof | Critical | PARTIAL | `Groth16VerifierAdapter` delegates to generated verifier and reverts false proofs in tests with mock verifier. Auditors should review generated verifier and circuit artifacts. |
| 3.2 | Public inputs bind proof to minting wallet | Critical | PASS | `publicInputs[PI_WALLET_HASH] == keccak256(msg.sender) >> 4`; prevents using another wallet proof. |
| 3.3 | Nullifier / repeated proof cannot mint multiple CNFs | Critical | PASS | One-token-per-wallet prevents multiple mints. Note: same valid proof may renew existing credential until proof expiry, which is intentional current design. |
| 3.4 | Verifier is latest trusted version | High | OPEN | Generated verifier is deployed on Base Sepolia. Mainnet requires frozen verifier artifact hash and audit confirmation. |
| 3.5 | Verifier/domain upgrade path is admin-controlled and delayed | High | PASS | Verifier and issuer/schema domain hashes use 72-hour proposal delays; root uses 48 hours. Zero verifier, root, or domain proposals are rejected. |
| 3.6 | Trusted setup ceremony record | High | OPEN | Prepare ceremony transcript, zkey hash, vkey hash, contribution/beacon record, and reproducible build instructions before mainnet. |

## 4. Session Mechanism

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 4.1 | EIP-712 domain separation binds chain and hook contract | Critical | PASS | Domain includes name, version, `block.chainid`, verifying contract. Session token also includes chainId and verifyingHook. |
| 4.2 | Nonce management prevents replay | Critical | PASS | Permit2-style nonce bitmap; reuse reverts with `NonceAlreadyUsed`. Tests cover replay and unique nonces. |
| 4.3 | TTL uses `block.timestamp` safely | High | DESIGN | TTL is default 10 minutes. Minor timestamp drift is acceptable; expired session reverts. |
| 4.4 | `caller` is strictly checked | High | PASS | Router pre-check requires `authorizedCaller == address(router)`; hook requires `sender == authorizedRouter` and `authorizedCaller == sender` from PoolManager. |
| 4.5 | `pool` is strictly checked | High | PASS | `token.poolId` must equal `PoolId.unwrap(key.toId())`; wrong pool tests pass. |
| 4.6 | `action` prevents swap/liquidity cross-use | High | PASS | Action constants separate swap, add liquidity, remove liquidity. Wrong action tests pass. |
| 4.7 | Revocation invalidates trading/add-liquidity authorization | High | PASS | Swap and add-liquidity read live `CNFIssuer.isValid(user)` before nonce consumption. Exit-only remove-liquidity remains available by intentional ownership-preserving design. |
| 4.8 | Session signer key management | Medium | N/A | Session is signed by the user/trader wallet, not issuer key. Issuer/admin key risk belongs to CNFIssuer/PolicyRegistry operations. |

## 5. PolicyRegistry

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 5.1 | Arbitrary addresses cannot register issuer status | Critical | PASS | `registerIssuer` is `onlyOwner`; self-service policy setter checks `registeredIssuers[msg.sender]`. |
| 5.2 | Issuer deregistration/pause exists and is timely | High | PARTIAL | `deregisterIssuer` removes future self-service rights but does not disable existing policies. Existing pools must be disabled by owner with `disablePolicy`. |
| 5.3 | Registry data cannot be maliciously overwritten/deleted | High | PASS | A registered issuer may claim only an unowned pool or update its own policy. Disabled policies retain ownership; cross-issuer migration is owner-only. Regression tests cover active and disabled takeover attempts. |
| 5.4 | Admin scope and multisig requirements | High | OPEN | Current contracts use `Ownable`. Mainnet deployment should transfer owner to multisig/timelock and document signer policy. |

## 6. Protocol Fee

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 6.1 | Fee precision and overflow/rounding | High | PASS | Exact-input only; the charged fee uses input actually consumed by PoolManager, including partial-fill coverage. Dust fees round down; standard ERC-20 tokens only. |
| 6.2 | Treasury address control | High | DESIGN | Treasury is immutable per router deployment and cannot be changed by admin. Mainnet treasury should be multisig-controlled. |
| 6.3 | Fee parameter cannot be arbitrarily modified | High | PASS | `protocolFeePips` immutable; capped at `MAX_PROTOCOL_FEE_PIPS = 1000` (0.10%). |
| 6.4 | Protocol fee and LP fee separation | Medium | PASS | PoolManager settles first; ILAL then charges its immutable fee on actual input consumed. LP fee remains native Uniswap v4 pool economics. |

## 7. General Security

| # | Audit Item | Risk | Status | Evidence / Notes |
|---|---|---|---|---|
| 7.1 | External call return values are checked | High | PASS | ERC20 transferFrom uses low-level call and validates success + optional bool return. ERC-1271 return magic checked. |
| 7.2 | Public/external access control is complete | High | PARTIAL | Main critical functions have guards. Auditors should review inactive hook functions that revert `NotImplemented` without `onlyPoolManager`. |
| 7.3 | Proxy initialization locked | High | N/A | No upgradeable proxies used. Contracts are immutable deployments. |
| 7.4 | Events cover critical operations | Medium | PASS | Credential mint/renew/revoke, verifier/root proposals/activation, policy changes, fee paid, swap executed, fee override. |
| 7.5 | Compiler version pinning | Medium | PARTIAL | `foundry.toml` pins solc `0.8.26`; Solidity pragmas are `^0.8.24`. Consider exact pragmas before mainnet audit. |
| 7.6 | Dependency versions | Medium | PARTIAL | Uses OpenZeppelin, Uniswap v4-core, forge-std via local libs/remappings. Include lock/commit hashes in final audit package. |
| 7.7 | Test coverage target | Medium | PARTIAL | Current suite passes 145 Solidity, 15 CLI security, and 15 SDK tests. Fresh coverage summary is in `audit/ILAL_COVERAGE_SUMMARY.md`; formal branch coverage remains a mainnet audit input. |
| 7.8 | Fuzz/invariant testing | Medium | PASS | Foundry fuzz tests cover soulbound transfer/approval, validity consistency, timelock guards, permanent ban, one-token-per-wallet. |

## Mainnet-Blocking Open Items

1. Transfer CNFIssuer and PolicyRegistry ownership to multisig/timelock.
2. Publish trusted setup and verifier artifact hashes.
3. Generate formal coverage report.
4. Pin Solidity pragmas exactly if auditor requires no floating pragma.
5. Document issuer onboarding and policy disable runbook.
