import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { parse } from 'yaml';

import { scaffoldRepository } from '../lib/onboard.js';

test('scaffold discovers a real health route and creates no model contract', async () => {
  const path = await mkdtemp(join(tmpdir(), 'guardian-onboard-'));
  try {
    await mkdir(join(path, 'lib'));
    await writeFile(join(path, 'package.json'), `${JSON.stringify({
      name: 'fixture-plugin',
      version: '1.0.0',
      type: 'module',
      main: 'lib/index.js',
      scripts: { test: 'node --test' },
    }, null, 2)}\n`);
    await writeFile(join(path, 'lib/index.js'), `
      export const name = 'fixture-plugin';
      const API_ROOT = '/fixture/v1';
      if (req.method === 'GET' && suffix === '/health') json(res, 200, { ok: true });
    `);
    const result = await scaffoldRepository(path, { noWorkflow: true });
    assert.deepEqual(result.files.sort(), [
      '.dsh-compat.lock.json',
      '.dsh-compat.yml',
      'compatibility/dsh-smoke.yml',
    ]);
    const contract = parse(await readFile(join(path, 'compatibility/dsh-smoke.yml'), 'utf8'));
    assert.equal(contract.requires_model_turn, false);
    assert.equal(contract.web.assertions[0].path, '/fixture/v1/health');
    assert.deepEqual(contract.web.assertions[0].json_subset, { ok: true, plugin: 'fixture-plugin' });
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('scaffold rejects a movable reusable workflow ref', async () => {
  const path = await mkdtemp(join(tmpdir(), 'guardian-onboard-ref-'));
  try {
    await mkdir(join(path, 'lib'));
    await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', main: 'lib/index.js' }));
    await writeFile(join(path, 'lib/index.js'), `const API_ROOT = '/x'; if (suffix === '/health') {}`);
    await assert.rejects(
      () => scaffoldRepository(path, { guardianRef: 'owner/repo/.github/workflows/guardian.yml@main' }),
      { code: 'GUARDIAN_REF_REQUIRED' },
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('scaffold writes the repository and immutable SHA into the thin workflow', async () => {
  const path = await mkdtemp(join(tmpdir(), 'guardian-onboard-workflow-'));
  try {
    await mkdir(join(path, 'lib'));
    await writeFile(join(path, 'package.json'), JSON.stringify({ name: 'fixture', main: 'lib/index.js' }));
    await writeFile(join(path, 'lib/index.js'), `const API_ROOT = '/x'; if (suffix === '/health') {}`);
    const sha = 'a'.repeat(40);
    await scaffoldRepository(path, {
      guardianRef: `owner/guardian/.github/workflows/guardian.yml@${sha}`,
    });
    const workflow = await readFile(join(path, '.github/workflows/dsh-compat.yml'), 'utf8');
    assert.match(workflow, new RegExp(`uses: owner/guardian/.github/workflows/guardian.yml@${sha}`));
    assert.match(workflow, /guardian_repository: owner\/guardian/);
    assert.match(workflow, new RegExp(`guardian_ref: ${sha}`));
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
