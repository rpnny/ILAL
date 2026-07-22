// Generated from deployments/index.json. Do not edit manually.
export const DEPLOYMENT_INDEX = {
  "schemaVersion": 1,
  "active": {},
  "deployments": [
    {
      "version": "0.3.2",
      "network": "base-sepolia",
      "chainId": 84532,
      "status": "deprecated",
      "manifest": "base-sepolia/v0.3.2.json",
      "reason": "The demo owner signer was exposed. Do not rely on this stack for authorization or current examples."
    }
  ]
} as const;

export const ACTIVE_PRESETS: Record<string, Record<string, string>> = {};
