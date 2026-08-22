# V1 最终验收报告

日期：2026-08-22  
引擎验证 SHA：`5934767074ff0f0c1d1e7283e50b9cb64e3669c6`  
实际目标：`@deepseek-ai/dsh@0.1.1-rc.2`  
公开 fixture：[`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)

## 结论

V1 实现 PASS。“发现 DSH 变化 → 隔离兼容验证 → 真实 DSH 自动维修 → 独立复测 → 真实模型/视觉 smoke → PR 或默认分支交付 → 合并后 NOOP 收敛”的主链已在公开 GitHub Actions 真实运行。

验收不把“已实现可选 adapter”写成“已给外部收件人投递”；本次没有 email/TG/webhook 目标和 publisher PAT，所以这些只有确定性测试或安全等待证据。

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

## 真实运行暴露并修复的 Guardian 问题

这些不是静态猜测，都由公开 Actions 先失败、再修正：

- rc.2 CLI 不接受旧 `dsh run` 用法，改为 headless profile 的正确 launcher 参数顺序。
- web profile 必须直接启动，不能再追加旧 `web` 子命令。
- rc.2 `assistant/message` 使用 `data.message.content` envelope，旧读取方式会误判空回答。
- TCP 端口可连不代表 RPC 已就绪，现在等待真实 `session.create` readiness。
- 已合并但未清理的 bot branch 会阻塞下一次发布，现在只在确认无 open PR 后安全清理。
- 原费用聚合会用当前时段重算历史，现在每段 usage 就地定价后累加，跨峰谷记为 `mixed`。

## 确定性验证

`npm run check` 通过 38/38 项测试，包括：

- usage 去重、峰/谷价格、历史费用累加和未知 route；
- `N -> Y` 单次 reset、增加额度恢复、低价等待、手工 bypass、30% 一次收敛和四类上限；
- 保护路径、测试面强制人审、依赖风险分类、diff 只报告不设行数门；
- 三种交付模式、通知 event ID 去重、不启用 adapter 零网络请求；
- 视觉 fixture 字节冻结与仓库越界拒绝、rc.2 web/RPC envelope 兼容；
- onboarding 发现、完整 SHA 强制、Node/包管理器冲突阻断和 workflow 分 job 最小权限。

## 验收边界

| 可选能力 | 实现 | 本次真实外部验证 |
| --- | --- | --- |
| email/TG/webhook | 已实现 adapter、去敏和 event-id 去重 | 未投递：未提供目标和凭据 |
| PAT 无人值守 auto-merge | 已实现，仅 publisher job 可见 | 未验证 PAT；已验证默认 token 安全等待 |
| contract-only PR | 已实现独立 publisher 路径和人审强制 | 未故意修改当前真实 contract |
| agent-selected/differential smoke | 已实现冻结、sandbox、缓存键和两种模式 | 公开运行选用默认 fixed/candidate-only |
| latest 中途发新版 | 已实现 `SUPERSEDED` 与新版重建 campaign | 没有伪造真实 NPM 发版来测试 |

这些是“可选外部环境尚未现场绑定”，不是主链路缺少代码。
