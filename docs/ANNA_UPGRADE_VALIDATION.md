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

尚待记录最终不可变引擎 SHA、五个远端 run、真实维修 diff、发布 PR 和未满足项。单测或 fixture 成功不替代消费者验证。
