# V1 原设计对照审计

日期：2026-08-22  
对照对象：`DESIGN.md`、`WHITEPAPER.md`、`IMPLEMENTATION_PLAN.md` 与当前代码/公开运行。

## 结论

当前主线没有偏成通用依赖机器人、中央托管平台或新的计费系统。本轮新增的中文报告、monorepo workspace、pack 解析修复、社区 fork 回归和双语 README，都直接服务“安装进插件仓库，自动跟随 DSH latest 并修兼容”的原目标。

## 原始范围是否落地

| 原始要求 | 当前实现 | 证据/边界 |
| --- | --- | --- |
| 监控 NPM `latest` 并最终收敛 | dist-tag + integrity + graph digest，6 小时/手工/控制文件触发 | 合并后 NOOP run 32567069724 |
| 新 DSH 在别的目录隔离运行 | candidate runner + 独立 `DSH_HOME` | 公开 fixture 与四个社区 run |
| 安装插件并跑原测试/专属 smoke | repo gates + npm pack + add/dump/web/assert/remove | Whale 插件 API、Skill Explorer health |
| 只在确定是 DSH 回归时修 | baseline/candidate 同 gate 差分；onboarding 失败不修 | Office `ONBOARDING_BLOCKED` |
| 固定 repair DSH，也可配置跟新 | 默认 rc.2，campaign 内锁定；配置可改 | 真实 repair run 32560587541 |
| 独立 verifier 复验，产出可合并 PR | repair job 无 Git 写权，publisher 只消费 PASS artifact | PR #10 / #19 |
| 可选 auto-merge/direct-push | 三种模式已实现，默认 PR，风险 diff 强制 PR | direct run 32566086836；auto-merge PR #15 |
| token/CNY/时间/轮次上限与 30% 收敛 | campaign ledger + 单次 steer + 峰谷分段估价 | 46 项测试；最终 lock 459,577 tokens |
| 同版本不死循环 | 一次自动维修；提额或 `resetBudget: N → Y` 才恢复 | campaign/reset 测试 |
| DeepSeek base URL/key/model 可配 | 直接 patch DSH `llm-deepseek` 的 `baseURL/apiKeyEnv`；真实 rc.2 自定义 route 已验证 | 其他 provider 必须已在 DSH profile 注册；只改 id 不会自动安装 adapter |
| 允许 repair DSH 按需搜索 | 默认允许，不强制每次搜，只存次数/hash | 搜索 telemetry 测试 |
| 中文易读报告和通知 | 中文 Summary/Issue/Telegram 文案，技术证据折叠 | report/notifier 测试 |
| 安装到单个仓库 | 薄 workflow 调用固定 SHA reusable workflow | 不做中央多仓托管 |
| fork/魔改插件自己负责 | 仅维护当前仓库，不自动联系 upstream | 四个 fork 都只写 `LCYLYM/*` |

## 本轮新增，但不是额外产品范围

- `plugin.workspace`：设计和配置原本已有，但 verifier/model-smoke/diff policy 没有真正贯通。社区 monorepo 回归证明这是缺失实现，不是新架构。
- 稳健 `npm pack --json` 解析：真实 package `prepare` 会输出 `[@scope/pkg]`，旧代码误当 JSON；修复只改一个解析点。
- 品牌图与双语 README：只改用户入口和可理解性，没增加 runtime 服务。
- 四个社区 fork：是回归 fixture 和证据，不是中央托管。

## 明确没有新增的实体

- 没有数据库、dashboard、常驻服务或自建计费网关。
- 没有通用 Renovate/Dependabot 式依赖升级。
- 没有中央保管多仓库 Secret 或跨仓写权限。
- 没有默认展开多 OS/browser matrix。
- 没有用提示词代替预算、权限、保护路径和独立复验门。

## 仍需用户提供的真实边界

- onboarding 必须审核 smoke contract。对纯客户端/watchdog 类插件，只测 web shell 不能冒充行为验收。
- email/TG/webhook 要真实目标和凭据；未配置时代码完整，但不宣称已对外投递。
- GitHub Actions 创建 PR 需仓库打开对应官方开关；否则安全停在 `WAITING_FOR_GITHUB_APPROVAL`。
- 给对话曝光过的 API Key 应在交付后轮换；仓库历史和报告不保存该 Key。
