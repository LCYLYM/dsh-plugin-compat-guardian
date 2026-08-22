import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addUsage,
  budgetState,
  campaignEpoch,
  modelInputUnchangedAfterPush,
  recordCampaign,
  repairCampaignGate,
  shouldSendConvergeMessage,
} from '../lib/campaign.js';

const pricing = {
  timezone: 'Asia/Shanghai',
  peak_windows: [{ start: '09:00', end: '12:00' }],
};
const budget = {
  max_tokens: 1_000,
  max_cny: 10,
  max_wall_minutes: 60,
  converge_remaining_ratio: 0.3,
  converge_message_enabled: true,
};

test('campaign usage adds provider fields without double-counting reasoning', () => {
  assert.deepEqual(addUsage(
    { inputTokens: 10, outputTokens: 2, cacheReadTokens: 20, reasoningTokens: 1, sessionFiles: 1 },
    { inputTokens: 3, outputTokens: 4, cacheWriteTokens: 5, reasoningTokens: 2, sessionFiles: 1 },
  ), {
    inputTokens: 13,
    outputTokens: 6,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
    reasoningTokens: 3,
    totalTokens: 44,
    sessionFiles: 2,
  });
});

test('same target freezes until N-to-Y or a larger limit and consumes reset back to N', () => {
  const lock = {
    schema: 1,
    resetBudget: 'N',
    campaigns: {
      '0.1.1-rc.2': {
        status: 'BLOCKED',
        automatic_repair_used: true,
        attempts_used: 2,
        limits: { max_tokens: 1_000, max_cny: 10, max_wall_minutes: 60, max_attempts: 2 },
      },
    },
  };
  const frozen = repairCampaignGate({ lock, target: '0.1.1-rc.2', budget, maxAttempts: 2, startPolicy: 'immediate', pricing });
  assert.deepEqual(frozen, { status: 'FROZEN', reason: 'explicit-reset-required', reset: null });
  lock.resetBudget = 'Y';
  const reset = repairCampaignGate({ lock, target: '0.1.1-rc.2', budget, maxAttempts: 2, startPolicy: 'immediate', pricing });
  assert.equal(reset.status, 'READY');
  assert.equal(reset.reset, 'reset-budget');
  assert.equal(recordCampaign(lock, '0.1.1-rc.2', { status: 'RUNNING' }).resetBudget, 'N');
  const epoch = campaignEpoch(lock.campaigns['0.1.1-rc.2'], reset.reset);
  assert.equal(epoch.epoch, 2);
  assert.equal(epoch.attempts_used, 0);
  assert.equal(epoch.lifetime_attempts, 2);
  assert.equal(epoch.history.length, 1);
});

test('unknown CNY does not fabricate an official-provider cost', () => {
  const state = budgetState({ usage: { totalTokens: 100 }, estimatedCny: null, attemptsUsed: 1 }, budget, 2);
  assert.equal(state.consumed.cny, null);
  assert.equal(state.ratios.cny, null);
  assert.equal(state.exhausted, false);
});

test('low-price gate waits at peak, while manual runs bypass only the price wait', () => {
  const peak = new Date('2026-08-22T02:00:00Z');
  const waiting = repairCampaignGate({
    lock: { campaigns: {} }, target: 'next', budget, maxAttempts: 2,
    startPolicy: 'low-price-window', pricing, now: peak,
  });
  assert.equal(waiting.status, 'WAITING_FOR_PRICE');
  const manual = repairCampaignGate({
    lock: { campaigns: {} }, target: 'next', budget, maxAttempts: 2,
    startPolicy: 'low-price-window', pricing, now: peak, manualPriceOverride: true,
  });
  assert.equal(manual.status, 'READY');
});

test('external blockers stay frozen on schedules and reopen on an explicit manual run', () => {
  const lock = { campaigns: { next: { status: 'BLOCKED_EXTERNAL' } } };
  assert.equal(repairCampaignGate({
    lock, target: 'next', budget, maxAttempts: 2, startPolicy: 'immediate', pricing, trigger: 'schedule',
  }).status, 'FROZEN');
  assert.equal(repairCampaignGate({
    lock, target: 'next', budget, maxAttempts: 2, startPolicy: 'immediate', pricing, trigger: 'workflow_dispatch',
  }).status, 'READY');
});

test('config blockers freeze schedules, while config pushes and manual runs are explicit recovery signals', () => {
  const lock = { campaigns: { next: { status: 'BLOCKED_CONFIG' } } };
  assert.equal(repairCampaignGate({
    lock, target: 'next', budget, maxAttempts: 2, startPolicy: 'immediate', pricing, trigger: 'schedule',
  }).status, 'FROZEN');
  assert.equal(repairCampaignGate({
    lock, target: 'next', budget, maxAttempts: 2, startPolicy: 'immediate', pricing, trigger: 'push',
  }).status, 'READY');
  assert.equal(repairCampaignGate({
    lock, target: 'next', budget, maxAttempts: 2, startPolicy: 'immediate', pricing, trigger: 'workflow_dispatch',
  }).status, 'READY');
});

test('an unmerged state or repair publication freezes before any repair budget is used', () => {
  assert.deepEqual(repairCampaignGate({
    lock: { campaigns: {} }, target: 'next', budget, maxAttempts: 2, startPolicy: 'immediate', pricing,
    pendingPublication: true,
  }), { status: 'FROZEN', reason: 'state-publication-pending', reset: null });
});

test('merging only the blocked lock does not turn the push event into another model run', () => {
  const previous = { status: 'BLOCKED_CONFIG', input_fingerprint: 'same-input' };
  assert.equal(modelInputUnchangedAfterPush(previous, 'same-input', 'push'), true);
  assert.equal(modelInputUnchangedAfterPush(previous, 'changed-route-or-contract', 'push'), false);
  assert.equal(modelInputUnchangedAfterPush(previous, 'same-input', 'workflow_dispatch'), false);
});

test('30 percent convergence edge fires once and every hard limit is explicit', () => {
  const state = budgetState({ usage: { totalTokens: 710 }, estimatedCny: 1, activeMs: 1_000, attemptsUsed: 0 }, budget, 2);
  assert.equal(shouldSendConvergeMessage(state, budget, false), true);
  assert.equal(shouldSendConvergeMessage(state, budget, true), false);
  const exhausted = budgetState({ usage: { totalTokens: 1_001 }, estimatedCny: 11, activeMs: 3_700_000, attemptsUsed: 3 }, budget, 2);
  assert.equal(exhausted.exhausted, true);
  assert.deepEqual(exhausted.exhaustedBy.sort(), ['attempts', 'cny', 'tokens', 'wall']);
});
