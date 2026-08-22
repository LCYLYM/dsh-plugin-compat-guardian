import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';

test('reusable workflow keeps immutable actions, concurrency, and split permissions', async () => {
  const source = await readFile(new URL('../.github/workflows/guardian.yml', import.meta.url), 'utf8');
  const workflow = parse(source);

  assert.ok(workflow.on.workflow_call);
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  assert.equal(workflow.jobs.verify.permissions.contents, 'read');
  assert.deepEqual(workflow.jobs.publish.permissions, {
    contents: 'write',
    'pull-requests': 'write',
  });
  assert.equal(workflow.jobs.repair.permissions.contents, 'read');
  assert.deepEqual(workflow.jobs['publish-repair'].permissions, {
    contents: 'write',
    'pull-requests': 'write',
  });

  const uses = Object.values(workflow.jobs)
    .flatMap(job => job.steps ?? [])
    .map(step => step.uses)
    .filter(Boolean);
  assert.ok(uses.length > 0);
  for (const reference of uses) {
    assert.match(reference, /^[^@\s]+@[0-9a-f]{40}$/);
  }

  assert.doesNotMatch(source, /pull_request_target|pull_request:/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs.verify), /DEEPSEEK_API_KEY|secrets\./);
  assert.doesNotMatch(JSON.stringify(workflow.jobs.publish), /DEEPSEEK_API_KEY|secrets\./);
  assert.doesNotMatch(JSON.stringify(workflow.jobs['publish-repair']), /DEEPSEEK_API_KEY|secrets\./);
  assert.match(JSON.stringify(workflow.jobs.repair), /DEEPSEEK_API_KEY.*secrets\.deepseek_api_key/);
  const modelCheckout = workflow.jobs.repair.steps.find(step => step.name.includes('failed plugin source'));
  assert.equal(modelCheckout.with['persist-credentials'], false);
});
