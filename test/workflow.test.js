import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parse } from 'yaml';

test('reusable workflow keeps immutable actions, concurrency, and split permissions', async () => {
  const source = await readFile(new URL('../.github/workflows/guardian.yml', import.meta.url), 'utf8');
  const workflow = parse(source);

  assert.ok(workflow.on.workflow_call);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.equal(workflow.jobs.verify.permissions.contents, 'read');
  assert.deepEqual(workflow.jobs.publish.permissions, {
    contents: 'write',
    'pull-requests': 'write',
    issues: 'write',
  });
  assert.equal(workflow.jobs.repair.permissions.contents, 'read');
  assert.equal(workflow.jobs['candidate-model-smoke'].permissions.contents, 'read');
  assert.deepEqual(workflow.jobs['publish-repair'].permissions, {
    contents: 'write',
    'pull-requests': 'write',
    issues: 'write',
  });
  assert.deepEqual(workflow.jobs['publish-blocked-state'].permissions, {
    contents: 'write',
    'pull-requests': 'write',
    issues: 'write',
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
  assert.doesNotMatch(JSON.stringify(workflow.jobs.publish), /DEEPSEEK_API_KEY|deepseek_api_key/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs['publish-repair']), /DEEPSEEK_API_KEY|deepseek_api_key/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs['publish-blocked-state']), /DEEPSEEK_API_KEY|secrets\./);
  assert.match(JSON.stringify(workflow.jobs.repair), /DEEPSEEK_API_KEY.*secrets\.deepseek_api_key/);
  assert.match(JSON.stringify(workflow.jobs['candidate-model-smoke']), /DEEPSEEK_API_KEY.*secrets\.deepseek_api_key/);
  assert.doesNotMatch(JSON.stringify(workflow.jobs['candidate-model-smoke'].permissions), /write/);
  assert.match(JSON.stringify(workflow.jobs.repair.outputs), /status.*steps\.repair\.outputs\.status/);
  assert.match(workflow.jobs['publish-repair'].if, /outputs\.status == 'PASS'/);
  assert.match(workflow.jobs['publish-blocked-state'].if, /BLOCKED_CONFIG.*BLOCKED_EXTERNAL.*BLOCKED_CONTRACT/);
  assert.match(workflow.jobs['publish-model-smoke-state'].if, /BLOCKED_CONFIG.*BLOCKED_EXTERNAL/);
  assert.match(source, /refs\/heads\/automation\/dsh-compat\/\$safe_version/);
  const repairPending = workflow.jobs.repair.steps.find(step => step.id === 'pending');
  assert.match(repairPending.run, /state_branch=.*state\/\$safe_version/);
  assert.match(repairPending.run, /repair_branch=.*compat\/\$safe_version/);
  assert.match(repairPending.run, /refs\/heads\/\$repair_branch/);
  const notifySteps = workflow.jobs.notify.steps;
  assert.match(notifySteps.find(step => step.name === 'Download repair report when one exists').if, /needs\.repair\.result.*skipped/);
  assert.match(notifySteps.find(step => step.name === 'Download candidate model-smoke report when one exists').if, /needs\.candidate-model-smoke\.result.*skipped/);
  const modelCheckout = workflow.jobs.repair.steps.find(step => step.name.includes('failed plugin source'));
  assert.equal(modelCheckout.with['persist-credentials'], false);
});
