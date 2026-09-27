#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { validatePilotEvidence } from './pilot/model.mjs';
const root = resolve(new URL('..', import.meta.url).pathname);
const json = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const protocol = json('protocol.json');
assert.equal(protocol.implementation, 'ilal-v1');
assert.equal(protocol.softwareStatus, 'development');
assert.equal(protocol.publication, 'not published');
assert.equal(protocol.auditStatus, 'unaudited');
assert.equal(protocol.productionReadiness, 'not production-ready');
for (const name of ['cli', 'sdk', 'circuits']) {
  const pkg = json(`${name}/package.json`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.private, true, `${name} must remain unpublished until a reviewed release`);
  if (name !== 'circuits') assert.equal(pkg.version, protocol.packageVersion);
  assert.equal(json(`${name}/package-lock.json`).packages[''].version, pkg.version);
}
const deployment = json(protocol.deploymentManifest);
assert.equal(deployment.format, 'ilal-mixed-deployment-v1');
assert.equal(deployment.protocolVersion, 3);
assert.equal(deployment.status, 'candidate');
assert.equal(deployment.classification, 'testnet');
if (deployment.operationalEvidence?.status === 'completed') {
  const evidenceRaw = readFileSync(resolve(root, deployment.operationalEvidence.evidencePath));
  validatePilotEvidence(JSON.parse(evidenceRaw));
  assert.equal(createHash('sha256').update(evidenceRaw).digest('hex'), deployment.operationalEvidence.evidenceSHA256);
}
const index = json('deployments/index.json');
assert.ok(index.deployments.some(d => `deployments/${d.manifest}` === protocol.deploymentManifest));
const foundry = readFileSync(resolve(root, 'contracts/foundry.toml'), 'utf8');
assert.ok(Number(foundry.match(/\[profile\.default\.fuzz\][\s\S]*?runs\s*=\s*(\d+)/)?.[1]) >= 256);
function checkSources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) checkSources(path);
    else if (entry.name.endsWith('.sol')) {
      const expected = entry.name === 'ILALPolicyVerifierV2.sol' ? 'GPL-3.0' : 'Apache-2.0';
      assert.equal(readFileSync(path, 'utf8').split('\n')[0], `// SPDX-License-Identifier: ${expected}`);
    }
  }
}
checkSources(resolve(root, 'contracts/src'));
checkSources(resolve(root, 'contracts/test'));
console.log('Unified protocol, development packages, candidate evidence and license policy are valid.');
