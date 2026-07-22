// Generated from deployments/index.json. Do not edit manually.
export const DEPLOYMENT_INDEX = {
  "schemaVersion": 1,
  "active": {
    "84532": "base-sepolia/v0.3.3.json"
  },
  "deployments": [
    {
      "version": "0.3.2",
      "network": "base-sepolia",
      "chainId": 84532,
      "status": "deprecated",
      "manifest": "base-sepolia/v0.3.2.json",
      "reason": "The demo owner signer was exposed. Do not rely on this stack for authorization or current examples."
    },
    {
      "version": "0.3.3",
      "network": "base-sepolia",
      "chainId": 84532,
      "status": "active",
      "manifest": "base-sepolia/v0.3.3.json"
    }
  ]
} as const;

export const ACTIVE_PRESETS: Record<string, Record<string, string>> = {
  "84532": {
    "issuer": "0x57d6faea0159C95e96D7a6Ed4e3D416701aA9aEF",
    "hook": "0x9B894a6fD363CfBA6E8A5876256Fb7698659CA80",
    "registry": "0xB93fcF91001FeCfaa14B6d7aB6dB57581ce47f52",
    "router": "0x2ccd398F6F60A1d926374a78F25e90E3Bef99A77",
    "treasury": "0x67ceEC895B2668d95D79c164437dF4609c26c6cD",
    "tokenA": "0x42A0Ce24E84B109cdD22712025bbd0aa31250a3d",
    "tokenB": "0x56e7DedB151EA5Ff44F72000Bea114EAe62c3678",
    "poolId": "0x1a05b49e39c3ed799c4f0f23bb61e647ff9d3c558136f718a2ab2fa87c82d1ad",
    "fee": "8388608",
    "tickSpacing": "60"
  }
};
