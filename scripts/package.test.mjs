import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('packed CLI runs without the workspace SDK and contains only unified assets', () => {
  const temp = mkdtempSync(join(tmpdir(), 'ilal-package-'));
  try {
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temp], { cwd: 'cli', encoding: 'utf8' }));
    const names = pack.files.map(f => f.path);
    for (const old of ['dist/commands/session.js', 'dist/commands/netting.js', 'dist/sessionProtocol.js', 'dist/vendor-sdk/session.js', 'dist/console-assets/app.html', 'dist/console-assets/console.html']) assert.ok(!names.includes(old), old);
    assert.ok(names.includes('dist/console-assets/mixed.html'));
    assert.ok(names.includes('dist/vendor-sdk/mixed/client.js'));
    const install = join(temp, 'install');
    mkdirSync(install);
    writeFileSync(join(install, 'package.json'), JSON.stringify({ private: true, dependencies: { '@ilal/cli': `file:${join(temp, pack.filename)}` } }));
    execFileSync('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], { cwd: install, stdio: 'pipe' });
    const result = execFileSync(process.execPath, ['node_modules/@ilal/cli/dist/index.js', '--help'], { cwd: install, encoding: 'utf8' });
    assert.match(result, /eligibility/);
    assert.match(result, /execute/);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
