import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadConfig } from './config.js';
import { objectHash } from './hash.js';
import { GuardianError } from './errors.js';
import { runCommand } from './process.js';

const NOTIFIABLE = new Set(['WAITING_FOR_PRICE', 'CONVERGE_30', 'PASS', 'BLOCKED', 'BLOCKED_EXTERNAL', 'SUPERSEDED']);
const STATUS_TEXT = Object.freeze({
  WAITING_FOR_PRICE: '等待低价时段',
  CONVERGE_30: '预算仅剩 30%，已提醒 DSH 尽快收敛',
  PASS: '兼容验证通过',
  BLOCKED: '兼容维修已阻塞',
  BLOCKED_EXTERNAL: '外部服务暂不可用',
  SUPERSEDED: '已被更新 DSH 版本取代',
});

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
  return `## ${STATUS_TEXT[event.status] ?? event.status}\n\n- 目标 DSH：\`${event.target}\`\n- 事件 ID：\`${event.id}\`${event.runUrl ? `\n- 运行报告：${event.runUrl}` : ''}${event.error ? `\n- 错误：\`${event.error.code}\` — ${event.error.message}` : ''}\n\n> 同一事件只通知一次；定时 NOOP 不发通知。`;
}

async function campaignIssue(event, env) {
  const title = `[DSH Guardian] DSH ${event.target} 兼容性维护`;
  const list = JSON.parse((await runCommand('gh', ['issue', 'list', '--state', 'all', '--search', `${title} in:title`, '--json', 'number,title,url'], {
    timeoutMs: 60_000, env,
  })).stdout || '[]');
  const found = list.find(item => item.title === title);
  if (found) return found;
  const url = (await runCommand('gh', ['issue', 'create', '--title', title, '--body', `# 🛡️ DSH ${event.target} 兼容性维护\n\n这个 Issue 由 Guardian 用于保存该版本的去重状态变化。详细机械证据见每条消息里的 Actions 链接。\n\n> 不保存 API Key、完整模型对话或本机私有路径。`], {
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
      text: `DSH Guardian：${STATUS_TEXT[event.status] ?? event.status}\n目标 DSH：${event.target}${event.runUrl ? `\n报告：${event.runUrl}` : ''}`,
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
      await runCommand('gh', ['issue', 'comment', String(issue.number), '--body', `${marker}\n${eventText(event)}\n\n已投递渠道：\`${adapter}\``], {
        timeoutMs: 60_000, env: ghEnv,
      });
      eventAdapters.push(adapter);
    }
    delivered.push({ event, adapters: eventAdapters, issueUrl: issue.url });
  }
  return { status: events.length > 0 ? 'NOTIFIED' : 'NOOP', events: delivered };
}
