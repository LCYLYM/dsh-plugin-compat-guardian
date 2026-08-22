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

- `latest` -> `0.1.1-rc.2`
- `next` -> `0.1.1-rc.2`
- `0.1.1-rc.2` 发布时间 -> `2026-08-21T12:42:19.422Z`
- `0.1.1-rc.1` 发布时间 -> `2026-08-21T06:49:18.639Z`

同一天较早探测时，`latest` 仍是 `0.1.0-rc.7`，随后先变成 `0.1.1-rc.1`，又在项目设计期间变成 `0.1.1-rc.2`。这同时证明：

1. 监控必须遵循 dist-tag，不能选“semver 最大版本”来冒充 `npx` 默认行为。
2. latest 会在一次长维修中变化，所以旧任务必须 `SUPERSEDED` 并最终收敛到最新。

根包 `@deepseek-ai/dsh@0.1.1-rc.2` 的 integrity 为 `sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==`，对大量内部包使用 `^0.1.1-rc.2` 范围。说人话就是：DSH 显示的根版本号可能没变，但今天全新安装到的内部组件与前几天不同。同一次测试会用 package lock 固定依赖；以后的巡检则重新模拟今天的全新安装。实际安装内容变化时，会重跑仓库测试、插件 pack/install、dump-config、真实启动和 smoke 断言；这一步运行 Actions，但还不调用 repair model。已经用过自动维修时，测试失败后仍需用户 reset 才能再次花模型额度。

该根包当前 NPM 元数据没有声明 `engines.node`，所以 Guardian 不能从 DSH 包本身推断唯一 Node 版本。真实 fixture 已在 Node `v24.13.1` 通过 10/10 测试；Node 官方当前把 v24 标为 LTS，并计划维护到 2028 年 4 月。因此仓库无版本声明时采用 Node 24 LTS 是可复验默认，而不是声称它是 DSH 官方最低版本。

## 3. 视觉模型在当前发布制品中真实存在

本轮同时检查了官方仓库提交 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 和最新 NPM tarball：

```bash
npm pack @deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2
tar -xOf <archive> package/lib/index.js
```

发布包的默认 catalog 已包含：

```text
id: deepseek-v4-flash-vision-exp
name: DeepSeek-V4-Flash-Vision-Exp
inputModalities: [text, image]
```

所以 `0.1.1-rc.2` + 该模型支持视觉不是只根据 `master` 猜测；当前已发布子包中就有对应适配器。该子包 integrity 为 `sha512-GH9AukC2kozv6Q8/9DDhACHSe7fpTG7o0iWGUEN/m7/qajCJ8abySOFi3N7otdVmolR6Mvz2GZDTn2HdHqkWWg==`。官方 DSH 源码还记录图片压缩、Files API 上传、内联回退、持久附件、上限与错误处理。

官方来源：

- [DSH DeepSeek adapter 固定提交源码](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm-deepseek/src/index.ts)
- [DSH DeepSeek adapter 中文说明](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/llm/llm-deepseek/README.zh.md)
- [NPM `@deepseek-ai/dsh` 0.1.1-rc.2](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.1-rc.2)
- [NPM `@deepseek-ai/dsh-llm-deepseek` 0.1.1-rc.2](https://www.npmjs.com/package/@deepseek-ai/dsh-llm-deepseek/v/0.1.1-rc.2)

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
- 跨仓库 reusable workflow 可以引用 SHA、release tag 或 branch；GitHub 明确把 commit SHA 描述为稳定性与安全性最可靠的选择。完整 commit SHA 是当前唯一不可移动的引用方式，因此插件仓库必须用 SHA 固定 Guardian 引擎。
- 仓库 `GITHUB_TOKEN` 触发的大多数事件不会递归创建新 run，但 `workflow_dispatch`、`repository_dispatch` 等有例外，不能作为唯一防循环门。
- 仓库设置必须显式允许 GitHub Actions 创建/批准 PR；默认值可能是关闭或继承组织策略。
- 使用 `GITHUB_TOKEN` 创建的 PR，其 checks 可能需要有写权限的人批准后才运行。GitHub 官方建议需要无人值守触发时使用 GitHub App 或 PAT；V1 不建设 App，只把细粒度 publisher token 作为 auto-merge 的可选项。
- concurrency 可以取消同组旧 run，但旧进程仍要在发布前再次确认 current latest。
- scheduled workflow 可能延迟，高负载时可能丢弃；默认分支才是 schedule 定义来源。
- 公开仓库 60 天无活动时，scheduled workflows 可能自动禁用。
- GitHub 当前把公共仓库的标准 GitHub-hosted runner 描述为免费且 unlimited；larger runner、私有仓库、存储、并发和使用政策另算。“不限计费分钟”仍不等于产品可以不设墙钟和循环上限。
- GitHub 当前提供稳定的 `ubuntu-24.04` 标准 runner；`setup-node` 原生覆盖 npm、pnpm、yarn 缓存路径。V1 因此固定 Ubuntu 24.04 且只实现这三类包管理器，避免把可变 `ubuntu-latest`、Bun 和 OS matrix 同时引入基线。

官方来源：

- [Reusable workflows](https://docs.github.com/en/actions/how-tos/sharing-automations/reusing-workflows)
- [Secure use reference：pin full-length commit SHA](https://docs.github.com/en/actions/reference/security/secure-use)
- [Workflow permissions 与 `GITHUB_TOKEN`](https://docs.github.com/en/actions/concepts/security/github_token)
- [仓库 Actions 设置：允许创建 PR](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/managing-github-actions-settings-for-a-repository)
- [Workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)
- [Events that trigger workflows：schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Choosing the runner for a job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
- [Dependency caching：setup-node 支持 npm/pnpm/yarn](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)
- [Node.js release schedule](https://nodejs.org/en/about/previous-releases)

## 8. 首个真实样本仓库

已建立公开独立仓库 [`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)：

- 源自公开正式仓库 `LCYLYM/dsh-attachments@028dc1f8dc9c7f963e714013b36adc4f48d88c2a`，保留完整历史，但不是 GitHub fork；
- fixture 当前 `main@17edf22f50760f511533e9c78a989ad61e7f99ea`，本地与远端 SHA 一致；
- Node `v24.13.1` 下 `npm test` 为 10/10 PASS；
- `npm pack --dry-run --json` PASS，仍能生成真实插件 tarball；
- 包名和插件代码未改，仓库元数据指向 fixture，`private: true` 只阻止误发 NPM；
- 中英文 README 均明确它是 Guardian 自动兼容维修的公开测试副本。

样本复制、原有测试和远端发布之外，本地隔离 onboarding/M0 也已运行，证据见下一节。2026-08-22 又完成了公开 GitHub Actions 的 M1/M2 真实链路，见第 11 节。

## 9. 2026-08-21 M0 与真实 provider 运行证据

本地 fixture 隔离分支 `automation/dsh-compat/onboarding@cf77d6e` 已得到下面的真实链路：

```text
@deepseek-ai/dsh@0.1.1-rc.2 exact registry metadata
  -> fresh pnpm candidate installation
  -> fixture 10/10 tests + npm pack
  -> dsh plugin --profile web add <tarball>
  -> dump-config contains dsh-multimedia-webui-input
  -> real dsh web process
  -> GET /community-multimedia-webui-input/v1/health = 200
  -> plugin remove + clean dump
  -> verified lock
  -> lock commit 后 clean rerun = NOOP
```

冻结值：

- root integrity：`sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==`；
- pnpm graph digest：`11cbc898fa8080f58da7dd75abe6f43f1bf6a159f258bd05ce82b20925c80826`；
- plugin tarball SHA-256：`8ae8c0fd48e042a02876123f648d5fafbaf03cbf1266a32d11863ef9fe62dd2d`；
- contract SHA-256：`b53dfdd5afbf0f2c491e34eb6cfd1a3d7fddae5841dda18e008c3b0f9769ad70`；
- snapshot key：`509b98a0fe2f5e87e995413a79de206bb1ca746411b42c343fd7987d2cc5a65d`。

该 PASS 的实际机器是本地 `darwin-arm64` / Node `24.13.1` / npm `11.8.0`，配置目标 runner 才是 `ubuntu-24.04`。所以它证明 orchestrator 和真实 DSH surface，不冒充 GitHub-hosted Ubuntu 已通过。

用户提供凭据后，又用精确 `0.1.1-rc.2` 的 DSH headless profile 做了两个一次性 probe：

1. `deepseek-official/deepseek-v4-flash-vision-exp` 普通调用退出码 0、结果非空；最终 usage 为 input 10,676、output 104、cache-read 0、reasoning 92。
2. 同一模型被同时写入 `agent-default-model` 和 `web-search-deepseek` overlay；真实会话出现 `web/deepseek-search-llm-request`、`tool/call` 和 `tool/result`，请求 `https://api.deepseek.com/anthropic/v1/messages`，使用 `web_search_20250305` 并返回官方仓库来源。主 agent 两个最终 usage 事件分别为 `10690/95` 和 `419/42` input/output tokens，第二轮另有 10,752 cache-read；search provider 本身未暴露 usage。

key 只进入一次性进程环境，没有写进命令、仓库、报告或配置；两个临时 DSH_HOME 的 credential-like 扫描均为零，检查后已删除。报告成功步骤也不保存完整 stdout，只保存 hash/字节数。这里仍未证明图片真实进入请求。

## 10. 证据强度边界

截至 2026-08-21 已证明发布制品、M0 本地真实兼容链路、普通模型 route 和 native search；下面这些当时尚未执行，其中公开 Ubuntu 与自动维修已在 2026-08-22 补齐：

- `0.1.1-rc.2` 中图片真实进入出站请求的端到端视觉断言；
- 公开 fixture 的 `ubuntu-24.04` GitHub Actions run、publisher PR 和 durable report URL；
- Guardian 的跨 run 预算、低价等待、reset、受控故障自动修复和三种交付模式。

图片 smoke 与其余 M3 增强项仍保留为 `ACCEPTANCE.md` 中的 open/partial 项；不得用纯文本模型 probe 或一次 M2 维修外推为完成。

## 11. 2026-08-22 公开 M1/M2 证据

公开 fixture 已完成以下可回读链路：

1. onboarding [PR #1](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/1) 合并；[run 32558667717](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32558667717) 在 GitHub-hosted `ubuntu-24.04` 完成真实插件测试、pack/install、配置 dump、`dsh web` 和 health assertion，并产出 lock PR。
2. snapshot identity 曾错误包含每台临时 runner 的 `actualLabel`，造成重复 lock PR；Guardian `d0aea35` 将该字段保留在报告但排除出 snapshot key。修正后的 [run 32559127238](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32559127238) 返回 `NOOP`，没有再次发布。
3. [PR #8](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/8) 只把插件依赖注入和注册调用从 `webServer` 改回历史错误 `httpServer`，本地测试稳定为 5/10 失败；普通源码 push 没有触发 Guardian，符合控制文件触发边界。
4. 首次维修 [run 32560233957](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560233957) 在旧 `dsh run` CLI 语法处失败，publisher 未运行、没有错误 PR。Guardian `ba18c1d` 改用 rc.2 支持的 `dsh --profile headless --patch ... <task>` 并增加回归测试。
5. [run 32560587541](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560587541) 真实执行固定 repair DSH 和默认视觉模型，生成仅含 `lib/index.js` 两处接口恢复的补丁；原始 verifier 独立复测 PASS 后，publisher 创建 [维修 PR #10](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/10)。repair job 为 `contents: read` 且 checkout `persist-credentials: false`；publisher 有 Git 写权限但没有模型 Secret。
6. repair 报告记录 total 338,599 tokens（input 29,117、cache read 305,920、output 3,562、reasoning 1,229），价格 revision `deepseek-public-2026-08-21` 下估算 0.150001 CNY；repair DSH 主回合 47.603 秒。补丁 SHA-256 为 `301c6ea1de2e327ac075acffcc645f62a5761f32ac62850bf89cfa91ea91b146`，与下载 artifact 和 PR diff 一致。
7. 公开 verify/repair artifacts 对 `sk-*`、Authorization/API key、`/Users/` 和 `/home/runner/work/` 的扫描为零命中；artifact 只保存机械报告、补丁、verified lock 和独立 verifier 报告，不保存完整模型对话。
8. PR #10 人工审计后合并为 fixture `main@3e8590d475031ae0911060ebc7c1ed1e696e47e1`；[run 32560761301](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560761301) 返回同一 snapshot `NOOP`，repair 与两个 publisher job 均跳过，无开放 PR。合并后的 fixture 原生测试 10/10 PASS。

该证据只把 M2 technical MVP 判为 PASS。30% 运行中 steer、低价排队、跨 run 失败冻结、auto-merge/direct-push、外部通知和 contract-required 视觉 smoke 仍未执行，详见 `STATE.md`。
