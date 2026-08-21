# State

Current slice: R0 grilling 与设计基线 Draft 0.3

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
- 已确认 V1 只统计 DSH/DeepSeek 暴露的 token usage，并按默认官方价格映射估算；搜索缺少 usage 时只记调用次数，不做复杂预留，OpenAI-compatible 账单解析不进 V1。provider、base URL、key 环境引用和 model id 均可配置。
- 已确认同一个根 DSH 版本的实际安装内容发生变化时，Guardian 会重跑仓库测试、插件打包安装、dump-config、真实启动和 smoke 断言；Actions 仍会运行，但这一步不调用 repair model、不消耗模型 token，也不新建预算。只有测试失败且该版本已经用过自动维修，才要求用户执行现有 `N -> Y` reset。该行为不增加配置项。
- 已从公开正式仓库 `LCYLYM/dsh-attachments@028dc1f` 全新复制并创建独立 public fixture：`LCYLYM/dsh-attachments-guardian-fixture`。fixture `main@17edf22` 与远端一致、不是 GitHub fork、保留完整源历史，10/10 测试和 `npm pack --dry-run` 通过；README 已标明测试用途，`private: true` 防止误发 NPM。
- 已确认 M0 分两步：先在没有模型 key 的情况下证明监控、真实兼容测试、报告和去重；再在隔离测试分支恢复历史 `httpServer` 旧错误，验证模型维修和 PR。两个阶段都不开 auto-merge/direct-push。
- 已确认 repair DSH 默认可修改当前仓库内所有已跟踪的插件文件，包括源码、manifest、安装脚本、仓库测试和文档；不维护逐仓库长 allowlist。短禁止清单保护 workflow、Guardian 配置/lock、onboarding smoke contract、独立 verifier、secret/凭据和仓库外路径，最终 PASS 由这些不可修改的验收面决定。
- 已确认仓库测试可以随维修一起修改，但凡 diff 新增或修改测试文件、测试配置或测试命令，本次交付都强制降级为普通 PR；即使仓库开启 auto-merge/direct-push，也要人工审核该测试面变化。没有改测试面的维修仍遵循仓库所选交付模式。
- 已确认依赖只做与当前 DSH 故障直接相关的最小调整：允许修改已有 DSH 相关版本范围并同步 lockfile；禁止全量/无关升级和切换包管理器；新增/删除依赖、跨 major 升级或修改安装生命周期脚本时强制人工 PR，其余通过完整复验后可遵循所选交付模式。
- 已确认生成文件不按目录名猜测：有明确构建命令和对应源码时以源码为权威，verifier 必须在干净环境重建并要求已跟踪 `lib/dist` 逐字节一致，不可复现则失败；没有构建命令且 `lib` 是维护入口时把它当普通源码。可重复且一致的产物变化不额外强制人工 PR。

当前阶段门：用户明确要求继续 grilling。除调研与文档外，禁止安装 workflow、创建故障分支、配置 secret、调用模型或运行 Guardian；这不是技术阻塞，而是有意冻结实现。

下一步：继续一次一问完成剩余设计。只有用户明确宣布 grilling 结束并要求开工后，才制定并执行实现计划。
