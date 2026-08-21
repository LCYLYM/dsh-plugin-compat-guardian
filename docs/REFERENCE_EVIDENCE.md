# 参考证据与当前契约

状态：截至 2026-08-21 的设计输入。DSH 仍快速变化，实施和每次发布前必须重新探测。

## 1. 参考插件的真实兼容经验

本项目前序调研从参考项目的真实 Codex records 中回读了一个已发布 Web 插件的维修过程。原始记录仅留在 Git 忽略的本地目录；仓库只保存以下去敏机制：

- `node --test`：10 项通过；
- `npm pack --dry-run`：检查包名、版本、文件清单和 bundled dependency；
- fresh 临时 `DSH_HOME`：安装插件、`--dump-config` 回读、卸载、再次回读；
- 真实 `dsh web --host 127.0.0.1 --port 0`；
- HTTP 回读首页与 `/plugins/<package>/client.js`；
- 最后再从 NPM registry 安装，而不是只证明本地 tarball。

最有价值的失败是：add/dump/remove 都成功，但真实 Web 启动停在 `waiting for service: httpServer`。DSH 契约已改为 `WebServer` / `webServer`；修复后真实 Web 和插件模块路由才通过。同轮还处理了 `ui-slash` / `ctx.slash` 到 `ui-input-trigger` / `ctx.inputTriggers` 的改名。

结论：仓库测试、profile 组合、真实启动和插件消费面是四层不同证据，不能互相替代。

## 2. 2026-08-21 NPM 现场探测

实际执行：

```bash
npm view @deepseek-ai/dsh dist-tags version time --json
```

最新回读：

- `latest` -> `0.1.1-rc.1`
- `next` -> `0.1.1-rc.1`
- `0.1.1-rc.1` 发布时间 -> `2026-08-21T06:49:18.639Z`

同一天较早探测时，`latest` 仍是 `0.1.0-rc.7`，而 registry 已有未被 `latest` 指向的 `0.1.0-rc.8` 和 `next=0.1.1-rc.1`。这同时证明：

1. 监控必须遵循 dist-tag，不能选“semver 最大版本”来冒充 `npx` 默认行为。
2. latest 会在一次长维修中变化，所以旧任务必须 `SUPERSEDED` 并最终收敛到最新。

根包 `@deepseek-ai/dsh@0.1.1-rc.1` 对大量内部包使用 `^0.1.1-rc.1` 范围，其中包括 `@deepseek-ai/dsh-llm-deepseek`。说人话就是：DSH 显示的版本号可能没变，但今天全新安装到的内部组件与前几天不同。同一次测试会用 package lock 固定依赖；以后的巡检则重新模拟今天的全新安装。实际安装内容变化时，会重跑仓库测试、插件 pack/install、dump-config、真实启动和 smoke 断言；这一步运行 Actions，但还不调用 repair model。已经用过自动维修时，测试失败后仍需用户 reset 才能再次花模型额度。

## 3. 视觉模型在当前发布制品中真实存在

本轮同时检查了官方仓库当前提交 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 和 NPM tarball：

```bash
npm pack @deepseek-ai/dsh-llm-deepseek@0.1.1-rc.1
tar -xOf <archive> package/lib/index.js
```

发布包的默认 catalog 已包含：

```text
id: deepseek-v4-flash-vision-exp
name: DeepSeek-V4-Flash-Vision-Exp
inputModalities: [text, image]
```

所以 `0.1.1-rc.1` + 该模型支持视觉不是只根据 `master` 猜测；当前已发布子包中就有对应适配器。官方 DSH 源码还记录图片压缩、Files API 上传、内联回退、持久附件、上限与错误处理。

官方来源：

- [DSH DeepSeek adapter 固定提交源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm-deepseek/src/index.ts)
- [DSH DeepSeek adapter 中文说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm-deepseek/README.zh.md)
- [NPM `@deepseek-ai/dsh` 0.1.1-rc.1](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.1-rc.1)

## 4. DeepSeek 官方视觉与价格契约

DeepSeek 当前官方文档明确：

- `deepseek-v4-flash-vision-exp` 支持文本和图片；格式为 JPEG、PNG、GIF、WebP。
- 图片可以通过 base64 data URL、外部 URL 或 Files API `file_id` 输入。
- 每张图片按尺寸折算为输入 token，单图上限 384 token，并与文本一起计费。
- 该模型支持 Tool Calls、Responses API 和 Anthropic API。
- 当前 CNY 费率与 V4 Flash 同档。

2026-08-21 页面显示的默认价格快照（元/百万 token）：

| 时段 | 缓存命中输入 | 缓存未命中输入 | 输出 |
| --- | ---: | ---: | ---: |
| 空闲 | 0.05 | 1.50 | 4.50 |
| 高峰 | 0.10 | 3.00 | 9.00 |

高峰为北京时间每日 `09:00–12:00`、`14:00–18:00`，其余为空闲时段。官方同时声明价格可能变化，所以 Guardian 只能把这组值作为带 source/revision 的可覆盖默认快照，不能写成永久常量。

官方来源：

- [DeepSeek 图像理解](https://api-docs.deepseek.com/zh-cn/guides/vision/)
- [DeepSeek 模型与价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

## 5. 视觉与搜索是两条调用

官方 DSH 的 `@deepseek-ai/dsh-web-search-deepseek`：

- 通过 Anthropic 兼容 `POST {baseURL}/messages` 发起完整模型调用；
- 使用原生 `web_search_20250305` server tool；
- 复用 `DEEPSEEK_API_KEY`，但搜索 base URL 默认是 `https://api.deepseek.com/anthropic/v1`，不自动复用 chat-completions 的 `DEEPSEEK_BASE_URL`；
- 返回结构化 `web_search_tool_result`，不从模型文本里猜 URL；
- 默认搜索模型仍是普通 `deepseek-v4-flash`，但配置项允许覆盖 model。

因此产品默认可以把 repair 和搜索都配置为 `deepseek-v4-flash-vision-exp`，但必须运行真实搜索 probe；“模型支持视觉”本身不能证明 native web search 已工作，也不能把搜索费用算进主会话一次调用。

当前源码只持久化无密钥搜索请求，没有把 Anthropic 响应的 usage 映射给消费方。V1 接受这点小额误差：只记录搜索调用次数，不做复杂预留；总 token/CNY 明确标注只覆盖 DSH 已暴露的 usage。账单级硬上限不属于本地估算承诺，应由 provider 侧额度负责。

官方来源：

- [DSH DeepSeek Search 中文说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/web/web-search-deepseek/README.zh.md)
- [DSH DeepSeek Search provider 源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/web/web-search-deepseek/src/provider.ts)

## 6. 其他当前 DSH 契约

- `npx @deepseek-ai/dsh web` 是公开 Web 入口，项目仍处 developer preview，可能有 breaking changes。
- `dsh plugin --profile <name> add <package>` 在 profile 中管理外部依赖；带 `dsh.bundle` 声明的包进入 bundle layer。
- `dsh --profile <name> --dump-config` 只组合并输出配置，不能替代真实启动。
- `DSH_HOME` 决定 profile 与配置根，可用于每次运行隔离。
- Agent/SDK 支持 steering；消息会尽量在最近 step 边界进入。
- session log 有 provider usage；token meter 会去重流式 usage 和最终 message。

官方来源：

- [DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness)
- [插件发布与 profile 安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [DSH CLI 行为参考](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md)
- [核心 Agent 与 inbox 契约](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/core.md)

## 7. GitHub Actions 约束

- reusable workflow 的 secrets 需要调用方显式传递；job/workflow 应使用最小 `permissions`。
- 仓库 `GITHUB_TOKEN` 触发的大多数事件不会递归创建新 run，但 `workflow_dispatch`、`repository_dispatch` 等有例外，不能作为唯一防循环门。
- concurrency 可以取消同组旧 run，但旧进程仍要在发布前再次确认 current latest。
- scheduled workflow 可能延迟，高负载时可能丢弃；默认分支才是 schedule 定义来源。
- 公开仓库 60 天无活动时，scheduled workflows 可能自动禁用。
- GitHub 当前把公共仓库的标准 GitHub-hosted runner 描述为免费且 unlimited；larger runner、私有仓库、存储、并发和使用政策另算。“不限计费分钟”仍不等于产品可以不设墙钟和循环上限。

官方来源：

- [Reusable workflows](https://docs.github.com/en/actions/how-tos/sharing-automations/reusing-workflows)
- [Workflow permissions 与 `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Events that trigger workflows：schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Choosing the runner for a job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

## 8. 证据强度边界

当前已证明的是设计输入和发布制品静态事实；尚未用真实 API key 执行：

- `0.1.1-rc.1` 中视觉模型的端到端图片请求；
- 将 DeepSeek search provider 的 model 覆盖为视觉模型后的 native search；
- Guardian 自身的预算、调度、修复和 GitHub 发布流程。

这些都保留为 `ACCEPTANCE.md` 中的 open 项；不得因源码存在就提前宣称运行态 PASS。
