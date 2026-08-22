# V1 最终验收报告

日期：2026-08-22  
自动修复主链 SHA：`5934767074ff0f0c1d1e7283e50b9cb64e3669c6`
社区回归验证 SHA：`317e9858dedf2c16c24558b9d448ac7b24190b41`
模型错误/防循环专项实现 SHA：`4a1ad081cbe04d174f90b559530930fcd8278516`
模型错误/防循环专项验收 SHA：`236252455e05acca890a28ff566c9a6916169f76`
实际目标：`@deepseek-ai/dsh@0.1.1-rc.2`
公开 fixture：[`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)

## 结论

V1 实现 PASS。“发现 DSH 变化 → 隔离兼容验证 → 真实 DSH 自动维修 → 独立复测 → 真实模型/视觉 smoke → PR 或默认分支交付 → 合并后 NOOP 收敛”的主链已在公开 GitHub Actions 真实运行。

验收不把“已实现可选 adapter”写成“已给外部收件人投递”；本次没有 email/TG/webhook 目标和 publisher PAT，所以这些只有确定性测试或安全等待证据。

## 模型错误与防循环专项（2026-08-22）

本轮对旧版 46/46 之外新增了配置、凭据、路由和状态去重回归，`npm run check` 现为 71/71 PASS。

`npm run test:real-route` 使用真实 `@deepseek-ai/dsh@0.1.1-rc.2` 和本地 OpenAI-compatible HTTP 端点，不是 mock DSH：

| 场景 | 真实观测 | Guardian 结果 |
| --- | --- | --- |
| 自定义 URL + Key 引用 + model | 到达 `/chat/completions`，Bearer 和 `guardian-custom-model` 匹配 | route PASS |
| 401 | 1 个 HTTP 请求 | `MODEL_CREDENTIAL_REJECTED / BLOCKED_CONFIG` |
| 错误 model | 1 个 HTTP 请求 | `MODEL_NOT_FOUND / BLOCKED_CONFIG` |
| 错误 endpoint/404 | 1 个 HTTP 请求 | `MODEL_ENDPOINT_NOT_FOUND / BLOCKED_CONFIG` |
| 429 | 首请求 + 1 次 provider retry | `MODEL_RATE_LIMITED / BLOCKED_EXTERNAL` |
| 503 | 首请求 + 1 次 provider retry | `MODEL_PROVIDER_5XX / BLOCKED_EXTERNAL` |
| stream timeout | 首请求 + 1 次 provider retry | `MODEL_PROVIDER_TIMEOUT / BLOCKED_EXTERNAL` |
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

`npm run check` 通过 71/71 项测试，包括：

- usage 去重、峰/谷价格、历史费用累加和未知 route；
- `N -> Y` 单次 reset、增加额度恢复、低价等待、手工 bypass、30% 一次收敛和四类上限；
- 保护路径、测试面强制人审、依赖风险分类、diff 只报告不设行数门；
- 三种交付模式、通知 event ID 去重、不启用 adapter 零网络请求；
- 视觉 fixture 字节冻结与仓库越界拒绝、rc.2 web/RPC envelope 兼容；
- onboarding 发现、完整 SHA 强制、Node/包管理器冲突阻断和 workflow 分 job 最小权限。
- 中文报告可扫读性、onboarding 失败的下一步说明、monorepo workspace 逃逸阻断与 workspace manifest diff policy。
- 带 scoped-package 构建日志的 `npm pack --json` 解析回归；该问题先在真实 `dsh-web-ui` 验证中复现再修复。

## 社区仓库回归

| 样本 | 精确测试面 | 结果 |
| --- | --- | --- |
| [Whale Report run 32570423087](https://github.com/LCYLYM/dsh-whale-report/actions/runs/32570423087) / [PR #1](https://github.com/LCYLYM/dsh-whale-report/pull/1) | 仓库测试/构建、pack/add/dump/web、`/whale/api/list`、remove | PASS |
| [`dsh-web-ui` run 32570426593](https://github.com/LCYLYM/dsh-web-ui/actions/runs/32570426593) / [PR #1](https://github.com/LCYLYM/dsh-web-ui/pull/1) | pnpm monorepo 根安装，`packages/dsh-skill-explorer` 测试/构建/打包，health 断言 | PASS |
| [Ankh Guard run 32570430758](https://github.com/LCYLYM/dsh-ankh-guard/actions/runs/32570430758) / [PR #1](https://github.com/LCYLYM/dsh-ankh-guard/pull/1) | 测试/构建、pack/add/dump/web/remove | PASS；不宣称 watchdog 行为已验收 |
| [Office run 32570428991](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/actions/runs/32570428991) | 首次基线的 frozen install | `ONBOARDING_BLOCKED`；`@deepseek-ai/dsh-type-meta@0.0.1-rc.1` 已从 NPM 撤下，没有进入模型修复 |

本轮没有找到一个“上游未修、对当前 NPM latest rc.2 可安装且真实回归”的社区 commit。Whale Report 历史中标注的新 harness 修复，其修复前 commit 对 rc.2 实测仍 PASS；不用提交说明替代当前运行事实。因此社区样本用于异构回归和诚实阻断证据，真实自动修复成功案例仍由受控公开 fixture 的 run 32560587541 / PR #10 承担。

三个 PASS 社区 fork 的第一次 publisher 在仓库尚未打开“Actions 创建 PR”开关时正确停在 `WAITING_FOR_GITHUB_APPROVAL`；表中 PR 按该回退路径手工打开。他们证明产物可合并，不写成 Actions 自动建 PR。

## 提交历史与公开日志去敏审计

发布前用同一组 credential/private-path 模式只计数、不回显内容地扫描：

- Guardian 截至专项验收 `236252455e05acca890a28ff566c9a6916169f76` 共 51 个 commit：文件内容 0 命中，commit message 0 命中。
- 公开 fixture 截至专项公开运行所用 `e122d80bd19bbf22a72417ee0015f0d41b4e6cd8` 的 main 共 30 个 commit；本地可达全部 refs 共 36 个 unique commit：文件内容 0 命中，commit message 0 命中。
- 四个社区 fork 中由本项目新增的 8 个 unique commit：新增行 0 命中，commit message 0 命中。
- fixture + 四个 fork 共 29 次 Actions run：28 份可读日志 0 命中；1 次早期取消 run `32559978584` 的 GitHub job log 不存在，无可读面，不写成“已扫描通过”。
- 当前专项验收文档 diff：0 命中。

上述模式包含 DeepSeek/GitHub/NPM/AWS/Slack 常见 token 形态、用户本机绝对路径、Codex 会话目录和原参考工程私有路径。

## 验收边界

| 可选能力 | 实现 | 本次真实外部验证 |
| --- | --- | --- |
| email/TG/webhook | 已实现 adapter、去敏和 event-id 去重 | 未投递：未提供目标和凭据 |
| PAT 无人值守 auto-merge | 已实现，仅 publisher job 可见 | 未验证 PAT；已验证默认 token 安全等待 |
| contract-only PR | 已实现独立 publisher 路径和人审强制 | 未故意修改当前真实 contract |
| agent-selected/differential smoke | 已实现冻结、sandbox、缓存键和两种模式 | 公开运行选用默认 fixed/candidate-only |
| latest 中途发新版 | 已实现 `SUPERSEDED` 与新版重建 campaign | 没有伪造真实 NPM 发版来测试 |

这些是“可选外部环境尚未现场绑定”，不是主链路缺少代码。
