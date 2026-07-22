# Security policy

ILAL is unaudited testnet software and is not production-ready. Do not put production funds, customer identity data, witnesses, private ceremony entropy, or live credentials into this repository or its demo deployments.

Report vulnerabilities privately to the repository owner rather than opening a public exploit issue. Include the affected commit, component, impact, reproduction, and any suggested mitigation. No bug-bounty program or response SLA is currently promised.

Never send private keys, seed phrases, keystore passwords, access tokens, or authenticated RPC URLs in a report. Any signer secret that has been disclosed is permanently treated as compromised even if the corresponding address remains useful as public evidence.

The security boundary and open production gates are documented in `docs/data-room/THREAT_MODEL.md` and `docs/data-room/RISK_REMEDIATION.md`.
