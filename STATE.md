# State

日期：2026-08-22

当前切片：M0、M1、M2 MVP 已完成真实公开验收；M3 增强项未完成。

项目阶段：technical MVP，可安装进单仓库试用，默认只产出人工审核 PR。

## 当前可用

- 每 6 小时、手工或控制文件变更时解析 NPM `latest`，冻结 DSH 根包版本、integrity 和实际安装图。
- 在 GitHub-hosted `ubuntu-24.04` 的隔离目录和独立 `DSH_HOME` 中运行仓库测试、pack、插件安装、配置 dump、真实 `dsh web`、插件 smoke 和卸载清理。
- PASS 后只提交机器 lock；相同 snapshot 返回 `NOOP`，不会重复开 PR。
- 机械验证失败后，独立 repair job 才获得 `DEEPSEEK_API_KEY`；固定 `@deepseek-ai/dsh@0.1.1-rc.2` 和默认 `deepseek-official/deepseek-v4-flash-vision-exp` 生成窄补丁。
- repair job 没有 Git 写凭据；独立 verifier 使用原 contract 全量复测，PASS 后另一个无模型 Secret 的 publisher 才创建人工审核 PR。
- 保护 workflow、Guardian 配置/lock、compatibility contract 和仓库外路径；报告与 7 天 artifact 不保存完整模型对话、请求或凭据。
- 已使用 DSH JSONL usage 统计 token，并按带 revision 的 DeepSeek 价格快照估算人民币；同版本成功维修后 lock 记录 `automatic_repair_used`，只有 `resetBudget: Y` 或提高额度才允许再次维修。

## 公开验收证据

- Guardian 引擎：[`LCYLYM/dsh-plugin-compat-guardian`](https://github.com/LCYLYM/dsh-plugin-compat-guardian)，M2 冻结 commit `ba18c1d302f5b0948f3499455dcc6184848d56c2`。
- 真实插件 fixture：[`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)。
- onboarding PR：[#1](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/1)。
- Ubuntu 首次完整验证：[run 32558667717](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32558667717)。
- 稳定 snapshot 与 NOOP：[run 32559127238](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32559127238)。
- 受控 `httpServer` 兼容故障：[PR #8](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/8)。
- 首次维修暴露旧 CLI 语法并安全停止：[run 32560233957](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560233957)；没有发布错误 PR。
- 修正后真实 DSH 自动维修、独立复测与发布：[run 32560587541](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560587541)。
- 机器生成且经人工审计后合并的维修 PR：[#10](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/10)。补丁只修改 `lib/index.js` 两处接口名和机器 lock。
- 合并后防循环 NOOP：[run 32560761301](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560761301)；repair/publish 全部跳过，无新 PR。
- 合并后的 fixture `main@3e8590d475031ae0911060ebc7c1ed1e696e47e1` 本地原生测试 10/10 PASS。

本次真实维修使用 338,599 total tokens，其中 input 29,117、cache read 305,920、output 3,562；价格快照 `deepseek-public-2026-08-21` 下估算 0.150001 CNY。repair DSH 运行 47.603 秒。公开 repair artifact 的 Secret、认证头、本机路径与 runner 工作路径扫描为零命中；补丁 SHA-256 `301c6ea1de2e327ac075acffcc645f62a5761f32ac62850bf89cfa91ea91b146` 与 PR 内容一致。

## 尚未完成，不能当成现成功能

- 30% 剩余额度时向正在运行的 DSH 动态发送一次收敛消息；当前只记录该配置，尚无运行中注入通道。
- repair 的低价时段排队/手工立即覆盖；当前价格窗口只用于费率选择和报告，不会延迟 job。
- token/CNY 是一次 DSH 回合结束后的交付门，不是 provider 账单级实时断路器；绝对金额上限仍需在 DeepSeek 账户侧设置。
- 失败维修的跨 Actions run 持久冻结、`Y` 单次边沿消费和多 attempt 编排尚未完整实现；当前成功 campaign 会持久化一次维修门。
- `auto-merge`、`direct-push`、email、Telegram、webhook、contract-required 模型/视觉 smoke、contract-only PR、upstream supersede 和完整自定义 provider 价格映射尚未做端到端验收。
- NPM 包尚未发布；当前从固定 GitHub commit 安装。中央多仓库托管仍明确不在 V1。

详细需求状态以 [ACCEPTANCE.md](ACCEPTANCE.md) 为准；未标为 PASS 的项目不得由本次 M2 证据外推为完成。
