# State

Current slice: R0 需求讨论与设计基线 Draft 0.3

Project stage: technical

最近证据：

- 已建立独立 Git 仓库、`main` 基线与 `codex/design-foundation` worktree。
- 已刷新并回读参考项目的 33 份同目录 Codex 记录；原始记录位于被 Git 忽略的本地目录。
- 已核对 2026-08-21 的 NPM dist-tag；调研期间 `latest` 从 `0.1.0-rc.7` 变为 `0.1.1-rc.1`，证明必须采用 latest-convergence 而非逐发布排队。
- 已直接检查官方仓库当前提交与 NPM 发布包：`@deepseek-ai/dsh-llm-deepseek@0.1.1-rc.1` 已包含 `deepseek-v4-flash-vision-exp`，并声明 `inputModalities: [text, image]`；不是只存在于未发布源码。
- 已核对 DeepSeek 2026-08-21 官方价格页：该视觉模型与 V4 Flash 同档，空闲时段价格为高峰的一半；高峰为北京时间 `09:00–12:00`、`14:00–18:00`。这些值只作为可覆盖且带 revision 的默认快照。
- 已确认 V1 是安装进单个插件仓库的自动维修机器人；中央托管、upstream 同步、`gh-aw` 依赖与 provider 重实现均不进 V1。
- 已确认 repair DSH 默认 `0.1.1-rc.1`、repair model 默认 `deepseek-v4-flash-vision-exp`，二者和价格窗口均可覆盖，但每个 campaign 必须冻结实际解析值；同时已锁定差分兼容契约、三种交付模式、campaign 级预算、单次自动维修和 `N -> Y` 人工恢复语义。
- 已确认视觉由 repair model 提供；官方联网搜索由 DSH 独立 search provider 发起另一笔模型请求，不能混写为同一能力。

当前阻塞：无。未决产品细节仅保留在 `docs/DESIGN.md` 的“待继续 grill”小节，不得用旧问题覆盖已确认决策。

下一步：继续锁定少量未决语义（独立搜索请求缺少精确 usage 时采用何种保守预算、同一根 DSH 版本下依赖图漂移如何触发、首个真实小样）；用户发出实现信号后，打通一个真实插件仓库的窄闭环。
