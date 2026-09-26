# ILAL issuer pilot narrative

ILAL is **policy-controlled atomic execution and settlement infrastructure for permissioned digital asset liquidity**.

The first customer is a stablecoin issuer that needs controlled secondary liquidity without building a new exchange. The issuer defines eligibility for the ILAL pool involving its stablecoin. A separate USDC-like settlement asset supplies the cash leg. Eligible institutions keep custody, authorize bounded orders, and settle atomically.

ILAL first matches opposing institutional flow. Only the unmatched residual reaches Uniswap v4 liquidity. In the canonical 100 versus 70 case, gross institutional flow is 170, internal matched flow is 140, and public AMM exposure is 30. That decomposition is an executable acceptance invariant, not a projected saving.

Eligibility is evaluated again when execution occurs. A quote under an earlier policy revision cannot survive an issuer revocation or activated policy change. The complete batch reverts before nonce or asset mutation.

Liquidity ownership is equally strict. Eligibility controls adding new exposure. It can never trap existing LP principal or earned fees. The owner may exit and collect after credential revocation, policy shutdown or oracle failure.

The current milestone is one reproducible issuer sandbox with separately controlled issuer, settlement asset, LP, institutions and executor; machine-verifiable local and Base Sepolia evidence; and an honest list of production blockers. ILAL does not claim to perform KYC/KYB, make regulatory decisions, custody assets or provide a production venue before independent audit and reviewed governance.

Uniswap v4 is the residual liquidity rail. ILAL is the policy, authorization, matching and atomic settlement layer in front of it.
