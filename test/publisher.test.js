import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { sha256 } from '../lib/hash.js';
import { assertPublicationPaths, validateRepairPatch } from '../lib/publisher.js';

test('direct push treats the campaign issue as optional but keeps git publication strict', async () => {
  const source = await readFile(new URL('../lib/publisher.js', import.meta.url), 'utf8');

  assert.match(source, /gh', \['issue', 'create'.*reject: false/s);
  assert.match(source, /if \(issue\.exitCode === 0\)/);
  assert.match(source, /runCommand\('git', \['push', 'origin', `HEAD:\$\{defaultBranch\}`\]/);
  assert.doesNotMatch(source, /HEAD:\$\{defaultBranch\}`\], \{[^}]*reject:/s);
});

test('publisher rejects truncated or tampered repair artifacts before git apply', () => {
  const patch = 'diff --git a/a b/a\n';
  assert.doesNotThrow(() => validateRepairPatch({ repair: { patchSha256: sha256(patch) } }, patch));
  assert.throws(
    () => validateRepairPatch({ repair: { patchSha256: sha256(patch) } }, '[output truncated to final 16 characters]\npartial'),
    { code: 'PUBLISH_PATCH_TRUNCATED' },
  );
  assert.throws(
    () => validateRepairPatch({ repair: { patchSha256: sha256(patch) } }, `${patch}tampered`),
    { code: 'PUBLISH_PATCH_DIGEST_MISMATCH' },
  );
});

test('publisher allows only its managed lock after separately validating the repair patch', () => {
  const protectedPaths = ['.dsh-compat.lock.json', '.dsh-compat.yml', '.github/workflows/**'];
  assert.doesNotThrow(() => assertPublicationPaths(['package.json'], protectedPaths));
  assert.throws(
    () => assertPublicationPaths(['.dsh-compat.lock.json'], protectedPaths),
    { code: 'PROTECTED_PATH_CHANGED' },
  );
  assert.doesNotThrow(
    () => assertPublicationPaths(['package.json', '.dsh-compat.lock.json'], protectedPaths, true),
  );
  assert.throws(
    () => assertPublicationPaths(['.dsh-compat.yml', '.dsh-compat.lock.json'], protectedPaths, true),
    { code: 'PROTECTED_PATH_CHANGED' },
  );
});
