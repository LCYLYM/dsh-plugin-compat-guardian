import assert from 'node:assert/strict';
import test from 'node:test';
import { runBudgetedCommand } from '../lib/bounded-model.js';

const settings = {
  sessionsRoot: 'not-read-by-injected-reader', previousUsage: { inputTokens: 10 },
  cost: () => ({ amount: null }), activeMsBefore: 0, attemptsUsed: 1, maxAttempts: 2,
  limits: { max_tokens: 100, max_cny: 3, max_wall_minutes: 1 }, intervalMs: 10,
};
const usage = inputTokens => ({ inputTokens, totalTokens: inputTokens });

test('live reported budget exhaustion terminates the real command rather than waiting for the whole round', async () => {
  let reads = 0;
  let starts = 0;
  await assert.rejects(() => runBudgetedCommand(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5_000 }, {
      ...settings, readUsage: async () => usage(++reads > 1 ? 95 : 0), onStart: () => starts++,
    }), error => {
    assert.equal(error.code, 'BUDGET_EXHAUSTED');
    assert.equal(error.details.result.aborted, true);
    assert.equal(error.details.result.timedOut, false);
    assert.ok(error.details.result.durationMs < 2_000);
    return true;
  });
  assert.equal(starts, 1);
});

test('an already exhausted ledger starts no model command', async () => {
  let starts = 0;
  await assert.rejects(() => runBudgetedCommand(process.execPath, ['-e', 'process.exit(99)'], {}, {
    ...settings, readUsage: async () => usage(95), onStart: () => starts++,
  }), { code: 'BUDGET_EXHAUSTED' });
  assert.equal(starts, 0);
});

test('ledger read failure stops a running command without misclassifying provider timeout', async () => {
  let reads = 0;
  await assert.rejects(() => runBudgetedCommand(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5_000 }, {
      ...settings, readUsage: async () => { if (++reads > 1) throw new Error('private ledger path'); return usage(0); },
    }), error => {
    assert.equal(error.code, 'BUDGET_MONITOR_UNAVAILABLE');
    assert.equal(error.details.result.aborted, true);
    assert.doesNotMatch(error.message, /private ledger path/);
    return true;
  });
});

test('wall exhaustion is a Guardian budget stop even with no provider usage', async () => {
  await assert.rejects(() => runBudgetedCommand(process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 5_000 }, {
      ...settings, limits: { ...settings.limits, max_wall_minutes: 0.001 }, readUsage: async () => usage(0),
    }), error => {
    assert.equal(error.code, 'BUDGET_EXHAUSTED');
    assert.ok(error.details.state.exhaustedBy.includes('wall'));
    return true;
  });
});

test('short successful commands still receive the final budget oracle', async () => {
  let reads = 0;
  await assert.rejects(() => runBudgetedCommand(process.execPath, ['-e', 'process.exit(0)'], {}, {
    ...settings, intervalMs: 10_000, readUsage: async () => usage(++reads > 1 ? 95 : 0),
  }), { code: 'BUDGET_EXHAUSTED' });
  const result = await runBudgetedCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], {}, {
    ...settings, readUsage: async () => usage(5),
  });
  assert.equal(result.stdout, 'ok');
});
