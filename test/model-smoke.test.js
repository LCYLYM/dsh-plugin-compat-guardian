import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolveModelFixtures } from '../lib/model-smoke.js';

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
