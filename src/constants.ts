// EAS is an OP Stack predeploy — same address on Base mainnet and Base Sepolia
// Source: github.com/coinbase/verifications, docs.attest.org/docs/quick--start/contracts
export const EAS_ADDRESSES: Record<number, `0x${string}`> = {
  8453:  "0x4200000000000000000000000000000000000021", // Base mainnet
  84532: "0x4200000000000000000000000000000000000021", // Base Sepolia
};

// Coinbase Verifications — Base mainnet only (no Sepolia equivalent)
// Source: github.com/coinbase/verifications
export const COINBASE_ATTESTER        = "0x357458739F90461b99789350868CD7CF330Dd7EE" as const;

// Verified Account (primary KYC schema)
export const COINBASE_SCHEMA_UID      = "0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9" as const;
// Verified Country (jurisdiction schema — for Phase 3 policy extensions)
export const COINBASE_COUNTRY_SCHEMA  = "0x1801901fabd0e6189356b4fb52bb0ab855276d84f7ec140839fbd1f6801ca065" as const;

export const DEFAULT_LIFETIME_DAYS = 90;
