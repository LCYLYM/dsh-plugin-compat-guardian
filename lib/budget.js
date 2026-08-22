import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

function emptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
  };
}

function usageSample(event) {
  const usage = event?.type === 'assistant/chunk' && event.data?.chunk?.type === 'usage'
    ? event.data.chunk.usage
    : event?.type === 'assistant/message'
      ? event.data?.usage
      : undefined;
  if (usage === undefined || !Number.isInteger(event.data?.turn) || !Number.isInteger(event.data?.step)) return undefined;
  return { turn: event.data.turn, step: event.data.step, usage };
}

export function projectTokenUsage(events) {
  const totals = emptyUsage();
  const lastByStep = new Map();
  for (const event of events) {
    const sample = usageSample(event);
    if (sample === undefined) continue;
    const key = `${sample.turn}:${sample.step}`;
    const previous = lastByStep.get(key) ?? emptyUsage();
    const current = {
      inputTokens: Number(sample.usage.inputTokens ?? 0),
      outputTokens: Number(sample.usage.outputTokens ?? 0),
      cacheReadTokens: Number(sample.usage.cacheReadTokens ?? 0),
      cacheWriteTokens: Number(sample.usage.cacheWriteTokens ?? 0),
      reasoningTokens: Number(sample.usage.reasoningTokens ?? 0),
    };
    for (const field of Object.keys(totals)) totals[field] += current[field] - previous[field];
    lastByStep.set(key, current);
  }
  return totals;
}

async function jsonlFiles(root) {
  const files = [];
  const visit = async directory => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
    }
  };
  await visit(root);
  return files.sort();
}

export async function readDshTokenUsage(sessionsRoot) {
  const totals = emptyUsage();
  let files = 0;
  for (const path of await jsonlFiles(sessionsRoot)) {
    const events = [];
    for (const line of (await readFile(path, 'utf8')).split('\n')) {
      if (line.trim() === '') continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        // An interrupted final line is not a provider usage sample.
      }
    }
    const usage = projectTokenUsage(events);
    for (const field of Object.keys(totals)) totals[field] += usage[field];
    files += 1;
  }
  return {
    ...totals,
    totalTokens: totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens,
    sessionFiles: files,
  };
}

export function priceBand(pricing, date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: pricing.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const minute = formatter.formatToParts(date).reduce((value, part) => {
    if (part.type === 'hour') return value + Number(part.value) * 60;
    if (part.type === 'minute') return value + Number(part.value);
    return value;
  }, 0);
  const peak = pricing.peak_windows.some(window => {
    const [startHour, startMinute] = window.start.split(':').map(Number);
    const [endHour, endMinute] = window.end.split(':').map(Number);
    return minute >= startHour * 60 + startMinute && minute < endHour * 60 + endMinute;
  });
  return peak ? 'peak' : 'low_price';
}

export function estimateCny(usage, pricing, date = new Date()) {
  const band = priceBand(pricing, date);
  const rates = pricing.rates[band];
  const amount = (
    (usage.inputTokens + usage.cacheWriteTokens) * rates.input_cache_miss
    + usage.cacheReadTokens * rates.input_cache_hit
    + usage.outputTokens * rates.output
  ) / 1_000_000;
  return { amount: Number(amount.toFixed(6)), band, revision: pricing.revision };
}
