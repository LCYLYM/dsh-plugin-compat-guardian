import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stringify } from 'yaml';

import { runCommand } from '../lib/process.js';
import { verifyRepository } from '../lib/verifier.js';

test('a blocked registry probe does not advance verified lock', async () => {
  const path = await mkdtemp(join(tmpdir(), 'guardian-failure-lock-'));
  const output = await mkdtemp(join(tmpdir(), 'guardian-failure-output-'));
  const server = createServer((_request, response) => {
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const registry = `http://127.0.0.1:${server.address().port}`;
  const sentinel = {
    schema: 1,
    resetBudget: 'N',
    verified: { snapshot_key: 'must-survive' },
    campaigns: {},
  };
  try {
    await writeFile(join(path, 'package.json'), `${JSON.stringify({ name: 'fixture', version: '1.0.0' }, null, 2)}\n`);
    await writeFile(join(path, '.dsh-compat.yml'), stringify({
      schema: 1,
      watch: { source: 'npm', registry, package: '@deepseek-ai/dsh', channel: 'latest' },
      gates: { repository: [] },
    }));
    await writeFile(join(path, 'dsh-smoke.yml'), stringify({
      schema: 1,
      requires_model_turn: false,
      web: { assertions: [{ path: '/', status: 200 }] },
    }));
    await writeFile(join(path, '.dsh-compat.lock.json'), `${JSON.stringify(sentinel, null, 2)}\n`);
    await runCommand('git', ['init', '-b', 'main'], { cwd: path });
    await runCommand('git', ['add', '.'], { cwd: path });
    await runCommand('git', [
      '-c', 'user.name=Guardian Test', '-c', 'user.email=guardian@example.invalid',
      'commit', '-m', 'test fixture',
    ], { cwd: path });

    await assert.rejects(() => verifyRepository({
      repoPath: path,
      contractPath: 'dsh-smoke.yml',
      outputDirectory: output,
    }), { code: 'REGISTRY_UNAVAILABLE' });
    assert.deepEqual(JSON.parse(await readFile(join(path, '.dsh-compat.lock.json'), 'utf8')), sentinel);
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.error.code, 'REGISTRY_UNAVAILABLE');
  } finally {
    server.close();
    await once(server, 'close');
    await Promise.all([
      rm(path, { recursive: true, force: true }),
      rm(output, { recursive: true, force: true }),
    ]);
  }
});
