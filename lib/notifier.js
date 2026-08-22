import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from './config.js';
import { objectHash } from './hash.js';
import { GuardianError } from './errors.js';
import { runCommand } from './process.js';

const NOTIFIABLE = new Set(['WAITING_FOR_PRICE', 'CONVERGE_30', 'PASS', 'BLOCKED', 'BLOCKED_EXTERNAL', 'SUPERSEDED']);

export function notificationEvent(report, status = report.status) {
  const target = report.candidate?.version ?? 'unknown';
  const epoch = report.campaign?.epoch ?? report.budget?.epoch ?? 1;
  return {
    id: objectHash({ repository: process.env.GITHUB_REPOSITORY ?? 'local', target, epoch, status }).slice(0, 20),
    status,
    target,
    epoch,
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    error: report.error ? { code: report.error.code, message: report.error.message } : null,
  };
}

async function postJson(url, payload, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new GuardianError('NOTIFICATION_FAILED', `notification gateway returned HTTP ${response.status}`);
}

function enabled(value) {
  return value === true || value?.enabled === true;
}

export function notificationMarker(event, adapter) {
  return `<!-- dsh-guardian-event:${event.id}:${adapter} -->`;
}

function eventText(event) {
  return `DSH Guardian ${event.status}: ${event.target}${event.runUrl ? `\n\nRun: ${event.runUrl}` : ''}${event.error ? `\n\nError: ${event.error.code}: ${event.error.message}` : ''}`;
}

async function campaignIssue(event, env) {
  const title = `[DSH Guardian] campaign ${event.target}`;
  const list = JSON.parse((await runCommand('gh', ['issue', 'list', '--state', 'all', '--search', `${title} in:title`, '--json', 'number,title,url'], {
    timeoutMs: 60_000, env,
  })).stdout || '[]');
  const found = list.find(item => item.title === title);
  if (found) return found;
  const url = (await runCommand('gh', ['issue', 'create', '--title', title, '--body', `Compatibility activity for DSH ${event.target}.`], {
    timeoutMs: 60_000, env,
  })).stdout.trim();
  return { number: Number(url.split('/').at(-1)), title, url };
}

export async function sendConfiguredAdapters(event, config, env = process.env) {
  const delivered = [];
  if (enabled(config.notifications.email)) {
    const url = env.GUARDIAN_EMAIL_GATEWAY_URL;
    if (!url) throw new GuardianError('NOTIFICATION_CONFIG_MISSING', 'email enabled but GUARDIAN_EMAIL_GATEWAY_URL is missing');
    await postJson(url, { channel: 'email', event });
    delivered.push('email');
  }
  if (enabled(config.notifications.telegram)) {
    const token = env.GUARDIAN_TELEGRAM_BOT_TOKEN;
    const chatId = env.GUARDIAN_TELEGRAM_CHAT_ID;
    if (!token || !chatId) throw new GuardianError('NOTIFICATION_CONFIG_MISSING', 'Telegram enabled but bot token or chat id is missing');
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: `DSH Guardian ${event.status}: ${event.target}${event.runUrl ? `\n${event.runUrl}` : ''}`,
      disable_web_page_preview: true,
    });
    delivered.push('telegram');
  }
  if (enabled(config.notifications.webhook)) {
    const url = env.GUARDIAN_WEBHOOK_URL;
    if (!url) throw new GuardianError('NOTIFICATION_CONFIG_MISSING', 'webhook enabled but GUARDIAN_WEBHOOK_URL is missing');
    await postJson(url, event);
    delivered.push('webhook');
  }
  return delivered;
}

export async function notifyFromReport(options) {
  const repoPath = resolve(options.repoPath);
  const report = JSON.parse(await readFile(resolve(options.reportPath), 'utf8'));
  const { config } = await loadConfig(repoPath);
  const statuses = [];
  if (NOTIFIABLE.has(report.status)) statuses.push(report.status);
  if (report.budget?.state && report.budget.state.remainingRatio <= config.budget.converge_remaining_ratio
    && report.campaign?.converge_message_sent === true) statuses.push('CONVERGE_30');
  const events = statuses.map(status => notificationEvent(report, status));
  const delivered = [];
  const ghEnv = { ...process.env, GH_TOKEN: process.env.GH_TOKEN };
  for (const event of events) {
    if (!ghEnv.GH_TOKEN || !process.env.GITHUB_REPOSITORY) {
      delivered.push({ event, adapters: await sendConfiguredAdapters(event, config) });
      continue;
    }
    const issue = await campaignIssue(event, ghEnv);
    const comments = JSON.parse((await runCommand('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/issues/${issue.number}/comments`, '--paginate'], {
      timeoutMs: 60_000, env: ghEnv,
    })).stdout || '[]');
    const bodies = comments.map(comment => comment.body ?? '').join('\n');
    const eventAdapters = [];
    for (const adapter of ['github', 'email', 'telegram', 'webhook']) {
      if (adapter !== 'github' && !enabled(config.notifications[adapter])) continue;
      const marker = notificationMarker(event, adapter);
      if (bodies.includes(marker)) continue;
      if (adapter !== 'github') {
        const adapterConfig = { ...config, notifications: { email: false, telegram: false, webhook: false, [adapter]: config.notifications[adapter] } };
        await sendConfiguredAdapters(event, adapterConfig);
      }
      await runCommand('gh', ['issue', 'comment', String(issue.number), '--body', `${marker}\n${eventText(event)}\n\nDelivered adapter: ${adapter}`], {
        timeoutMs: 60_000, env: ghEnv,
      });
      eventAdapters.push(adapter);
    }
    delivered.push({ event, adapters: eventAdapters, issueUrl: issue.url });
  }
  return { status: events.length > 0 ? 'NOTIFIED' : 'NOOP', events: delivered };
}
