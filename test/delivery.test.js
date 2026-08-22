import assert from 'node:assert/strict';
import test from 'node:test';

import { deliveryPlan } from '../lib/delivery.js';

test('delivery supports all three modes while risky diffs force human review', () => {
  for (const mode of ['pull-request', 'auto-merge', 'direct-push']) {
    assert.equal(deliveryPlan({ delivery: { mode } }).effective, mode);
  }
  const plan = deliveryPlan({ delivery: { mode: 'direct-push' } }, {
    repair: { diffPolicy: { disposition: 'pull-request', forceReview: ['test surface changed'] } },
  });
  assert.equal(plan.effective, 'pull-request');
  assert.equal(plan.forcedHumanReview, true);
});
