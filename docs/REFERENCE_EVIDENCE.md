# 参考证据与当前契约

状态：截至 2026-08-21 的设计输入。版本与接口会继续变化，实施时重新探测。

## 1. 已刷新历史记录得到的插件经验

参考项目的同目录 Codex records 已在本轮重新从真实 `~/.codex` 源同步，共匹配 33 个主任务/子任务记录。原始副本位于本项目 Git 忽略目录，以下只记录可公开的去敏机制。

一个已发布 Web 插件曾执行过这些真实 gate：

- `node --test`：10 项通过；
- `npm pack --dry-run`：确认包名、版本、文件清单和零 bundled dependency；
- fresh 临时 `DSH_HOME`：安装插件、`--dump-config` 回读、卸载、再次回读确认消失；
- 真实 `dsh web --host 127.0.0.1 --port 0`；
- HTTP 回读首页以及 `/plugins/<package>/client.js` 插件模块；
- 最终再从 NPM registry 安装，而不是只安装本地 tarball。

记录里最有价值的失败是：最初 add/dump/remove 都成功，真实 Web 启动却停在 `waiting for service: httpServer`。官方契约已经改成 `WebServer` / `webServer`；修复后真实 Web 与插件模块路由才通过。同一轮还处理了 `ui-slash` / `ctx.slash` 到 `ui-input-trigger` / `ctx.inputTriggers` 的改名。

结论：兼容自动化至少需要“仓库测试 + profile 组合 + 真实启动 + 插件消费面”四层，任一层都不能代表其余层。

## 2. 2026-08-21 NPM 现场探测

本轮实际执行：

```bash
npm view @deepseek-ai/dsh version dist-tags time --json
```

观测结果：

- `latest` -> `0.1.0-rc.7`
- `next` -> `0.1.1-rc.1`
- registry 中还存在发布时间更晚但未被 `latest` 指向的 `0.1.0-rc.8`

这直接说明监测器必须按 channel 的 dist-tag 解析 `npx` 行为，不能简单选择 semver 最大版本。

## 3. 当前官方契约

当前官方文档说明：

- `npx @deepseek-ai/dsh web` 是公开 Web 入口，项目仍处 developer preview，明确可能有 breaking changes。
- `dsh plugin --profile <name> add <package>` 在 profile 目录中管理外部依赖；带 `dsh.bundle` 声明的包进入 bundle layer。
- `dsh --profile <name> --dump-config` 只组合并输出配置，不启动插件。
- `dsh web` 是 `--profile web` 的别名；真实生产 Web 仍需要完整构建产物。
- `DSH_HOME` 决定 profile 与配置根，可用于每次运行隔离。
- 当前 Agent/SDK 契约支持 follow-up 与 steering；steering 在运行中会尽量进入最近的 step 边界。
- session log 中有 provider usage；官方 token meter 的语义会去重流式 usage 与最终 assistant message。

官方来源：

- [DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness)
- [插件发布与 profile 安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [DSH CLI 行为参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [核心 Agent 与 inbox 契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)
- [Token usage 持久化设计](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/implemented/architecture/2026-07-29-projected-token-usage-and-request-context.md)

## 4. GitHub Actions 约束

当前 GitHub 官方契约可作为防循环的一层：使用仓库 `GITHUB_TOKEN` 触发的大多数事件不会创建新的 workflow run。但 `workflow_dispatch`、`repository_dispatch` 以及部分自动 PR 场景存在例外，所以仍需 event key、origin guard、确定分支和最大尝试等自有门。

官方来源：

- [GITHUB_TOKEN 与递归运行](https://docs.github.com/en/actions/concepts/security/github_token)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Workflow syntax 与 timeout](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
