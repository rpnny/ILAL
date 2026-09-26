import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const run = (...args) => spawnSync(process.execPath, ['dist/index.js', ...args], { encoding: 'utf8' });
test('ILAL exposes a single protocol with direct commands', () => {
  const result = run('--help');
  assert.equal(result.status, 0, result.stderr);
  for (const command of ['grant', 'quote', 'execute', 'liquidity', 'console', 'safe-propose']) {
    assert.match(result.stdout, new RegExp(`\\n  ${command}[ \\[]`));
  }
  for (const obsolete of ['mixed', 'session', 'netting', 'policy-v2', 'demo', 'init']) {
    assert.doesNotMatch(result.stdout, new RegExp(`\\n  ${obsolete}[ \\[]`));
    assert.notEqual(run(obsolete).status, 0, obsolete);
  }
});
test('execution never silently selects a historical deployment', () => {
  const result = run('execute', '--input', 'orders.json');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /manifest/);
});
