# Guardian 0.1.1-dev.0：升级验证与消融

总目标尚在验收中：五个现有消费者使用 Anna `auto` / `high`、纯文字输入，优化引擎进入原更新流程，并验证真实升级与发布。以下只写已观测证据。

## 设计范围

保留原 budget、原仓库测试、原 smoke contract 与独立 verifier。模型不修改控制文件，不使用 DSH 风险豁免，不以指导卡片代替运行结果。新能力只包括被真实失败证明必要的启动兼容、Session 协议、模型目录和诊断传递；升级卡片是按需只读材料，不是第二套执行框架。

参考 [dsh-plugin-upgrade-skill](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill/tree/ef075767b476e8000c716a18f848028eebcd5aef)，revision `ef075767b476e8000c716a18f848028eebcd5aef`，20 个迁移段、195 张原始卡片，附原 MIT LICENSE。版本走廊中保留全部非可选卡片，heuristic 扫描只作导航。已知 `0.1.7-rc.1 → rc.2` 和 `0.2.0-rc.1 → 0.2.1-alpha.2` 缺少连续覆盖，不会伪造完整迁移结论。

## 启动消融：两个因素都必要

真实 `@deepseek-ai/dsh@0.1.1-rc.2`，Node `24.13.1` / macOS ARM64；每组 3 个独立新 home，HTTP 认证、200 响应且启动后存活至少 1 秒；不调用模型。

| 组 | 固定 HMR 1.0.17 | 提前加载 HMR | 成功 |
| --- | --- | --- | ---: |
| control | 否 | 否 | 0/3 |
| pin only | 是 | 否 | 0/3 |
| preload only | 否 | 是 | 0/3 |
| combined | 是 | 是 | 3/3 |

原生失败分别为 HMR 尚未可用和 `registerConfig` 已移除。只 pin 或只 preload 均无效，因此组合措施仅用于这个已测旧版的临时 runner。Whale 的原测试、构建、安装、真实 Web 专属断言也在组合措施下 PASS。脚本：`scripts/boot-ablation.mjs`。

## 新版 Session 与真实模型

真实候选 `0.2.1-alpha.2`。旧 `session.history` 已不能代表新版协议；新版使用原生 `session/modelCatalog`、named arguments 和 `/api/remote.mux` 的 `session/follow`。只读探测确认协议，使用 launch token 换取 cookie；不在 401/403 后换协议绕过认证。必须观察持久化 `turn/end`，流提前结束不能 PASS。

实测 Anna `/v1/messages` 和 `/v1/chat/completions` 均能处理 `auto`。新版 DSH 原生请求先暴露 `auto` 未在模型目录，再暴露 `max_tokens=131072` 超出供应商返回的 65536 限制；没有把两者写成 Key 或供应商超时。五个消费者的 cap 改为 65536，不改变 campaign token 总额度。

fixture 的真实文本 smoke PASS：`user/message`、`tool/call`、`tool/result`、非空 `assistant/message` 和 `turn/end` 均持久化，`imageObserved=false`，12,545 已报告 tokens。该结果证明新版真实模型和工具链路，不代表四个社区插件已升级成功，也不代表未来 `auto` 后端不变。当前 Anna 路由不匹配官方价格表，CNY 明确为未知，不伪造费用。

## 迁移上下文消融

用 Whale 同一提交 `5badd1b71368767e65994744c30b91c1d11f0c37`、同一候选、旧 repair SDK `0.1.1-rc.2`、`auto` / `high`、相同额度和原测试完成 control / on-demand-guidance 对照。每组独立副本和 home，不发布试验副本。

| 组 | 结果 | 轮次 | 已报告 tokens | 实际源码增量 |
| --- | --- | ---: | ---: | --- |
| control | BLOCKED_EXTERNAL：原生 CLI 报告 HTTP 502 | 2 | 288,515 | 仅 maxHost，未通过完整升级 |
| on-demand guidance | PASS：独立 verifier 原测试/构建/安装/Web smoke/卸载全通过 | 2 | 1,907,268 | package.json 的兼容/DSH peer/dev 范围及 pnpm-lock.yaml |

指导组证明了一次真实模型升级成功，但 control 遭遇外部错误，且指导组消耗更高；不能将差异归因为卡片、不能声称提高成功率或降低成本。因此生产默认不自动注入卡片；保留版本限定、精确目标来源、精准失败证据和不增加可选能力的设计。卡片仅保留在显式消融实验开关中。

前期中止试验保留 FAIL：首轮只改 maxHost，复验被 peerDependencies 拒绝；当时 stderr 和准确报告路径没有进入 refinement，模型读回自己的 Session 日志，中止时已报告 1,659,749 tokens。该试验没有完成成对比较，不能纳入成功率或声称指导有效。修正诊断包装和报告路径后再做成对试验。脚本：`scripts/repair-ablation.mjs`。

## 模型执行 SDK 与插件基线分离

新的固定 repair SDK `0.2.1-alpha.2` 的真实 CLI 探测暴露旧 `DSH_TOOLS_MODE=both` 已不合法；改用两个已测 cohort 均支持的 `native` 后，真实 bash 工具、非空助手回复和 completed turn PASS，15.855 秒，3,315 已报告 tokens。此探测只证明新 SDK 模型执行链路，不冒充插件升级。

五个消费者的模型执行 SDK 将固定到该新版；旧插件基线仍按最后 verified 版本独立复测，不以新 repair SDK 代替旧基线。新版执行 SDK 与候选相同时，模型可只读检查已安装的真实目标模块声明，避免猜测或重复安装。供卡片生成使用的起点也来自 verified 插件基线，而不是 repair SDK 的版本。

## 最终部署与消费者

最终执行版本为 `ec5e76805e563725e2d155391ff6732c02b4c8b9`，由引擎 PR #21 / #22 / #23 合并组成；五个消费者的 workflow 都已读回相同 pin。单测或 fixture 成功不替代消费者验证。

首轮部署到 `30d36cca20d9c9b6931321cbd036415eff9d50e7` 后发现两个前置缺口：Web UI 的实际旧基线是 `0.1.2-rc.1`；该版重复相同四组启动消融，control / pin / preload 各 0/3，combined 3/3，因此仅扩展到这个实际测过的版本。Ankh 与 fixture 的已合并状态分支被错误当成待合并 PR，实际调用被冻结；改为用只读 GitHub API 核对 open PR，不删除历史分支，也不放行真正待合并的 PR。

模型 smoke 还必须检查真实 `turn/end.data.reason.kind === completed`：未知失败或中断后的部分回复不能 PASS。增补一项单测后 129/129 通过；真实候选 SDK / Anna auto/high / 文本工具回合在这个严格门槛下再次 PASS，6,119 已报告 tokens、`terminalReason=completed`、`imageObserved=false`。历史部署的通过报告不补写该字段。

| 消费者 | 实际证据 | 当前结论 |
| --- | --- | --- |
| fixture | [严格门槛 run 38161747136](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/38161747136)，机械与模型 PASS，`auto/high`、`completed`、无图片、当次 4,690 tokens；[PR #30](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/30) 只更新验证账本并已合并；[收敛 run 38162100649](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/38162100649) 为 NOOP，模型/repair/publish 全 skipped | PASS / OBSERVED |
| Web UI | [实际升级 run 38161203336](https://github.com/LCYLYM/dsh-web-ui/actions/runs/38161203336)：32,359 tokens，仅 skill-explorer package.json 一行 maxHost 变更，原测试/构建/安装/Web smoke/卸载独立 PASS；[PR #9](https://github.com/LCYLYM/dsh-web-ui/pull/9) 等待审阅；最终引擎 [run 38161746094](https://github.com/LCYLYM/dsh-web-ui/actions/runs/38161746094) 正确 FROZEN，未重复调用模型 | 升级补丁 PASS / OBSERVED；默认分支尚未合入插件补丁 |
| Ankh | 实际修复 run `38161199614`；最终 pin 排队复测 `38161742105` 已取消，避免旧预算未落盘时再付费调用 | 尚待实际结果 |
| Whale | [实际修复 run 38160738314](https://github.com/LCYLYM/dsh-whale-report/actions/runs/38160738314) 的模型修复与独立 verifier PASS，2 轮、3,062,505 tokens，仅 maxHost / DSH peer-dev 范围 / pnpm-lock；最后推送分支 FAIL。原补丁在当前默认分支上重放，经最终引擎真实复验（macOS ARM64）PASS，再经正常 publisher 成功发布 [PR #12](https://github.com/LCYLYM/dsh-whale-report/pull/12)，没有新增模型调用；[最终去重 run 38163687040](https://github.com/LCYLYM/dsh-whale-report/actions/runs/38163687040) 正确冻结于该 open PR | 补丁 PASS / OBSERVED；原 Actions 发布 FAIL 事实保留，发布已恢复；待人工审阅 |
| Office | [真实 run 38160740018](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/actions/runs/38160740018) 第 2 轮独立 verifier PASS，但累计 5,355,737 tokens 超过原 4,000,000 额度，最终 `BUDGET_EXHAUSTED`，未交付补丁；账本发布又被 GitHub App 的 workflow 权限拒绝。[状态 PR #11](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/pull/11) 在当前默认分支保存原失败账本并合并，保留旧 verified、完整用量与历史，不重置额度 | BLOCKED / OBSERVED，不能记作升级成功 |

所有限额未增加。Anna `auto` 的实际费率未提供、也不匹配内置官方价格表；CNY 为未知，不能把原 `max_cny` 描述为账户账单级硬限。当前交付默认仍是人工审阅 PR，而不是无人审核合并社区插件源码。

Whale 新 peer 范围为 `^0.2.1-alpha.2`、dev 依赖固定该版；目标新版通过不代表修改后的全部旧版兼容。恢复 PR 保留原模型 campaign 的 3,062,505 tokens / 2 次机会，没有丢弃失败账本或伪造一个更便宜的全新 campaign。原 GitHub 推送失败的 CLI 未输出 stderr，仅观察到 exit 1，具体拒绝原因未证实；没有因此扩张 Actions 权限、force-push 或重做模型维修。

## 运行中预算止损

Office 暴露原有预算检查在完整模型轮次结束后才进行，不能及时中止长轮次。新增仅观察已有 DSH JSONL 用量账本的 1 秒监测；达到已报告额度时终止该 CLI 进程组，读账本失败也停止，墙钟超限保持 `BUDGET_EXHAUSTED` 而不是假报供应商超时。不增加代理服务器、后台服务或消费者配置开关。

同 SDK `0.2.1-alpha.2`、同 Anna `auto/high`、同只读 bash + sleep 12 秒任务、独立 home 的真实消融：control 正常完成，29.602 秒、3,300 tokens；监测组的实验阈值为 1,024，读到 1,611 tokens 后中止，11.135 秒、`aborted=true`、回合未完成，未再进行后续正常回合。实验没有改动消费者额度。一次请求会在报告用量前产生费用，因此 587-token 超出实验阈值的事实保留；不是供应商账单硬限，也不伪造逐请求零超额保证。134/134 单测通过，另保留最终检查。

Office 发布日志确认为 `refusing to allow a GitHub App to create or update workflow ... without workflows permission`：维修期间控制 workflow 已更新，旧发布分支仍携带旧 workflow。发布/维修发布/失败账本发布将先 checkout 当前默认分支，再用原 source SHA 核对；不一致时明确 `STALE_SOURCE`，不尝试推旧 workflow、不扩张权限，也不自动重做模型任务。Whale 的原 stderr 没有输出，不能将 Office 的精确拒绝原因冒充为 Whale 的已证实原因。
