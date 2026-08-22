import { priceBand } from './budget.js';

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];

export function zeroUsage() {
  return Object.fromEntries(USAGE_FIELDS.map(field => [field, 0]));
}

export function addUsage(left = {}, right = {}) {
  const usage = {};
  for (const field of USAGE_FIELDS) usage[field] = Number(left[field] ?? 0) + Number(right[field] ?? 0);
  usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  usage.sessionFiles = Number(left.sessionFiles ?? 0) + Number(right.sessionFiles ?? 0);
  return usage;
}

export function limitsIncreased(previousLimits = {}, currentLimits = {}) {
  return Number(currentLimits.max_tokens ?? 0) > Number(previousLimits.max_tokens ?? 0)
    || Number(currentLimits.max_cny ?? 0) > Number(previousLimits.max_cny ?? 0)
    || Number(currentLimits.max_wall_minutes ?? 0) > Number(previousLimits.max_wall_minutes ?? 0)
    || Number(currentLimits.max_attempts ?? 0) > Number(previousLimits.max_attempts ?? 0);
}

export function explicitReset(lock, campaign, budget, maxAttempts) {
  if (/^[yY]$/.test(String(lock?.resetBudget ?? 'N'))) return 'reset-budget';
  if (limitsIncreased(campaign?.limits, { ...budget, max_attempts: maxAttempts, maxAttempts })) return 'increased-budget';
  return null;
}

export function campaignEpoch(campaign, reset) {
  if (reset !== 'reset-budget') return structuredClone(campaign ?? {});
  const previous = structuredClone(campaign ?? {});
  const history = [...(previous.history ?? [])];
  if (Object.keys(previous).length > 0) {
    history.push({
      epoch: Number(previous.epoch ?? 1),
      status: previous.status ?? 'UNKNOWN',
      usage: previous.usage ?? zeroUsage(),
      estimated_cny: previous.estimated_cny ?? null,
      active_ms: Number(previous.active_ms ?? 0),
      attempts_used: Number(previous.attempts_used ?? 0),
      limits: previous.limits ?? {},
      finished_at: previous.finished_at ?? null,
    });
  }
  return {
    epoch: Number(previous.epoch ?? 1) + 1,
    history,
    lifetime_usage: addUsage(previous.lifetime_usage, previous.usage),
    lifetime_active_ms: Number(previous.lifetime_active_ms ?? 0) + Number(previous.active_ms ?? 0),
    lifetime_attempts: Number(previous.lifetime_attempts ?? 0) + Number(previous.attempts_used ?? 0),
    usage: zeroUsage(),
    active_ms: 0,
    attempts_used: 0,
    automatic_repair_used: false,
    converge_message_sent: false,
  };
}

export function repairCampaignGate({
  lock,
  target,
  budget,
  maxAttempts,
  startPolicy,
  manualPriceOverride = false,
  pricing,
  now = new Date(),
  pendingPublication = false,
  trigger = 'schedule',
}) {
  const campaign = lock?.campaigns?.[target];
  if (pendingPublication) return { status: 'FROZEN', reason: 'state-publication-pending', reset: null };
  if (campaign?.status === 'BLOCKED_EXTERNAL' && trigger !== 'workflow_dispatch') {
    return { status: 'FROZEN', reason: 'external-recovery-signal-required', reset: null };
  }
  const exhausted = campaign?.status === 'BLOCKED'
    || campaign?.automatic_repair_used === true
    || Number(campaign?.attempts_used ?? 0) >= maxAttempts;
  const reset = exhausted ? explicitReset(lock, campaign, budget, maxAttempts) : null;
  if (exhausted && reset === null) return { status: 'FROZEN', reason: 'explicit-reset-required', reset: null };
  if (startPolicy === 'low-price-window' && !manualPriceOverride && priceBand(pricing, now) !== 'low_price') {
    return { status: 'WAITING_FOR_PRICE', reason: 'peak-price-window', reset };
  }
  return { status: 'READY', reason: reset ?? 'new-campaign', reset };
}

export function budgetState({ usage = {}, estimatedCny, activeMs = 0, attemptsUsed = 0 }, budget, maxAttempts) {
  const cnyKnown = Number.isFinite(estimatedCny);
  const consumed = {
    tokens: Number(usage.totalTokens ?? 0),
    cny: cnyKnown ? Number(estimatedCny) : null,
    wallMinutes: Number(activeMs ?? 0) / 60_000,
    attempts: Number(attemptsUsed ?? 0),
  };
  const ratios = {
    tokens: budget.max_tokens > 0 ? consumed.tokens / budget.max_tokens : 1,
    cny: cnyKnown ? (budget.max_cny > 0 ? consumed.cny / budget.max_cny : 1) : null,
    wall: budget.max_wall_minutes > 0 ? consumed.wallMinutes / budget.max_wall_minutes : 1,
    attempts: maxAttempts > 0 ? consumed.attempts / maxAttempts : 1,
  };
  const exhaustedBy = Object.entries(ratios)
    .filter(([, ratio]) => ratio !== null)
    .filter(([name, ratio]) => name === 'attempts' ? consumed.attempts > maxAttempts : ratio >= 1)
    .map(([name]) => name);
  return {
    consumed,
    ratios,
    remainingRatio: Math.max(0, 1 - Math.max(...Object.values(ratios).filter(value => value !== null))),
    exhausted: exhaustedBy.length > 0,
    exhaustedBy,
  };
}

export function shouldSendConvergeMessage(state, budget, alreadySent = false) {
  return budget.converge_message_enabled === true
    && !alreadySent
    && !state.exhausted
    && state.remainingRatio <= budget.converge_remaining_ratio;
}

export function recordCampaign(lock, target, update) {
  const next = structuredClone(lock ?? { schema: 1, resetBudget: 'N', verified: null, campaigns: {} });
  next.schema = 1;
  next.resetBudget = 'N';
  next.campaigns ??= {};
  next.campaigns[target] = { ...(next.campaigns[target] ?? {}), ...update };
  return next;
}
