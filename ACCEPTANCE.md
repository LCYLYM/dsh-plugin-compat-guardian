# Acceptance

- R1 [open] 追踪 `@deepseek-ai/dsh` 当前 `latest` dist-tag，解析精确 version/root integrity 与实际安装依赖图 digest，并最终收敛到最新候选；surface: CI 运行记录与版本状态；evidence: 真实 registry/全新安装探测、过时任务 `SUPERSEDED` 和去重测试。
- R2 [open] repair runner 的仓库默认值为 DSH `0.1.1-rc.1`，允许显式覆盖，并把候选新版安装到隔离目录；`latest`/`target` 等动态配置也必须在 campaign 开始解析成不变的 version/integrity/依赖图；surface: 独立 DSH_HOME、工作目录和进程；evidence: 两个角色与制品隔离的真实运行记录。
- R3 [open] 使用上一次已知兼容 DSH 作为参照组，再在候选 DSH 中安装真实打包的插件并执行同一套 gate；surface: build/test/pack/profile/CLI/Web/API/插件行为；evidence: 只变更 DSH 这一基线变量的差分结果。
- R4 [open] 兼容通过时生成去敏报告并更新 `.dsh-compat.lock.json#verified`；无代码改动也要提交“已验证该 DSH 版本”的窄记录；surface: lock/commit/PR/Actions；evidence: diff、commit、CI、制品 integrity 与报告回读。
- R5 [open] 兼容失败时由 repair DSH 在受限 worktree 中诊断和修复，并由无共享结论权的 verifier 重新执行原套验收；surface: 隔离 worktree/branch；evidence: 失败复现、修复 diff、未被弱化的回归结果。
- R6 [open] 预算按 `repository + target DSH version` 的整个 campaign 累计，不在每个 Actions run 重置；累计 DSH/DeepSeek 暴露的 token usage，并按版本化价格表估算人民币，另设墙钟上限，剩余 30% 时可选 steer 收敛；surface: 预算账本与控制事件；evidence: 跨 run 累计、单次阈值消息、基于已报告 usage 的硬停止和价格映射版本测试。
- R7 [open] 每个目标 DSH 版本只自动启动一个有界 campaign；失败后冻结，定时触发不再调模型，直到收到明确新信号；surface: 状态机、campaign Issue 和 Actions concurrency；evidence: 重放、重复事件、失败冻结和自身提交测试。
- R8 [open] repair DSH 直接使用它自身支持的 provider/settings/credential 契约；仓库可配置 provider id、base URL、key 的环境变量引用和 model id，API key 仅由仓库 secret 或原生 CI 身份注入，不写入日志、报告或 commit；surface: DSH 原生 provider 与 CI secret 边界；evidence: 默认与自定义 route 的真实请求、usage 事件、secret 扫描与脱敏测试。
- R9 [open] V1 通过 onboarding PR 安装到当前插件仓库，不引入中央托管、GitHub App 多仓库控制面或 `gh-aw` 运行时依赖；surface: 薄 workflow + reusable workflow/orchestrator；evidence: 在一个真实插件仓库中从安装到运行的闭环。
- R10 [open] onboarding 时由 DSH 从 manifest、源码、README 和现有测试自动发现 smoke surface，接受用户提示，生成机器可执行契约供用户首次审核；surface: `.dsh-compat.yml` 与 `compat/smoke.*`；evidence: 已审核契约、覆盖范围报告和“维修过程不得改测试”回归。
- R11 [open] 支持 `pull-request`（默认）、`auto-merge` 和显式开启的 `direct-push`；三种模式均由独立 publisher 持写凭据，不由 repair DSH 直接 push；surface: GitHub branch/PR/default branch；evidence: 权限隔离、branch protection 失败和三模式端到端测试。
- R12 [open] 预算耗尽后，用户可通过提高额度或提交 `.dsh-compat.lock.json` 中 `N -> Y` 的单次 reset 边沿恢复同版本 campaign；同一 reset commit 只消费一次，静态 `Y` 不重复触发；surface: push diff、campaign 账本和恢复状态；evidence: rerun/schedule 幂等性与二次手工 reset 测试。
- R13 [open] 安装到哪个仓库就只维护哪个仓库；原创插件与魔改 fork 使用同一路径，V1 不读写、同步或通知 upstream；surface: 当前 repository/default branch；evidence: fork 仓库内的独立兼容修复且无任何 upstream 写操作。
- R14 [open] 最终状态通过 GitHub Summary/Issue 报告，并可选通知 email、Telegram 或通用 webhook；通知是 orchestrator 内的窄适配器，不是独立服务；surface: 去重通知与 secret 边界；evidence: PASS/BLOCKED/SUPERSEDED 的真实消息回读。
- R15 [open] repair 默认 provider/model 为 `deepseek-official/deepseek-v4-flash-vision-exp`，允许仓库覆盖但不允许运行中漂移或失败后静默回退；视觉断言必须真实传图。启用 DeepSeek 搜索时，将其作为独立 DSH provider 调用，至少记录模型、调用次数和结构化搜索结果；缺少 usage 不阻塞维修，也不做保守整笔预留；surface: DSH model catalog、附件请求与 search seam；evidence: 已发布 DSH 制品中的 `text,image` 声明、真实视觉 probe、真实搜索 probe 和调用账本。
- R16 [open] 默认价格快照采用 DeepSeek 2026-08-21 官方 CNY 费率和 `Asia/Shanghai` 峰谷窗口，允许仓库覆盖；只有匹配价格映射的 route 才估算 CNY，自定义 route 无映射时仍统计 token 并把 CNY 标为 unknown；版本探测和不调用 repair model 的兼容测试立即执行，模型维修默认等待低价窗口，手工运行可显式立即执行；surface: scheduler、price revision 与 campaign 状态；evidence: 峰/谷边界、未知费率、cron 延迟、等待期间 latest 变化和手工 override 测试。
- R17 [open] 根 DSH 版本不变但全新安装得到的内部依赖快照变化时，自动重跑仓库测试、插件 pack/install、dump-config、真实 DSH 启动和插件 smoke 断言；这会运行 GitHub Actions，但暂不调用 repair model、不消耗模型 token，也不新建预算。若测试失败且该根版本已经用过自动维修，则冻结并提示用户执行已有的 `N -> Y` reset；surface: lock/Actions/Issue；evidence: 同版本两份依赖快照、完整兼容复测、一次自动维修门和 reset 恢复测试。
- R18 [open] M0 分两阶段验收：第一阶段不配置模型 key，只证明监控、真实兼容测试、报告、lock 和去重；第二阶段才在隔离测试分支恢复历史 `httpServer` 旧接口错误，启用 repair model，要求机器人产出通过原始 verifier 的修复 PR。两阶段均关闭 auto-merge/direct-push；surface: public fixture branch/Actions/PR；evidence: 无模型运行记录、受控失败复现、修复 diff 和可合并但未自动合并的 PR。

Current slice: R0 需求与架构设计

Project stage: technical
