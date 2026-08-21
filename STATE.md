# State

Current slice: R0 grilling 与设计基线 Draft 0.3

Project stage: technical

最近证据：

- 已建立独立 Git 仓库、`main` 基线与 `codex/design-foundation` worktree。
- 已刷新并回读参考项目的 33 份同目录 Codex 记录；原始记录位于被 Git 忽略的本地目录。
- 已核对 2026-08-21 的 NPM dist-tag；调研期间 `latest` 从 `0.1.0-rc.7` 先变为 `0.1.1-rc.1`、再变为 `0.1.1-rc.2`，证明必须采用 latest-convergence 而非逐发布排队。最新回读中 `latest=next=0.1.1-rc.2`。
- 已直接检查官方仓库与 NPM 发布包：`@deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2` 仍包含 `deepseek-v4-flash-vision-exp`，并声明 `inputModalities: [text, image]`；根 `@deepseek-ai/dsh@0.1.1-rc.2` 的完整 integrity 和内部依赖范围也已回读。
- 已核对 DeepSeek 2026-08-21 官方价格页：该视觉模型与 V4 Flash 同档，空闲时段价格为高峰的一半；高峰为北京时间 `09:00–12:00`、`14:00–18:00`。这些值只作为可覆盖且带 revision 的默认快照。
- 已确认 V1 是安装进单个插件仓库的自动维修机器人；中央托管、upstream 同步、`gh-aw` 依赖与 provider 重实现均不进 V1。
- 已确认 repair DSH 默认 `0.1.1-rc.2`（项目立项时 NPM latest）、repair model 默认 `deepseek-v4-flash-vision-exp`，二者和价格窗口均可覆盖，但每个 campaign 必须冻结实际解析值；同时已锁定差分兼容契约、三种交付模式、campaign 级预算、单次自动维修和 `N -> Y` 人工恢复语义。
- 已确认视觉由 repair model 提供；官方联网搜索由 DSH 独立 search provider 发起另一笔模型请求，不能混写为同一能力。
- 已确认 V1 只统计 DSH/DeepSeek 暴露的 token usage，并按默认官方价格映射估算；搜索缺少 usage 时只记调用次数，不做复杂预留，OpenAI-compatible 账单解析不进 V1。provider、base URL、key 环境引用和 model id 均可配置。
- 已确认同一个根 DSH 版本的实际安装内容发生变化时，Guardian 会重跑仓库测试、插件打包安装、dump-config、真实启动和 smoke 断言；Actions 仍会运行，但这一步不调用 repair model、不消耗模型 token，也不新建预算。只有测试失败且该版本已经用过自动维修，才要求用户执行现有 `N -> Y` reset。该行为不增加配置项。
- 已从公开正式仓库 `LCYLYM/dsh-attachments@028dc1f` 全新复制并创建独立 public fixture：`LCYLYM/dsh-attachments-guardian-fixture`。fixture `main@17edf22` 与远端一致、不是 GitHub fork、保留完整源历史，10/10 测试和 `npm pack --dry-run` 通过；README 已标明测试用途，`private: true` 防止误发 NPM。
- 已确认 M0 分两步：先在没有模型 key 的情况下证明监控、真实兼容测试、报告和去重；再在隔离测试分支恢复历史 `httpServer` 旧错误，验证模型维修和 PR。两个阶段都不开 auto-merge/direct-push。
- 已确认 repair DSH 默认可修改当前仓库内普通插件文件，包括源码、manifest、安装脚本、仓库测试和文档；不维护逐仓库长 allowlist。短禁止清单保护 workflow、Guardian 配置/lock、onboarding smoke contract、独立 verifier、secret/凭据和仓库外路径，最终 PASS 由这些不可修改的验收面决定。
- 已确认仓库测试可以随维修一起修改，但凡 diff 新增或修改测试文件、测试配置或测试命令，本次交付都强制降级为普通 PR；即使仓库开启 auto-merge/direct-push，也要人工审核该测试面变化。没有改测试面的维修仍遵循仓库所选交付模式。
- 已确认依赖只做与当前 DSH 故障直接相关的最小调整：允许修改已有 DSH 相关版本范围并同步 lockfile；禁止全量/无关升级和切换包管理器；新增/删除依赖、跨 major 升级或修改安装生命周期脚本时强制人工 PR，其余通过完整复验后可遵循所选交付模式。
- 已确认生成文件不按目录名猜测：有明确构建命令和对应源码时以源码为权威，verifier 必须在干净环境重建并要求已跟踪 `lib/dist` 逐字节一致，不可复现则失败；没有构建命令且 `lib` 是维护入口时把它当普通源码。可重复且一致的产物变化不额外强制人工 PR。
- 已确认普通仓库文件可以新增、修改和删除，不再按重命名、可执行文件或根目录配置做复杂分级；已有保护清单中的控制面和验收面同样不可删除，其他误删交给原始 build/test/pack/install/contract/verifier 判失败，不维护第二份关键文件清单。
- 已确认不设置改动文件数或增删行数的硬上限；报告只记录这些数据供人判断。防失控继续使用已有 token/CNY/墙钟/轮次预算、每版本一次自动维修、保护路径和独立 verifier，不增加新配置。
- 已确认 repair model secret 只在可信默认分支 SHA 的定时、手工或默认分支 push campaign 中使用，并且必须等无 key 检查确认不兼容后才注入；普通/fork PR、检出 PR 的 pull_request_target 和任意 ref 均不可获得。repair 与 publisher Git 写权限继续隔离。
- 已再次收紧产品范围：只维护 DSH 更新造成的插件兼容性。无关依赖升级、普通 CI 修复、代码质量整理和通用仓库维护不进入自动维修；其他能力只有确实支撑探测、验证、修复、交付和报告时才加入。
- 已确认默认每 6 小时检查一次 NPM latest 和实际安装图，支持手工立即检查，并在默认分支 Guardian 配置/lock 变化时触发；普通源码 push 不触发。cron 只负责唤醒，延迟或跨过中间版本时直接收敛到当时 latest。
- 已确认 onboarding 没有历史 verified 时，直接用本轮解析并冻结的 repair DSH（默认 rc.2）跑完整 gate 建立第一份基线；通过后才测试当前 latest，失败则 `ONBOARDING_BLOCKED` 且不调模型，不增加 baseline 配置项。
- 已确认 campaign 锁定启动时的默认分支 commit；发布前分支变化就将旧 attempt 标为 `STALE_SOURCE` 并禁止发布，下一次只先对新 commit 无模型复测。此前未调用模型则保留那一次维修机会，已经调用则源码变化不重置预算，仍需 reset 才能再次调模型。
- 已确认一目标版本一维修 PR；PR 未合并时 latest 变化，旧 PR 标记 `SUPERSEDED` 后自动关闭并保留历史，新目标从当前默认分支重新验证、必要时另开 PR，不 force-push 或复用旧 PR。
- 已确认插件薄 workflow 用完整 commit SHA 固定 Guardian 引擎并注释版本，不使用可移动 main/v1；V1 不做 Guardian 自升级检测或更新 PR。DSH 更新不改变该 SHA，未来确需升级时由用户手工改一行或重跑安装。
- 已确认 candidate 直接 PASS、无需修代码时仍提交 verified lock 和简短报告，以便下次可靠去重；默认小 PR，auto-merge/direct-push 开启时按对应模式交付，不改插件代码，也不增加另一套状态存储。
- 已确认默认 campaign 上限为 1,000,000 总 token、估算 10 元、60 分钟实际运行时间和最多 2 轮维修，任一先到即停；剩余 30% 时默认只发一次收敛消息，等待低价窗口不计入 60 分钟。全部数值可覆盖。

当前阶段门：用户明确要求继续 grilling。除调研与文档外，禁止安装 workflow、创建故障分支、配置 secret、调用模型或运行 Guardian；这不是技术阻塞，而是有意冻结实现。

下一步：继续一次一问完成剩余设计。只有用户明确宣布 grilling 结束并要求开工后，才制定并执行实现计划。
