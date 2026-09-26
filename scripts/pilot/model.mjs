import {createRequire} from 'node:module';
const require=createRequire(new URL('../../sdk/package.json',import.meta.url));
const {getAddress}=require('viem');

const decimal = (value, name) => {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${name}`);
  return BigInt(value);
};

export function validatePilotConfig(config) {
  if (config?.format !== 'ilal-issuer-pilot-config-v1' || !Number.isSafeInteger(config.chainId) || config.chainId < 1) throw new Error('Pilot config format/chain');
  const roleNames = ['deployer','issuer','settlementAssetOperator','liquidityProvider','institutionA','institutionB','executor'];
  const roles = roleNames.map(name => getAddress(config.roles?.[name]));
  if (new Set(roles.map(address => address.toLowerCase())).size !== roles.length) throw new Error('Pilot roles must be distinct');
  const a = config.assets?.issuerStablecoin, b = config.assets?.settlementCash;
  if (!a || !b || a.role !== 'issuer-stablecoin' || b.role !== 'sandbox-settlement-cash' || a.decimals !== 6 || b.decimals !== 6) throw new Error('Pilot asset responsibilities');
  if (!a.name || !a.symbol || !b.name || !b.symbol || a.symbol === b.symbol) throw new Error('Pilot asset identity');
  if (config.policy?.mode !== 'CNF_ONLY' || !Number.isSafeInteger(config.policy.grantTtlSeconds) || config.policy.grantTtlSeconds < 60 || config.policy.grantTtlSeconds > 604800) throw new Error('Pilot policy');
  const scenario = config.scenario;
  if (decimal(scenario?.issuerAssetInput, 'issuerAssetInput') !== 100000000n || decimal(scenario?.settlementCashInput, 'settlementCashInput') !== 70000000n || scenario.tickLower !== -1000 || scenario.tickUpper !== 1000 || decimal(scenario?.liquidityDelta, 'liquidityDelta') <= 0n) throw new Error('Pilot canonical scenario');
  return config;
}

export function validatePilotEvidence(evidence) {
  if (evidence?.format !== 'ilal-issuer-pilot-evidence-v1' || evidence.status !== 'PASSED') throw new Error('Pilot evidence status');
  const roles = Object.values(evidence.roles ?? {}).map(value=>getAddress(value));
  if (roles.length !== 7 || new Set(roles.map(address => address.toLowerCase())).size !== 7) throw new Error('Evidence role separation');
  if (evidence.assets?.issuerStablecoin?.role !== 'issuer-stablecoin' || evidence.assets?.settlementCash?.role !== 'sandbox-settlement-cash') throw new Error('Evidence asset responsibilities');
  if (evidence.policy?.mode !== 'CNF_ONLY') throw new Error('Evidence policy mode');
  const gross = decimal(evidence.flow?.grossInstitutionalFlow, 'gross flow');
  const matched = decimal(evidence.flow?.internallyMatchedFlow, 'matched flow');
  const residual = decimal(evidence.flow?.unmatchedResidual, 'residual');
  const amm = decimal(evidence.flow?.actualAmmInput, 'AMM input');
  if (gross !== 170000000n || matched !== 140000000n || residual !== 30000000n || gross - matched !== residual || amm !== residual) throw new Error('Only unmatched residual may reach the AMM');
  if (JSON.stringify(evidence.quote?.outputs) !== JSON.stringify(evidence.execution?.outputs)) throw new Error('Quote/execution output mismatch');
  for (const name of ['quotePolicyChangeExecute','revokedInstitutionRejected']) if (evidence.negativeTests?.[name]?.passed !== true || evidence.negativeTests[name].stateUnchanged !== true) throw new Error(`Missing negative test: ${name}`);
  if (evidence.lpSafety?.exitAfterPolicyFailure !== true || evidence.lpSafety?.collectAfterPolicyFailure !== true || evidence.lpSafety?.oracleFailureInduced !== true) throw new Error('LP principal safety invariant');
  for (const value of Object.values(evidence.inventory ?? {})) if (decimal(value, 'inventory') !== 0n) throw new Error('Router/Hook inventory');
  const transactions = Object.values(evidence.transactions ?? {});
  if (transactions.length < 8 || transactions.some(hash => !/^0x[0-9a-fA-F]{64}$/.test(hash))) throw new Error('Pilot transaction evidence');
  return evidence;
}
