import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('direct push treats the campaign issue as optional but keeps git publication strict', async () => {
  const source = await readFile(new URL('../lib/publisher.js', import.meta.url), 'utf8');

  assert.match(source, /gh', \['issue', 'create'.*reject: false/s);
  assert.match(source, /if \(issue\.exitCode === 0\)/);
  assert.match(source, /runCommand\('git', \['push', 'origin', `HEAD:\$\{defaultBranch\}`\]/);
  assert.doesNotMatch(source, /HEAD:\$\{defaultBranch\}`\], \{[^}]*reject:/s);
});
