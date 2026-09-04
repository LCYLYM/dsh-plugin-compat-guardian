# V1 最终验收报告

首次验收日期：2026-08-23

最新回归日期：2026-09-04
自动修复主链 SHA：`5934767074ff0f0c1d1e7283e50b9cb64e3669c6`
社区回归验证 SHA：`317e9858dedf2c16c24558b9d448ac7b24190b41`
模型错误/防循环专项实现 SHA：`4a1ad081cbe04d174f90b559530930fcd8278516`
模型错误/防循环专项验收 SHA：`236252455e05acca890a28ff566c9a6916169f76`
社区真实维修与错误分类修复 SHA：`3de35600566ad1f4ff318e2de3d99de48b6ec72a`
rc.1 日志驱动加固 SHA：`3eca47b4d184ab8f6a0217de9f44249558e0b7ea`
实际目标：`@deepseek-ai/dsh@0.1.1-rc.2`
公开 fixture：[`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)

## 结论

V1 实现 PASS。“发现 DSH 变化 → 隔离兼容验证 → 真实 DSH 自动维修 → 独立复测 → 真实模型/视觉 smoke → PR 或默认分支交付 → 合并后 NOOP 收敛”的主链已在公开 GitHub Actions 真实运行。除 fixture 外，四个社区 fork 都完成了 rc.2 repair DSH 调用、实际 diff、独立 rc.2 verifier、自动 PR、合并和无模型收敛。

验收不把“已实现可选 adapter”写成“已给外部收件人投递”；本次没有 email/TG/webhook 目标和 publisher PAT，所以这些只有确定性测试或安全等待证据。

## 官方 Release `0.1.2-rc.1` 回归与日志加固（2026-09-03 至 2026-09-04）

Guardian 已改为以官方 `dsh-v*` GitHub Release 为更新信号，并要求相同精确版本的 NPM 制品。`dsh-v0.1.2-rc.1` / `@deepseek-ai/dsh@0.1.2-rc.1` 在四个社区 fork 上触发了真实 repair DSH；结果按 verifier、publisher 和最终 PR 分开判定：

| 样本 | 公开 run / PR | 模型步骤 / token | 最终结果 |
| --- | --- | ---: | --- |
| dsh-web-ui | [run 33754127499](https://github.com/LCYLYM/dsh-web-ui/actions/runs/33754127499) / [PR #7](https://github.com/LCYLYM/dsh-web-ui/pull/7) | 409.91s / 2,289,363 | PASS；只更新 workspace manifest 的 `maxHost`，独立 verifier 18.90s，PR 可合并但尚未合并 |
| Whale Report | [run 33754120163](https://github.com/LCYLYM/dsh-whale-report/actions/runs/33754120163) | 300.57s / 999,587 | BLOCKED；模型生成 2,829 个 `.pnpm-store` 文件，16 MiB diff 被旧 runner 截断；verifier 虽通过，但 publisher 正确未落库 |
| Better Sidebar Office | [run 33754134991](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/actions/runs/33754134991) / [state PR #7](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/pull/7) | 233.20s / 589,248 | BLOCKED；收集 binary diff 超过 30s，发布冻结状态 |
| Ankh Guard | [run 33754143975](https://github.com/LCYLYM/dsh-ankh-guard/actions/runs/33754143975) / [state PR #7](https://github.com/LCYLYM/dsh-ankh-guard/pull/7) | 770.27s / 2,705,592 | BLOCKED；DSH exit 1，旧报告只保留输出长度和哈希，无法从 artifact 判断具体 stderr |

这些日志驱动了四项实现修复：内置缓存/控制路径与仓库配置取并集；包管理器缓存路由到仓库外并在 `git add` 前扫描；命令输出显式标记截断，超过 16 MiB 的补丁不得进入 verifier；publisher 校验补丁 SHA-256、截断标记和 `git apply --check`。未知 DSH 失败现在额外保留最多 500 字符的去敏 stderr 摘要。`maxHost` 边界第一轮只要求单字段更新，完整 candidate verifier 若发现真实 API 故障，第二轮再维修源码。

旧 Whale artifact 已直接重放：2,829 个缓存路径现在返回 `PROTECTED_PATH_CHANGED`，旧截断补丁返回 `PUBLISH_PATCH_TRUNCATED`。本轮没有重新开启四个 fork workflow，也没有再次调用模型。

## 模型错误与防循环专项（2026-08-22）

本轮对旧版 46/46 之外新增了配置、凭据、路由、状态去重、宿主版本边界、真实 verifier 耗时和分阶段错误归类回归，`npm run check` 现为 79/79 PASS。

`npm run test:real-route` 使用真实 `@deepseek-ai/dsh@0.1.1-rc.2` 和本地 OpenAI-compatible HTTP 端点，不是 mock DSH：

| 场景 | 真实观测 | Guardian 结果 |
| --- | --- | --- |
| 自定义 URL + Key 引用 + model | 到达 `/chat/completions`，Bearer 和 `guardian-custom-model` 匹配 | route PASS |
| 401 | 1 个 HTTP 请求 | `MODEL_CREDENTIAL_REJECTED / BLOCKED_CONFIG` |
| 错误 model | 1 个 HTTP 请求 | `MODEL_NOT_FOUND / BLOCKED_CONFIG` |
| 错误 endpoint/404 | 1 个 HTTP 请求 | `MODEL_ENDPOINT_NOT_FOUND / BLOCKED_CONFIG` |
| 429 | 首请求 + 一分钟退避后的 1 次 provider retry | `MODEL_RATE_LIMITED / BLOCKED_EXTERNAL` |
| 503 | 首请求 + 一分钟退避后的 1 次 provider retry | `MODEL_PROVIDER_5XX / BLOCKED_EXTERNAL` |
| stream timeout | 首请求 + 一分钟退避后的 1 次 provider retry | `MODEL_PROVIDER_TIMEOUT / BLOCKED_EXTERNAL` |
| 不可达 URL | 真实 rc.2 连接已关闭的本地端口 | `MODEL_PROVIDER_UNREACHABLE / BLOCKED_CONFIG` |
| 未注册 provider | 真实 rc.2 在发起 HTTP 前拒绝，端点 0 请求 | `MODEL_PROVIDER_NOT_REGISTERED / BLOCKED_CONFIG` |
| repair 401 全路径 | 真实 repair DSH 命中 401 | blocked lock 为 `BLOCKED_CONFIG`，`automaticRepairUsed=false`，`attemptsUsed=0` |

另有确定性证据证明：缺 Key 的 repair 和 model smoke 都生成 blocked lock；非法/relative/numeric URL、空 provider、非字符串 model、非法 env 名会在 DSH 启动前拒绝；repair 前同时检查 state/repair 分支；仅持久化 blocked lock 的 push 因输入指纹未变而冻结；model smoke 失败不会推进 `verified`。

专项修复还在公开 fixture 上做了两次连续运行，不只依赖本地测试：

- [run 32576745068](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32576745068) 使用专项验收 SHA 完成 18/18 无模型兼容检查和真实候选模型 smoke；smoke 观测到图片和插件输入，共记录 59,930 tokens，并只生成一个待审阅的 [PR #20](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/20)。
- 保持 PR #20 未合并后再次手工触发 [run 32576967353](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32576967353)。候选模型作业在运行模型前返回 `FROZEN / STATE_PUBLICATION_PENDING`；上传报告只有候选版本和冻结原因，没有 usage、预算或模型结果字段。repair、publish、publish-model-smoke-state 均 skipped，公开仓库仍只有 PR #20，没有重复分支或 PR。

## 公开端到端证据

| 能力 | 证据 | 结果 |
| --- | --- | --- |
| 无模型完整兼容链 | [run 32558667717](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32558667717) | repo tests、pack、profile add/dump、真实 web、plugin smoke、remove PASS |
| 受控不兼容 | [PR #8](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/8) | 恢复历史 `httpServer` 用法，不是 mock 错误 |
| DSH 真实自动修复 | [run 32560587541](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560587541) / [PR #10](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/10) | repair DSH 改为 `webServer`，原 verifier 全部 PASS，产出可合并 PR |
| 真实模型+视觉 | [run 32565423873](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32565423873) | PNG 字节/hash 冻结，`imageObserved=true`，`pluginInputObserved=true`，非空结果 |
| PR 默认交付 | [PR #19](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/19) | 只由 publisher 建分支/PR，repair 无写凭据 |
| direct-push | [run 32566086836](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566086836) / [Issue #16](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/issues/16) | bot commit 直接进 main，commit 包含 durable campaign Issue URL |
| auto-merge 安全边界 | [run 32565934822](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32565934822) / [PR #15](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/15) | 默认 token 不足时明确等待 GitHub 批准，owner 开启 auto-merge 后成功 |
| 外部暂态故障恢复 | [blocked run 32566217178](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566217178) / [recovery run 32566532050](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566532050) | 暂态 404 没有假成功，修正 readiness 后恢复 |
| 费用时序 | [run 32566922071](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566922071) | 459,577 tokens，0.326965 CNY，`mixed`；历史峰时不被当前谷价重算 |
| 防死循环收敛 | [run 32567069724](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32567069724) | 合并后只跑无模型 verify/notify，repair、model smoke、publish 全 skipped |
| 专项修复后的真实模型 smoke | [run 32576745068](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32576745068) / [PR #20](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/20) | 18/18 兼容检查和真实模型/视觉 smoke PASS，只产生一个 lock-only PR |
| 未合并 PR 去重 | [run 32576967353](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32576967353) | 模型前 `STATE_PUBLICATION_PENDING` 冻结，无 usage 字段，无重复 repair/PR |

## 真实运行暴露并修复的 Guardian 问题

这些不是静态猜测，都由公开 Actions 先失败、再修正：

- rc.2 CLI 不接受旧 `dsh run` 用法，改为 headless profile 的正确 launcher 参数顺序。
- web profile 必须直接启动，不能再追加旧 `web` 子命令。
- rc.2 `assistant/message` 使用 `data.message.content` envelope，旧读取方式会误判空回答。
- TCP 端口可连不代表 RPC 已就绪，现在等待真实 `session.create` readiness。
- 已合并但未清理的 bot branch 会阻塞下一次发布，现在只在确认无 open PR 后安全清理。
- 原费用聚合会用当前时段重算历史，现在每段 usage 就地定价后累加，跨峰谷记为 `mixed`。

## 确定性验证

`npm run check` 通过 79/79 项测试，包括：

- usage 去重、峰/谷价格、历史费用累加和未知 route；
- `N -> Y` 单次 reset、增加额度恢复、低价等待、手工 bypass、30% 一次收敛和四类上限；
- 保护路径、测试面强制人审、依赖风险分类、diff 只报告不设行数门；
- 三种交付模式、通知 event ID 去重、不启用 adapter 零网络请求；
- 视觉 fixture 字节冻结与仓库越界拒绝、rc.2 web/RPC envelope 兼容；
- onboarding 发现、完整 SHA 强制、Node/包管理器冲突阻断和 workflow 分 job 最小权限。
- 中文报告可扫读性、onboarding 失败的下一步说明、monorepo workspace 逃逸阻断与 workspace manifest diff policy。
- 带 scoped-package 构建日志的 `npm pack --json` 解析回归；该问题先在真实 `dsh-web-ui` 验证中复现再修复。
- repair 报告汇总独立 verifier 每个步骤的真实耗时，不再显示 `0.00s`。
- 独立 verifier 命令输出即使包含 `401/403` 字样，也不能误报为模型 Key 错误；模型调用阶段的真 401 仍保持 `BLOCKED_CONFIG`。

## 四个社区 fork 的真实 AI 维修

先说边界：rc.1 到 rc.2 对这四个插件的实际 API 没有找到可稳定复现的自然破坏。因此 fork 采用透明的 `package.json#dsh.compat.maxHost=0.1.1-rc.1` 表示“只人工审核到 rc.1”。Guardian 先对同仓库建立 rc.1 PASS 基线，再让 rc.2 repair DSH 自己检查源码/测试并放宽边界，最后由无 Key 独立 verifier 重跑 rc.2 完整 gate。

这证明真实模型调用、diff、复验、PR 和收敛；不声称社区上游代码原本已在 rc.2 上损坏。没有用语法错误、强制失败测试或假 provider 制造结果。

| 样本 | 真实 repair run / PR | 模型耗时 | 独立 verifier | campaign usage / 估算费用 | 实际修改 |
| --- | --- | ---: | ---: | ---: | --- |
| Whale Report | [run 32630631684](https://github.com/LCYLYM/dsh-whale-report/actions/runs/32630631684) / [PR #5](https://github.com/LCYLYM/dsh-whale-report/pull/5) | 175.12s | 21.97s | 724,396 / 0.192735 CNY | `package.json` maxHost rc.1 → rc.2 |
| dsh-web-ui / Skill Explorer | [run 32630635364](https://github.com/LCYLYM/dsh-web-ui/actions/runs/32630635364) / [PR #5](https://github.com/LCYLYM/dsh-web-ui/pull/5) | 289.62s | 16.97s | 1,725,399 / 0.456854 CNY | workspace manifest maxHost rc.1 → rc.2；搜索 3 次 |
| Ankh Guard | [run 32630643094](https://github.com/LCYLYM/dsh-ankh-guard/actions/runs/32630643094) / [PR #5](https://github.com/LCYLYM/dsh-ankh-guard/pull/5) | 208.23s | 120.27s | 979,997 / 0.263889 CNY | `package.json` maxHost rc.1 → rc.2；搜索 1 次 |
| Better Sidebar Office | [run 32631118927](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/actions/runs/32631118927) / [PR #5](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/pull/5) | 155.24s | 36.47s | 1,530,515 / 0.448452 CNY | `package.json` maxHost rc.1 → rc.2；搜索 1 次 |

Office 的 usage/费用是 epoch 2 累计值，包括同一 campaign 中前一次被误分类的调用，不是表中 155.24s 单次模型步骤的独立 token 值。首次 Office rc.2 run 的模型步骤 exit code 为 0，但尚未生成 verifier artifact 就被报成 Key 401/403；代码审计由此定位到总 catch 可能把后续命令输出中的同类字样误归类为模型凭据错误。`3de3560` 把模型调用与 verifier 阶段分开归类后，Office 公开 run 成功。

四次成功 run 从触发到结束分别约 5分43秒、7分40秒、11分14秒、6分26秒，平均约 7分46秒。只看模型步骤平均约 3分27秒；只看独立 verifier 平均约 48.92 秒。之前 145 秒的 fixture 是小插件单样本，不是复杂插件的平均维修时间。

合并后的四次收敛 run 全部 PASS，且 repair/model-smoke/publish 全部 skipped：

- [Whale 32631189755](https://github.com/LCYLYM/dsh-whale-report/actions/runs/32631189755)
- [Web UI 32631193642](https://github.com/LCYLYM/dsh-web-ui/actions/runs/32631193642)
- [Ankh 32631197050](https://github.com/LCYLYM/dsh-ankh-guard/actions/runs/32631197050)
- [Office 32631458431](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/actions/runs/32631458431)

最早的 `325704…` 社区 run 只能证明机械兼容检查/`ONBOARDING_BLOCKED`，并没有真实 AI 修复。它们不再被当成社区 AI 成功案例。

### 测试后停机回读

2026-08-23 完成合并和收敛验证后，最初只停用了 `dsh-compat.yml`。2026-08-24 用户发现 `dsh-web-ui` 从上游继承的 `contributors.yml` 仍按 schedule 触发，证明“只停 Guardian”不等于“测试 fork 全部停机”。随后枚举四仓库的全部 workflow，逐一停用所有 active 项、删除测试 Secret，并在用户明确授权后关闭四个仓库的 Actions 总开关：

| 仓库 | Actions 总开关 | active workflows | `DEEPSEEK_API_KEY` 数量 | in-progress | queued |
| --- | --- | ---: | ---: | ---: | ---: |
| dsh-whale-report | `enabled=false` | 0（CI 与 Guardian 均为 `disabled_manually`） | 0 | 0 | 0 |
| dsh-web-ui | `enabled=false` | 0（7 个 workflow 均为 `disabled_manually`） | 0 | 0 | 0 |
| dsh-plugin-better-sidebar-plugin-office | `enabled=false` | 0（Guardian 为 `disabled_manually`） | 0 | 0 | 0 |
| dsh-ankh-guard | `enabled=false` | 0（Guardian 为 `disabled_manually`） | 0 | 0 | 0 |

四个 fork 保留 workflow 文件、去敏公开 run 和已合并维修提交作为证据。Actions 页面仍会显示停机前的历史 run，但仓库级 Actions 已关闭；即使以后提交新的 workflow 文件，也不会因 schedule、push 或 PR 自动运行，除非仓库管理员重新打开总开关。

## 提交历史与公开日志去敏审计

发布前用同一组 credential/private-path 模式只计数、不回显内容地扫描：

- Guardian 截至专项验收 `236252455e05acca890a28ff566c9a6916169f76` 共 51 个 commit：文件内容 0 命中，commit message 0 命中。
- 公开 fixture 截至专项公开运行所用 `e122d80bd19bbf22a72417ee0015f0d41b4e6cd8` 的 main 共 30 个 commit；本地可达全部 refs 共 36 个 unique commit：文件内容 0 命中，commit message 0 命中。
- 四个社区 fork 中由本项目新增的 8 个 unique commit：新增行 0 命中，commit message 0 命中。
- fixture + 四个 fork 共 29 次 Actions run：28 份可读日志 0 命中；1 次早期取消 run `32559978584` 的 GitHub job log 不存在，无可读面，不写成“已扫描通过”。
- 当前专项验收文档 diff：0 命中。

上述模式包含 DeepSeek/GitHub/NPM/AWS/Slack 常见 token 形态、用户本机绝对路径、Codex 会话目录和原参考工程私有路径。

2026-08-23 社区真实维修完成后又做了一次增量回读：Guardian 和四个 fork 在本轮所有新 commit patch 与 commit message 中，对 32 位 DeepSeek key、GitHub token、Bearer token 和本机路径的匹配数均为 0。Whale/Web 当前树中的通用模式命中仅位于上游原有的 credential/redaction 测试 fixture，本轮 patch 并未改动它们。四个真实 repair run 、四个合并后收敛 run，以及 Office 一次失败 run 的公开日志逐份扫描均为 0 命中。停机后又从 GitHub 回读确认四仓库的 `DEEPSEEK_API_KEY` 均已删除。

## 验收边界

| 可选能力 | 实现 | 本次真实外部验证 |
| --- | --- | --- |
| email/TG/webhook | 已实现 adapter、去敏和 event-id 去重 | 未投递：未提供目标和凭据 |
| PAT 无人值守 auto-merge | 已实现，仅 publisher job 可见 | 未验证 PAT；已验证默认 token 安全等待 |
| contract-only PR | 已实现独立 publisher 路径和人审强制 | 未故意修改当前真实 contract |
| agent-selected/differential smoke | 已实现冻结、sandbox、缓存键和两种模式 | 公开运行选用默认 fixed/candidate-only |
| latest 中途发新版 | 已实现 `SUPERSEDED` 与新版重建 campaign | 没有伪造真实 NPM 发版来测试 |

这些是“可选外部环境尚未现场绑定”，不是主链路缺少代码。
