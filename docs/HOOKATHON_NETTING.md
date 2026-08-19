# Hookathon Atomic Netting Runbook

## Problem → approach → why it works

Mutually offsetting institutional orders create unnecessary public AMM
exposure when both sides are independently routed through a pool. The
Hookathon mechanism verifies both sides, matches equal raw stablecoin units
inside one v4 unlock, and lets the AMM see only the imbalance.

For `100 token0 → token1` and `70 token1 → token0`:

| Metric | Raw units at 6 decimals |
|---|---:|
| Submitted gross | 170,000,000 |
| Matched each side | 70,000,000 |
| Internally matched gross | 140,000,000 |
| token0 residual | 30,000,000 |
| token1 residual | 0 |

In `beforeSwap`, a matched amount `m` returns
`toBeforeSwapDelta(+m, -m)`. The first direction gives the Hook a positive
token0 and negative token1 delta; the opposite direction produces the exact
inverse. `closeBatch` checks both matched totals, the ordered order-hash
commitment and every observed amount before the PoolManager unlock can finish.

## Signed order

The EIP-712 domain is `ILAL Institutional Netting`, version `1`, current chain
ID, and the Hook address. The signed struct is:

```solidity
struct NettingOrder {
    address user;
    bytes32 poolId;
    bool zeroForOne;
    uint128 amountIn;
    uint128 minAmountOut;
    uint128 maxAmmInput;
    uint64 deadline;
    bytes32 nonce;
}
```

The Hook accepts canonical low-s 65-byte EOA signatures or ERC-1271 contract
wallet validation. It reads the current v1 PolicyRegistry policy and validates
the user's CNFIssuer credential and required credential type immediately
before consuming the nonce.

## Atomic failure boundaries

The whole transaction reverts when any order has an invalid signature, domain,
pool, amount, deadline, nonce, credential or credential type; when current
policy is disabled or rotated; when the starting tick exceeds ±100; when an
order's residual exceeds `maxAmmInput`; when an AMM exact-input fill is partial;
or when total output is less than `minAmountOut`. Token transfers occur inside
the same unlock, so a later failure restores earlier balances and nonce bits.

The BatchRouter is permissionless. It cannot replace signed fields, it never
becomes the output recipient, and it finishes without Token inventory. The
Hook also has no long-term custody, cross-transaction queue or inventory.

## CLI demo

Build the CLI and configure `.ilal.json` with the candidate Hook, BatchRouter,
sorted Token addresses, pool ID, fee `500`, tick spacing `10`, chain `84532`
and an RPC URL. Institutions must approve the BatchRouter before signing.

```bash
npm --prefix cli run build

node cli/dist/index.js --keystore institution-a.json --password-file a.password \
  netting order sign --zero-for-one --amount-in 100000000 \
  --min-amount-out 99000000 --max-amm-input 30000000 -o order-a.json

node cli/dist/index.js --keystore institution-b.json --password-file b.password \
  netting order sign --one-for-zero --amount-in 70000000 \
  --min-amount-out 70000000 --max-amm-input 0 -o order-b.json

./scripts/demo-netting.sh order-a.json order-b.json \
  --keystore solver.json --password-file solver.password
```

Order JSON files contain the public order, domain and signature only. They do
not contain a private key or keystore password.

## Base Sepolia deployment

The deployment deliberately requires distinct Safe admin, Institution A,
Institution B, solver and LP roles. Private-key environment inputs are for
throwaway Base Sepolia accounts only; the Safe is supplied as an address.

```bash
cd contracts

export DEPLOYER_PRIVATE_KEY=0x...
export INSTITUTION_A_PRIVATE_KEY=0x...
export INSTITUTION_B_PRIVATE_KEY=0x...
export LP_PRIVATE_KEY=0x...
export SAFE_ADMIN=0x...
export SOLVER=0x...

forge script script/DeployHookathonNetting.s.sol:DeployHookathonNetting \
  --rpc-url https://sepolia.base.org --broadcast -vvvv
```

Pinned public infrastructure:

- PoolManager: `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`
- PositionManager: `0x4b2c77d209D3405F41A037Ec6c77F7F5b8e2ca80`
- Permit2: `0x000000000022D473030F116dDEE9F6B43aC78BA3`

The deployment creates and initializes the pool, publishes its v1 policy,
mints two independent CNFs, approves the BatchRouter, and seeds an LP position
through PositionManager. It transfers Registry, issuer and MockEAS ownership to
the Safe before finishing.

## Evidence checklist

Do not change the active v0.3.3 deployment preset. Record this stack as a
separate Hookathon candidate only after broadcast and verification.

- Exact 40-character source commit and source-tree hash.
- Deployment, initialization, policy, CNF and LP transaction hashes/blocks.
- Constructor arguments, CREATE2 salt and exact `0x88` flags.
- PoolKey and PoolId.
- Safe admin, Institution A/B, solver and LP addresses.
- Creation/runtime bytecode and ABI hashes for every first-party contract.
- `100/70` preview, execution transaction and decoded `OrderNetted`,
  `OrderSettled`, `BatchNetted`, and `BatchExecuted` events.
- Reverse-direction evidence from a fresh nonce pair.
- Source verification links and status.

The pending evidence template is
[`docs/hookathon/candidate-manifest.template.json`](hookathon/candidate-manifest.template.json).

## Verification

```bash
make verify
```

The representative integration tests execute against the real v4 PoolManager,
not a swap mock. Stateful invariants repeatedly assert the gross/matched/
residual identity, closed batch context, one-use nonces, zero Hook/Router
inventory and full Token conservation.
