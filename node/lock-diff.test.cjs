const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { diffLocks } = require('./lock-diff.cjs');

const modern = (packages, lockfileVersion = 3) => ({ lockfileVersion, packages });

test('reports sorted additions, removals, upgrades, and downgrades', () => {
  const before = modern({
    '': { version: '1.0.0' },
    'node_modules/upgrade': { version: '1.0.0' },
    'node_modules/remove': { version: '1.0.0' },
    'node_modules/downgrade': { version: '2.0.0' },
    'node_modules/same': { version: '1.0.0', integrity: 'old' },
  });
  const after = modern({
    '': { version: '2.0.0' },
    'node_modules/same': { version: '1.0.0', integrity: 'new' },
    'node_modules/upgrade': { version: '1.1.0' },
    'node_modules/add': { version: '1.0.0' },
    'node_modules/downgrade': { version: '1.0.0' },
  });
  assert.equal(diffLocks(before, after), [
    'node_modules/add added',
    'node_modules/downgrade 2.0.0 -> 1.0.0',
    'node_modules/remove removed',
    'node_modules/upgrade 1.0.0 -> 1.1.0',
  ].join('\n'));
});

test('keeps scoped and nested copies distinct, including non-semver versions', () => {
  assert.equal(diffLocks(modern({
    'node_modules/@scope/pkg': { version: '1.0.0-beta.1' },
    'node_modules/parent/node_modules/@scope/pkg': { version: 'git:old' },
  }), modern({
    'node_modules/@scope/pkg': { version: '1.0.0' },
    'node_modules/parent/node_modules/@scope/pkg': { version: 'git:new' },
  })), [
    'node_modules/@scope/pkg 1.0.0-beta.1 -> 1.0.0',
    'node_modules/parent/node_modules/@scope/pkg git:old -> git:new',
  ].join('\n'));
});

test('uses the complete packages map in v2 and ignores root and link metadata', () => {
  const before = { ...modern({ '': { version: '1' }, 'node_modules/a': { version: '1' } }, 2), dependencies: {} };
  const after = { ...modern({ '': { version: '2' }, 'node_modules/a': { version: '2' },
    'node_modules/link': { link: true, resolved: 'workspace' }, 'workspace': {} }, 2), dependencies: {} };
  assert.equal(diffLocks(before, after), 'node_modules/a 1 -> 2');
});

test('normalizes nested v1 dependencies without reporting format-only changes', () => {
  const before = { lockfileVersion: 1, dependencies: {
    parent: { version: '1', dependencies: { child: { version: '2' } } },
  } };
  const after = modern({ '': {}, 'node_modules/parent': { version: '1' },
    'node_modules/parent/node_modules/child': { version: '2' } });
  assert.equal(diffLocks(before, after), '');
  after.packages['node_modules/parent/node_modules/child'].version = '3';
  assert.equal(diffLocks(before, after), 'node_modules/parent/node_modules/child 2 -> 3');
});

test('rejects invalid lockfile structure instead of producing an empty summary', () => {
  for (const invalid of [null, [], {}, { packages: [], dependencies: {} },
    { packages: null, dependencies: {} }, { packages: { 'node_modules/a': null } },
    { packages: { 'node_modules/a': { version: 123 } } }, { dependencies: { a: { dependencies: [] } } }]) {
    assert.throws(() => diffLocks(invalid, modern({})));
  }
});

test('CLI works from a consumer directory and writes the Actions diff output', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'package updates test-'));
  const beforePath = join(directory, 'before.json');
  const afterPath = join(directory, 'after.json');
  const outputPath = join(directory, 'github-output');
  t.after(() => {
    for (const path of [beforePath, afterPath, outputPath]) rmSync(path, { force: true });
    rmdirSync(directory);
  });
  writeFileSync(beforePath, JSON.stringify(modern({})));
  writeFileSync(afterPath, JSON.stringify(modern({ 'node_modules/new': { version: '1.0.0' } })));
  const run = (...args) => spawnSync(process.execPath, [join(__dirname, 'lock-diff.cjs'), ...args], {
    cwd: directory, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: outputPath },
  });
  const changed = run(beforePath, afterPath);
  assert.equal(changed.status, 0, changed.stderr);
  assert.equal(changed.stdout, 'node_modules/new added\n');
  const output = readFileSync(outputPath, 'utf8');
  assert.match(output, /^diff<<(lock_diff_[\w-]+)\nnode_modules\/new added\n\1\n$/);
  writeFileSync(outputPath, '');
  const unchanged = run(beforePath, beforePath);
  assert.equal(unchanged.status, 0, unchanged.stderr);
  assert.equal(unchanged.stdout, '');
  assert.match(readFileSync(outputPath, 'utf8'), /^diff<<(lock_diff_[\w-]+)\n\n\1\n$/);
  writeFileSync(outputPath, 'existing-output\n');
  writeFileSync(afterPath, '{bad JSON');
  for (const args of [[beforePath, afterPath], [beforePath, 'missing.json'], []]) {
    const failed = run(...args);
    assert.equal(failed.status, 1);
    assert.equal(failed.stdout, '');
    assert.match(failed.stderr, /^lock-diff:/);
    assert.equal(readFileSync(outputPath, 'utf8'), 'existing-output\n');
  }
});
