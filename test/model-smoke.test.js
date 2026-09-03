import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { stringify } from 'yaml';

import { finalText, modelSmokeWebArgs, resolveModelFixtures, runCandidateModelSmoke } from '../lib/model-smoke.js';

test('model smoke starts the web profile directly without a legacy web subcommand', () => {
  assert.deepEqual(modelSmokeWebArgs('web', '/tmp/overlay.yml', 4321), [
    '--profile', 'web', '--patch', '/tmp/overlay.yml', '--host', '127.0.0.1', '--port', '4321',
  ]);
});

test('reviewed model smoke missing key persists BLOCKED_CONFIG and an input fingerprint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-model-smoke-missing-key-'));
  const output = join(root, 'output');
  const prior = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    await mkdir(join(root, 'compatibility'));
    await writeFile(join(root, 'package.json'), '{"name":"model-smoke-fixture","version":"1.0.0"}\n');
    await writeFile(join(root, 'compatibility', 'pixel.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    await writeFile(join(root, 'compatibility', 'dsh-smoke.yml'), stringify({
      schema: 1,
      requires_model_turn: true,
      model_turn_scope: 'candidate-only',
      fixture_mode: 'fixed',
      model_smoke: {
        prompt: 'Inspect the image.', fixtures: [{ path: 'compatibility/pixel.png' }], required_event_types: ['turn/end'],
      },
      web: { assertions: [{ path: '/', status: 200 }] },
    }));
    const baseLock = join(root, 'base-lock.json');
    await writeFile(baseLock, '{"schema":1,"resetBudget":"N","verified":{"snapshot_key":"provisional-candidate"},"campaigns":{}}\n');
    await writeFile(join(root, '.dsh-compat.lock.json'), '{"schema":1,"resetBudget":"N","verified":{"snapshot_key":"last-real-pass"},"campaigns":{}}\n');
    await assert.rejects(() => runCandidateModelSmoke({
      repoPath: root, dshVersion: '0.1.1-rc.2', outputDirectory: output, baseLockPath: baseLock,
    }), { code: 'MODEL_CREDENTIAL_MISSING' });
    const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
    const lock = JSON.parse(await readFile(join(output, 'blocked-lock.json'), 'utf8'));
    assert.equal(report.status, 'BLOCKED_CONFIG');
    assert.equal(lock.campaigns['0.1.1-rc.2'].status, 'BLOCKED_CONFIG');
    assert.match(lock.campaigns['0.1.1-rc.2'].input_fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(lock.verified.snapshot_key, 'last-real-pass');
  } finally {
    if (prior === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prior;
    await rm(root, { recursive: true, force: true });
  }
});

test('model smoke reads rc.2 wrapped assistant messages and legacy messages', () => {
  assert.equal(finalText([{ type: 'assistant/message', data: {
    message: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'visible' }] },
  } }]), 'visible');
  assert.equal(finalText([{ type: 'assistant/message', data: {
    content: [{ type: 'text', text: 'legacy' }],
  } }]), 'legacy');
});

test('reviewed visual fixture is frozen by bytes and cannot escape the repository', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-fixture-'));
  try {
    await mkdir(join(root, 'compatibility'));
    await writeFile(join(root, 'compatibility', 'pixel.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const contract = { fixture_mode: 'fixed', model_smoke: { fixtures: [{ path: 'compatibility/pixel.png' }] } };
    const [fixture] = await resolveModelFixtures(root, contract);
    assert.equal(fixture.bytes, 8);
    assert.equal(fixture.mediaType, 'image/png');
    assert.equal(fixture.data, 'iVBORw0KGgo=');
    await assert.rejects(
      () => resolveModelFixtures(root, { fixture_mode: 'fixed', model_smoke: { fixtures: [{ path: '../outside.png' }] } }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('text model smoke has no visual fixture and keeps the same event contract', async () => {
  const root = await mkdtemp(join(tmpdir(), 'guardian-text-fixture-'));
  try {
    await writeFile(join(root, 'package.json'), '{"name":"text-model-smoke-fixture"}\n');
    const contract = {
      fixture_mode: 'none',
      model_smoke: {
        input_mode: 'text',
        required_event_types: ['user/message', 'tool/call', 'tool/result', 'assistant/message', 'turn/end'],
      },
    };
    assert.deepEqual(await resolveModelFixtures(root, contract), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
