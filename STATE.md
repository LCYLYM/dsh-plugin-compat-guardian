# State

日期：2026-09-04

项目阶段：V1 实现完成，主链路已在公开仓库真实验证。默认交付人工审核 PR；`auto-merge` 和 `direct-push` 需仓库显式开启。

2026-09-03 已将候选发现器改为默认追踪官方 `deepseek-ai/deepseek-harness` GitHub Release（含 prerelease），再校验对应 NPM 制品；Release 与 NPM 发布存在时间差时进入 `WAITING_FOR_NPM_ARTIFACT`，不调用模型、不创建 PR。真实 `0.1.2-rc.1` 候选已成功解析并隔离安装；四个公开测试 fork 已完成一次真实 Actions 验证，随后已关闭 Guardian workflow。

本轮真实结果：`dsh-web-ui` 产生并打开 PR #7（AI 将 `maxHost` 从 `0.1.1-rc.2` 调整到 `0.1.2-rc.1`，独立 verifier 通过，总用时约 456.6 秒）；`dsh-whale-report` 的模型维修通过 verifier 但生成 2,829 个 `.pnpm-store` 缓存文件，16 MiB 补丁输出被截断后才在发布阶段失败；`dsh-plugin-better-sidebar-plugin-office` 的维修在收集 diff 时超时并冻结；`dsh-ankh-guard` 的维修调用约 12.8 分钟后以 DSH 命令失败并冻结。

2026-09-04 日志驱动加固已合并至 Guardian `3eca47b4d184ab8f6a0217de9f44249558e0b7ea`，Guardian 本地测试 95/95 通过：缓存/控制路径改为不可被仓库配置覆盖的内置禁止项，包管理器缓存路由到仓库外，`git add` 前先扫描路径；命令输出显式记录截断状态，超过 16 MiB 的补丁不再进入 verifier；publisher 校验补丁 SHA-256、历史截断标记和 `git apply --check`；失败报告新增最多 500 字符的去敏 stderr 摘要。`maxHost` 审核边界的第一轮提示词只做单字段更新，完整 verifier 若发现真实 API 故障再进入第二轮源码维修。真实 Whale repair artifact 重放现于发布前返回 `PROTECTED_PATH_CHANGED`，旧截断 artifact 返回 `PUBLISH_PATCH_TRUNCATED`。四个测试 fork 已固定到该 SHA，Guardian workflow 继续保持 `disabled_manually`，未重新消耗模型额度。

2026-08-22 专项审计修复已 PASS：模型配置/外部错误持久化、未合并维修 PR 去重、自定义 DSH route、严格配置验证和失败 verified 不前移均已落地。

2026-08-23 四个社区 fork 真实 AI 维修已 PASS：rc.2 repair DSH 实际调用、一文件兼容 diff、独立 rc.2 verifier、自动 PR、合并后无模型收敛均有公开证据。测试 Key 已删除。2026-08-24 发现首次停机只关闭 Guardian，未关闭 fork 从上游继承的其他 Actions；现已枚举并停用四仓库全部 workflow，并经用户明确授权关闭四仓库的 Actions 总开关。逐仓回读均为 `enabled=false`；active workflow、活跃/排队 run 与 DeepSeek Key 数量均为 0。

## 已实现

- 每 6 小时、手工或控制文件变化时解析官方 GitHub Release 及对应 NPM 制品，冻结 Release tag/commit、精确版本、root integrity 和实际安装图。
- 在隔离目录和独立 `DSH_HOME` 中执行仓库测试、pack、插件安装、config dump、真实 `dsh web`、专属 smoke 和卸载。
- 默认 candidate-only 的真实模型/视觉 smoke；固定 fixture 按字节冻结，只判定附件进入请求、provider 返回非空结果等机械事实。
- 机械验证失败后才让固定 `@deepseek-ai/dsh@0.1.1-rc.2` 使用默认 `deepseek-official/deepseek-v4-flash-vision-exp` 维修；repair 没有 Git 写凭据，必须经独立 verifier 复测。
- campaign 按“仓库 + 目标 DSH 版本”累计 token、估算 CNY、活跃时间和 attempt；峰/谷费用按各自发生时段累加，剩余 30% 只发一次收敛提醒。
- 同版本自动维修机会只使用一次；失败后 schedule 不再调模型。用户把 lock 的 `resetBudget` 由 `N` 改为 `Y` 或提高额度才能继续，`Y` 被消费后自动写回 `N`。
- 默认低价时段才启动 repair，手工运行可立即修；candidate 机械/模型 smoke 不等待低价。
- 支持 `pull-request`、`auto-merge`、`direct-push`。测试面或高风险依赖变更会强制降级为人工 PR；保护路径变更直接拒绝。
- Actions Summary 每次生成；campaign Issue、email、Telegram 和 webhook 按稳定 event ID 去重，NOOP 不发外部通知。
- `BLOCKED_EXTERNAL`、`BLOCKED_CONTRACT`、`STALE_SOURCE`、`SUPERSEDED`、旧合并分支清理和 contract-only PR 路径均已实现。
- 缺 Key/401/403/错误 model、base URL 或 provider 持久化为 `BLOCKED_CONFIG`；429/5xx/timeout 由 DSH provider 最多重试一次后持久化为 `BLOCKED_EXTERNAL`。
- repair/model smoke 在调模型前同时检查 state 与维修分支；仅合并失败 lock 造成的 push 不会触发相同输入再跑。
- 模型 smoke 失败保留上一个真正 verified，不会把“只过了机械 gate”的 candidate 误写成已兼容。
- 真实 `@deepseek-ai/dsh@0.1.1-rc.2` 本地 HTTP 探针已证明自定义 URL、Bearer Key、model 均到达原生 `/chat/completions`；401/错 model/404/429/503/timeout 分类与重试上限符合预期。

## 公开真实证据

- 当前社区验证与错误分类 commit：[`3de35600566ad1f4ff318e2de3d99de48b6ec72a`](https://github.com/LCYLYM/dsh-plugin-compat-guardian/commit/3de35600566ad1f4ff318e2de3d99de48b6ec72a)。它包含真实 verifier 耗时汇总，以及防止 verifier 命令中的 `401/403` 文字被误报为模型 Key 错误的分阶段归类。
- 公开 fixture：[`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)。
- 真实历史不兼容自动维修：[run 32560587541](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32560587541) / [PR #10](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/10)。修复 `httpServer` 到 rc.2 的 `webServer`，338,599 tokens，估算 0.150001 CNY，repair 47.603s。
- 真实模型/视觉 smoke：[run 32565423873](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32565423873)。2,712-byte PNG 的 SHA-256 为 `c88283c1c8b71e4ebfb190e7a4a462dd4a51dd42383f1790b1e28d5f5179b62c`，`imageObserved` 和 `pluginInputObserved` 均为 true，provider 返回非空结果。
- 最终费用时序修复验证：[run 32566922071](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566922071) / [PR #19](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/19)。历史峰时与当前谷时按段累加，最终 459,577 tokens、0.326965 CNY、`band: mixed`。
- 合并后收敛：[run 32567069724](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32567069724)。verifier PASS，repair/model-smoke/publish 全部 skipped，没有新 PR 和新模型消耗。
- `direct-push`：[run 32566086836](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566086836)，bot 直接更新 main，commit 包含 campaign [Issue #16](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/issues/16) 链接。
- `auto-merge`：[run 32565934822](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32565934822) 创建 [PR #15](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/15)；默认 Actions token 按 GitHub 权限边界进入 `WAITING_FOR_GITHUB_APPROVAL`，仓库 owner 后续启用 auto-merge 成功。
- 真实外部暂态故障和恢复：[run 32566217178](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566217178) 安全停在 `BLOCKED_EXTERNAL`，修正 RPC readiness 后 [run 32566532050](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/32566532050) PASS。
- 社区真实 AI 维修：[Whale Report run 32630631684 / PR #5](https://github.com/LCYLYM/dsh-whale-report/pull/5)、[dsh-web-ui run 32630635364 / PR #5](https://github.com/LCYLYM/dsh-web-ui/pull/5)、[Ankh run 32630643094 / PR #5](https://github.com/LCYLYM/dsh-ankh-guard/pull/5)、[Office run 32631118927 / PR #5](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/pull/5) 都已 PASS 并合并。四个合并后 run 均跳过 repair，未再消耗模型额度。受控边界是“最后人工审核到 rc.1”的 `maxHost`，不声称上游代码原本已在 rc.2 自然损坏。

详细证据矩阵见 [docs/FINAL_VALIDATION.md](docs/FINAL_VALIDATION.md)。

## 实现完成但未做真实外部投递的可选项

- email、Telegram、webhook adapter 和去重已有确定性测试；因本次没有提供收件人、TG chat/bot 或 webhook endpoint，没有对外发送消息。
- 可选 `DSH_GUARDIAN_PUBLISH_TOKEN` 的 job 隔离已实现；本次没有提供 PAT，因此验证的是默认 token 安全等待，不是 PAT 无人值守合并。
- contract-only PR、agent-selected fixture、differential model smoke 和新 latest 打断旧 campaign 均有实现/故障注入证据，本次没有为测试而额外伪造上游 DSH 发版或真实 contract 修改。

## 不可越过的边界

- token/CNY 上限基于 DSH 已报告 usage，可在下一次请求前阻断；它不是 DeepSeek 账户账单级实时硬限。
- GitHub Release 是更新信号，NPM 是实际安装制品；两者不同步时必须保持 `WAITING_FOR_NPM_ARTIFACT`，不能用源码压缩包冒充已发布运行包。
- V1 仅安装进单个插件仓库，不做中央多仓库托管，不自动更改或通知 upstream。
