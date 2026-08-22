import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

function duration(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function fenced(value) {
  const text = String(value ?? '').trim();
  return text === '' ? '_无_' : `\n\`\`\`text\n${text}\n\`\`\``;
}

const STATUS_TEXT = Object.freeze({
  PASS: '✅ 已通过',
  NOOP: '💤 无需处理',
  BLOCKED: '❌ 已阻塞',
  BLOCKED_EXTERNAL: '⏸️ 外部服务暂不可用',
  BLOCKED_CONTRACT: '⚠️ 需要人工审核测试契约',
  FROZEN: '🔒 已冻结',
  WAITING_FOR_PRICE: '🕒 等待低价时段',
  WAITING_FOR_GITHUB_APPROVAL: '👀 等待 GitHub 批准',
  SUPERSEDED: '⏭️ 已被更新版本取代',
});

const STEP_TEXT = Object.freeze({
  'resolve-runtime': '解析 Node 与包管理器',
  'read-source-commit': '读取源码提交',
  'check-clean-source': '检查源码干净度',
  'read-tracked-source-tree': '计算源码树指纹',
  'resolve-registry-snapshot': '冻结 NPM 候选版本',
  'install-candidate-dsh': '隔离安装候选 DSH',
  'confirm-candidate-version': '确认 DSH 精确版本',
  'install-repository-dependencies': '安装插件依赖',
  'discover-build-inputs': '发现构建源码',
  'discover-build-outputs': '发现跟踪构建产物',
  'rebuild-tracked-output': '干净重建产物',
  'compare-rebuilt-output': '比对重建产物',
  'pack-plugin': '打包真实插件',
  'install-plugin-into-profile': '安装插件到隔离 profile',
  'dump-profile-with-plugin': '确认插件已激活',
  'start-real-dsh-web': '启动真实 dsh web',
  'plugin-specific-smoke': '执行插件专属 smoke',
  'stop-real-dsh-web': '停止 dsh web',
  'stop-real-dsh-web-after-failure': '失败后清理 dsh web',
  'remove-plugin-from-profile': '从 profile 卸载插件',
  'dump-profile-after-remove': '确认卸载无残留',
  'install-repair-dsh': '安装固定维修 DSH',
  'run-repair-dsh': '运行 DSH 自动维修',
  'run-repair-dsh-converge': '收敛并完成维修',
  'guardian-evaluation': 'Guardian 归纳失败原因',
});

function statusText(status) {
  return STATUS_TEXT[status] ?? `ℹ️ ${status ?? '未知'}`;
}

function nextAction(report) {
  if (report.status === 'PASS') return report.kind === 'repair'
    ? '修复已通过原始 verifier，可以审核并合并本 PR。'
    : '候选 DSH 已通过兼容测试，可以合并本次 lock 更新。';
  if (report.status === 'NOOP') return '相同代码、DSH 快照和测试契约已验证，不用操作，也不会调用模型。';
  if (report.status === 'WAITING_FOR_PRICE') return '机械测试已完成，修复将在低价时段继续；也可手工立即运行。';
  if (report.status === 'BLOCKED_EXTERNAL') return '代码尚未判定为不兼容。外部服务恢复后手工重跑，schedule 不会循环烧额度。';
  if (report.status === 'BLOCKED_CONTRACT') return '只审核独立的 contract PR；合并后会全量复测，已消耗预算不会重置。';
  if (report.status === 'FROZEN') return '本版本已停止自动继续。只有提高额度或把 `resetBudget` 从 `N` 改为 `Y` 后才会再修一次。';
  if (report.error?.code === 'ONBOARDING_BLOCKED') return '这是首次接入：插件连固定的参考 DSH 都没通过，因此不能把它当成“升级导致的回归”自动修。先处理下方首个失败检查，再重新建立基线。';
  if (report.error?.code === 'MODEL_CREDENTIAL_MISSING') return '机械验证已停下，但缺少维修模型凭据。在仓库 Secrets 中添加 `DEEPSEEK_API_KEY` 后手工重跑。';
  if (report.error?.code === 'BUDGET_EXHAUSTED') return '本版本的维修额度已用完。提高额度，或把 lock 中的 `resetBudget` 从 `N` 改为 `Y` 并提交，才会再维修一次。';
  return '查看下方“为什么停下”和首个失败检查；Guardian 不会在未通过 verifier 时发布修复。';
}

export function renderMarkdown(report) {
  const passed = (report.steps ?? []).filter(step => step.ok).length;
  const failed = (report.steps ?? []).filter(step => !step.ok).length;
  const totalDuration = report.startedAt && report.finishedAt
    ? Math.max(0, Date.parse(report.finishedAt) - Date.parse(report.startedAt))
    : null;
  const lines = [
    '# 🛡️ DSH 插件兼容性报告',
    '',
    `> ## ${statusText(report.status)}`,
    `> ${nextAction(report)}`,
    '',
    '## 📌 一眼看懂',
    '',
    '| 项目 | 结果 |',
    '| --- | --- |',
    `| 目标 DSH | \`${report.candidate?.package ?? '@deepseek-ai/dsh'}@${report.candidate?.version ?? '未知'}\` |`,
    `| 插件 | \`${report.plugin?.name ?? report.plugin?.package ?? '未识别'}${report.plugin?.version ? `@${report.plugin.version}` : ''}\` |`,
    `| 仓库提交 | \`${report.source?.commit?.slice(0, 12) ?? '未知'}\` |`,
    `| 检查 | ${passed} 项通过 / ${failed} 项失败 |`,
    `| 总用时 | ${totalDuration === null || Number.isNaN(totalDuration) ? '未记录' : duration(totalDuration)} |`,
    `| 安装图指纹 | \`${report.candidate?.graphDigest?.slice(0, 16) ?? '未生成'}…\` |`,
    `| 插件包指纹 | \`${report.plugin?.tarballSha256?.slice(0, 16) ?? '未打包'}…\` |`,
  ];
  if (report.error) {
    lines.push('', '## ❌ 为什么停下', '', `- 错误代码：\`${report.error.code}\``, `- 说明：${report.error.message}`);
  }
  if (report.budget) {
    const usage = report.budget.usage ?? {};
    const limits = report.budget.limits ?? {};
    const numberText = value => Number(value ?? 0).toLocaleString('zh-CN');
    const cny = report.budget.estimatedCny.amount === null
      ? `未知（当前 route 不匹配 ${report.budget.estimatedCny.revision} 价格表）`
      : `${report.budget.estimatedCny.amount} CNY（${report.budget.estimatedCny.band} / ${report.budget.estimatedCny.revision}）`;
    lines.push(
      '',
      '## 💰 预算与用量',
      '',
      '| 指标 | 已用 / 上限 |',
      '| --- | ---: |',
      `| Token | ${numberText(usage.totalTokens)} / ${numberText(limits.max_tokens)} |`,
      `| 输入 / 缓存命中 / 输出 | ${numberText(usage.inputTokens)} / ${numberText(usage.cacheReadTokens)} / ${numberText(usage.outputTokens)} |`,
      `| 估算费用 | ${cny} / ${limits.max_cny ?? '未设置'} CNY |`,
      `| 活跃时间上限 | ${limits.max_wall_minutes ?? '未设置'} 分钟 |`,
      '',
      '> 费用是按 DSH 已报告 usage 估算，不是 DeepSeek 账户账单级实时扣费。',
    );
  }
  if (report.repair) {
    lines.push(
      '',
      '## 🩹 自动修复',
      '',
      `- 维修 DSH：\`${report.repair.dshVersion}\``,
      `- Provider / 模型：\`${report.repair.provider}/${report.repair.model}\``,
      `- 改动文件：${report.repair.changedPaths.map(path => `\`${path}\``).join('、') || '无'}`,
      `- 补丁 SHA-256：\`${report.repair.patchSha256}\``,
    );
    if (report.repair.diffPolicy) {
      lines.push(
        `- 改动规模：${report.repair.diffPolicy.statistics.files} 个文件，+${report.repair.diffPolicy.statistics.additions}/-${report.repair.diffPolicy.statistics.deletions}`,
        `- 交付策略：\`${report.repair.diffPolicy.disposition}\`${report.repair.diffPolicy.forceReview.length ? `（${report.repair.diffPolicy.forceReview.join('；')}）` : ''}`,
      );
    }
    if (report.repair.search) lines.push(`- DeepSeek 搜索：${report.repair.search.calls} 次（${report.repair.search.model}）`);
  }
  lines.push('', '<details>', `<summary><strong>🧪 完整检查明细（${passed}/${(report.steps ?? []).length} 通过）</strong></summary>`, '', '| 检查 | 结果 | 用时 |', '| --- | --- | ---: |');
  for (const step of report.steps ?? []) {
    const label = STEP_TEXT[step.name] ?? (step.name.startsWith('repository-gate-') ? `仓库自带检查 ${step.name.split('-').at(-1)}` : step.name);
    lines.push(`| ${label}<br><sub>\`${step.name}\`</sub> | ${step.ok ? '✅ 通过' : '❌ 失败'} | ${duration(step.durationMs ?? 0)} |`);
  }
  lines.push('', '</details>');
  const firstFailed = (report.steps ?? []).find(step => !step.ok);
  if (firstFailed?.stderr || firstFailed?.stdout) {
    lines.push('', '<details>', '<summary><strong>🧹 去敏后的失败输出</strong></summary>', '');
    if (firstFailed.stdout) lines.push('stdout：', fenced(firstFailed.stdout));
    if (firstFailed.stderr) lines.push('stderr：', fenced(firstFailed.stderr));
    lines.push('', '</details>');
  }
  lines.push(
    '',
    '<details>',
    '<summary><strong>🔎 用于复核的机器指纹</strong></summary>',
    '',
    `- DSH root integrity：\`${report.candidate?.integrity ?? '未生成'}\``,
    `- 安装图 digest：\`${report.candidate?.graphDigest ?? '未生成'}\``,
    `- 插件 tarball SHA-256：\`${report.plugin?.tarballSha256 ?? '未打包'}\``,
    `- Snapshot key：\`${report.snapshotKey ?? '未生成'}\``,
    `- 开始：${report.startedAt ?? '未记录'}`,
    `- 结束：${report.finishedAt ?? '未记录'}`,
    '',
    '</details>',
    '',
    '> 🔐 本报告只保存去敏后的机械证据；不保存 API Key、认证头、完整模型对话或本机私有路径。',
    '',
  );
  return lines.join('\n');
}

export function actionsReportUrl(env = process.env) {
  if (!env.GITHUB_RUN_ID || !env.GITHUB_REPOSITORY) return null;
  return `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

export async function writeReport(report, outputDirectory) {
  const directory = resolve(outputDirectory);
  await mkdir(directory, { recursive: true });
  const markdown = renderMarkdown(report);
  const jsonPath = resolve(directory, 'report.json');
  const markdownPath = resolve(directory, 'report.md');
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
    writeFile(markdownPath, `${markdown}\n`, { mode: 0o600 }),
  ]);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
  return { jsonPath, markdownPath, markdown };
}

export async function readLock(lockPath) {
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    if (lock.schema !== 1) throw new Error('lock schema must be 1');
    return lock;
  } catch (error) {
    if (error?.code === 'ENOENT') return { schema: 1, resetBudget: 'N', verified: null, campaigns: {} };
    throw error;
  }
}

export async function writeLockAtomic(lockPath, lock) {
  await mkdir(dirname(lockPath), { recursive: true });
  const temporary = `${lockPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, lockPath);
}
