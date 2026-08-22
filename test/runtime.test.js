import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { GuardianError } from '../lib/errors.js';
import { packageManagerInstallArgs, resolveNodeRuntime, resolvePackageManager } from '../lib/runtime.js';

async function fixture(manifest = {}) {
  const path = await mkdtemp(join(tmpdir(), 'guardian-runtime-'));
  await writeFile(join(path, 'package.json'), `${JSON.stringify({ name: 'fixture', ...manifest }, null, 2)}\n`);
  return path;
}

test('Node resolver accepts the current runtime through package engines', async () => {
  const path = await fixture({ engines: { node: '^22.19.0 || >=24.0.0' } });
  try {
    const result = await resolveNodeRuntime(path);
    assert.equal(result.exactVersion, process.versions.node);
    assert.equal(result.source, 'package.json#engines.node');
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('Node resolver blocks conflicting declarations', async () => {
  const path = await fixture({ engines: { node: '>=24.0.0' } });
  try {
    await writeFile(join(path, '.node-version'), '22.19.0\n');
    await assert.rejects(() => resolveNodeRuntime(path), error => {
      assert.ok(error instanceof GuardianError);
      assert.equal(error.code, 'RUNTIME_CONFLICT');
      return true;
    });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('package manager resolver defaults to npm', async () => {
  const path = await fixture();
  try {
    const result = await resolvePackageManager(path);
    assert.equal(result.name, 'npm');
    assert.equal(result.source, 'fallback-npm');
    assert.match(result.exactVersion, /^\d+\./);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('package manager resolver blocks conflicting locks and Bun', async () => {
  const conflict = await fixture();
  const bun = await fixture({ packageManager: 'bun@1.2.0' });
  try {
    await writeFile(join(conflict, 'package-lock.json'), '{}\n');
    await writeFile(join(conflict, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await assert.rejects(() => resolvePackageManager(conflict), { code: 'PACKAGE_MANAGER_CONFLICT' });
    await assert.rejects(() => resolvePackageManager(bun), { code: 'BLOCKED_UNSUPPORTED' });
  } finally {
    await Promise.all([
      rm(conflict, { recursive: true, force: true }),
      rm(bun, { recursive: true, force: true }),
    ]);
  }
});

test('repository installs use each selected package manager frozen mode', () => {
  assert.deepEqual(packageManagerInstallArgs({ name: 'npm', exactVersion: '11.0.0', lockfiles: ['package-lock.json'] }), ['ci']);
  assert.deepEqual(packageManagerInstallArgs({ name: 'pnpm', exactVersion: '10.0.0', lockfiles: ['pnpm-lock.yaml'] }), ['install', '--frozen-lockfile']);
  assert.deepEqual(packageManagerInstallArgs({ name: 'yarn', exactVersion: '1.22.0', lockfiles: ['yarn.lock'] }), ['install', '--frozen-lockfile']);
  assert.deepEqual(packageManagerInstallArgs({ name: 'yarn', exactVersion: '4.0.0', lockfiles: ['yarn.lock'] }), ['install', '--immutable']);
  assert.deepEqual(packageManagerInstallArgs({ name: 'npm', exactVersion: '11.0.0', lockfiles: [] }), ['install', '--no-package-lock']);
});
