# Acceptance

- R1 [open] 监测 `@deepseek-ai/dsh` 新版本，并为每个唯一版本只创建一次兼容任务；surface: CI 运行记录与版本状态；evidence: 真实 registry/version 探测和去重测试。
- R2 [open] 使用固定稳定版 DSH 作为修复执行器，把候选新版安装到隔离目录；surface: 独立 DSH_HOME、工作目录和进程；evidence: 两个版本与目录隔离的真实运行记录。
- R3 [open] 在候选新版中安装目标仓库插件并执行声明式兼容矩阵；surface: CLI/Web/API/插件资源；evidence: 真实安装、启动、插件可见性与仓库自有测试。
- R4 [open] 兼容通过时生成报告并提交“支持该 DSH 版本”的窄改动；surface: Git commit/PR；evidence: diff、commit、CI 与报告回读。
- R5 [open] 兼容失败时由稳定版 DSH 在受限权限下诊断和修复，并重新执行同一验收矩阵；surface: 隔离 worktree/branch；evidence: 失败复现、修复 diff、回归结果。
- R6 [open] 支持按 token 与人民币估算的单次预算；30% 剩余额度时可选地向 DSH 发收敛消息；surface: 预算账本与控制事件；evidence: 硬停止、阈值消息、价格映射版本测试。
- R7 [open] 防止版本轮询、CI、自提交、自动修复和重试形成死循环；surface: 状态机与 GitHub Actions concurrency；evidence: 重放、重复事件、失败重试和自身提交测试。
- R8 [open] `base_url` 可配置、API key 仅由仓库 secret 注入且不写入日志/报告/commit；surface: CI secret 边界；evidence: secret 扫描与脱敏测试。

Current slice: R0 需求与架构设计

Project stage: technical

