import { readDshTokenUsage } from './budget.js';
import { addUsage, budgetState } from './campaign.js';
import { GuardianError } from './errors.js';
import { runCommand } from './process.js';

// Observe the existing native ledger, not raw conversations or a second proxy.
// Usage can arrive after a provider request: this is not a billing hard limit.
export async function runBudgetedCommand(command, args, options, budget) {
  const started = Date.now();
  const controller = new AbortController();
  const readUsage = budget.readUsage ?? readDshTokenUsage;
  const evaluate = async () => {
    let delta;
    try { delta = await readUsage(budget.sessionsRoot); }
    catch { throw new GuardianError('BUDGET_MONITOR_UNAVAILABLE', '无法读取 DSH 已报告用量，不能假定仍有预算。'); }
    if (!Number.isFinite(delta.totalTokens) || delta.totalTokens < 0) {
      throw new GuardianError('BUDGET_MONITOR_UNAVAILABLE', 'DSH 已报告用量无效，不能假定仍有预算。');
    }
    return budgetState({
      usage: addUsage(budget.previousUsage, delta),
      estimatedCny: budget.cost(delta)?.amount,
      activeMs: budget.activeMsBefore + Date.now() - started,
      attemptsUsed: budget.attemptsUsed,
    }, budget.limits, budget.maxAttempts);
  };
  const exhausted = state => new GuardianError('BUDGET_EXHAUSTED',
    `维修运行中已报告用量达到预算，停止模型进程：${state.exhaustedBy.join(', ')}`, { state });
  const initial = await evaluate();
  if (initial.exhausted) throw exhausted(initial);
  let stopped = false;
  let timer;
  let poll;
  let stopError;
  const check = async () => {
    try {
      const state = await evaluate();
      if (!stopped && state.exhausted) stopError = exhausted(state);
    } catch {
      if (!stopped) stopError = new GuardianError('BUDGET_MONITOR_UNAVAILABLE',
        '无法读取 DSH 已报告用量，模型进程已停止；不能假定仍有预算。');
    }
    if (stopped) return;
    if (stopError) controller.abort();
    else timer = setTimeout(() => { poll = check(); }, budget.intervalMs ?? 1_000);
  };
  timer = setTimeout(() => { poll = check(); }, budget.intervalMs ?? 1_000);
  let result;
  let commandError;
  try {
    budget.onStart?.();
    result = await runCommand(command, args, { ...options, abortSignal: controller.signal });
  }
  catch (error) { commandError = error; result = error.result; }
  finally { stopped = true; clearTimeout(timer); await poll; }
  // A short command may finish between polls; retain the final budget oracle.
  if (!stopError) {
    try {
      const final = await evaluate();
      if (final.exhausted) stopError = exhausted(final);
    } catch (error) { stopError = error; }
  }
  if (stopError) {
    stopError.details.result = result;
    throw stopError;
  }
  if (commandError) throw commandError;
  return result;
}
