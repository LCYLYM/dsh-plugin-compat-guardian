# State

Current slice: M0 本地 PASS；M1 公开 GitHub Actions 边界（R1/R2/R4/R9/R10/R17/R18/R27/R28/R31/R32/R41/R44/R47/R48/R49/R50/R51）

Project stage: technical

最近证据：

- Guardian M0 运行时已提交为 `8fb702d`；包含 12 项通过的确定性测试、完整 SHA workflow 检查、去敏、并发锁、无模型 verifier 和 onboarding 生成器。
- 已完成本地 M0 真实闭环：fixture 隔离分支 `automation/dsh-compat/onboarding@cf77d6e` 对精确 `@deepseek-ai/dsh@0.1.1-rc.2` 完成 10/10 仓库测试、真实 pack、profile add、dump-config、真实 `dsh web`、插件 `/community-multimedia-webui-input/v1/health` 断言、remove 和清理 dump，状态 `PASS`。
- 本次 candidate root integrity 为 `sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==`，实际 pnpm graph digest 为 `11cbc898fa8080f58da7dd75abe6f43f1bf6a159f258bd05ce82b20925c80826`，插件 tarball SHA-256 为 `8ae8c0fd48e042a02876123f648d5fafbaf03cbf1266a32d11863ef9fe62dd2d`。
- verified lock 提交后，在干净工作树重跑同一 candidate 得到相同 snapshot key `509b98a0fe2f5e87e995413a79de206bb1ca746411b42c343fd7987d2cc5a65d` 和 `NOOP`；snapshot 使用排除机器 lock 的 tracked-tree digest，已证明 Guardian 自己的 lock commit 不会形成完整测试循环。
- M0 报告已改为成功步骤只保存命令、退出码、耗时、stdout/stderr 字节数与 SHA-256；临时路径显示为 `<GUARDIAN_TEMP>`。对报告与 lock 的本机路径、Authorization 和 credential-like 值扫描为零命中。
- 已通过精确 `0.1.1-rc.2` 的真实 DSH headless 进程验证 `deepseek-official/deepseek-v4-flash-vision-exp`：普通模型调用退出码 0、结果非空，最终 usage 事件为 input 10,676、output 104、cache-read 0、reasoning 92 tokens。
- 已真实调用同一模型的 DSH native search：session 中出现一次 `web/deepseek-search-llm-request`、一次 `tool/call` 和一次 `tool/result`；请求 endpoint 为 `https://api.deepseek.com/anthropic/v1/messages`，model 为 `deepseek-v4-flash-vision-exp`，tool type 为 `web_search_20250305`。搜索 provider 未暴露独立 usage，符合既定“记调用次数、不伪造 token”边界。
- 两次真实模型 probe 都只通过一次性进程环境注入 key；临时 DSH_HOME 中 credential-like 值扫描为零，随后删除会话临时目录。尚未执行真实图片输入、自动维修或 GitHub secret 配置。
- 已实现 reusable workflow 与薄 workflow 生成：candidate/verifier job 只读，publisher job 才有 Git 写权限，所有外部 Actions 固定完整 SHA，默认 runner 单一 `ubuntu-24.04`；当前只完成本地 YAML/单元验证，尚未发布 Guardian 远端仓库或执行 GitHub run。
- 已建立独立 Git 仓库、`main` 基线与 `codex/design-foundation` worktree。
- 已刷新并回读参考项目的 33 份同目录 Codex 记录；原始记录位于被 Git 忽略的本地目录。
- 已核对 2026-08-21 的 NPM dist-tag；调研期间 `latest` 从 `0.1.0-rc.7` 先变为 `0.1.1-rc.1`、再变为 `0.1.1-rc.2`，证明必须采用 latest-convergence 而非逐发布排队。最新回读中 `latest=next=0.1.1-rc.2`。
- 已直接检查官方仓库与 NPM 发布包：`@deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2` 仍包含 `deepseek-v4-flash-vision-exp`，并声明 `inputModalities: [text, image]`；根 `@deepseek-ai/dsh@0.1.1-rc.2` 的完整 integrity 和内部依赖范围也已回读。
- 已核对 DeepSeek 2026-08-21 官方价格页：该视觉模型与 V4 Flash 同档，空闲时段价格为高峰的一半；高峰为北京时间 `09:00–12:00`、`14:00–18:00`。这些值只作为可覆盖且带 revision 的默认快照。
- 已确认 V1 是安装进单个插件仓库的自动维修机器人；中央托管、upstream 同步、`gh-aw` 依赖与 provider 重实现均不进 V1。
- 已确认 repair DSH 默认 `0.1.1-rc.2`（项目立项时 NPM latest）、repair model 默认 `deepseek-v4-flash-vision-exp`，二者和价格窗口均可覆盖，但每个 campaign 必须冻结实际解析值；同时已锁定差分兼容契约、三种交付模式、campaign 级预算、单次自动维修和 `N -> Y` 人工恢复语义。
- 已确认视觉由 repair model 提供；官方联网搜索由 DSH 独立 search provider 发起另一笔模型请求，不能混写为同一能力。
- 已确认 V1 只统计 DSH/DeepSeek 暴露的 token usage，并按默认官方价格映射估算；搜索缺少 usage 时只记调用次数，不做复杂预留，OpenAI-compatible 账单解析不进 V1。provider、base URL、key 环境引用和 model id 均可配置。
- 已确认同一个根 DSH 版本的实际安装内容发生变化时，Guardian 会重跑仓库测试、插件打包安装、dump-config、真实启动和 smoke 断言；这一步不调用 repair model，也不新建预算。若 contract 要求真实模型 smoke，其 usage 仍计入同一版本 campaign。只有测试失败且该版本已经用过自动维修，才要求用户执行现有 `N -> Y` reset。该行为不增加顶层配置项。
- 已从公开正式仓库 `LCYLYM/dsh-attachments@028dc1f` 全新复制并创建独立 public fixture：`LCYLYM/dsh-attachments-guardian-fixture`。fixture `main@17edf22` 与远端一致、不是 GitHub fork、保留完整源历史，10/10 测试和 `npm pack --dry-run` 通过；README 已标明测试用途，`private: true` 防止误发 NPM。
- 已确认 M0 分两步：先在没有模型 key 的情况下证明监控、真实兼容测试、报告和去重；再在隔离测试分支恢复历史 `httpServer` 旧错误，验证模型维修和 PR。两个阶段都不开 auto-merge/direct-push。
- 已确认 repair DSH 默认可修改当前仓库内普通插件文件，包括源码、manifest、安装脚本、仓库测试和文档；不维护逐仓库长 allowlist。短禁止清单保护 workflow、Guardian 配置/lock、onboarding smoke contract、独立 verifier、secret/凭据和仓库外路径，最终 PASS 由这些不可修改的验收面决定。
- 已确认仓库测试可以随维修一起修改，但凡 diff 新增或修改测试文件、测试配置或测试命令，本次交付都强制降级为普通 PR；即使仓库开启 auto-merge/direct-push，也要人工审核该测试面变化。没有改测试面的维修仍遵循仓库所选交付模式。
- 已确认依赖只做与当前 DSH 故障直接相关的最小调整：允许修改已有 DSH 相关版本范围并同步 lockfile；禁止全量/无关升级和切换包管理器；新增/删除依赖、跨 major 升级或修改安装生命周期脚本时强制人工 PR，其余通过完整复验后可遵循所选交付模式。
- 已确认生成文件不按目录名猜测：有明确构建命令和对应源码时以源码为权威，verifier 必须在干净环境重建并要求已跟踪 `lib/dist` 逐字节一致，不可复现则失败；没有构建命令且 `lib` 是维护入口时把它当普通源码。可重复且一致的产物变化不额外强制人工 PR。
- 已确认普通仓库文件可以新增、修改和删除，不再按重命名、可执行文件或根目录配置做复杂分级；已有保护清单中的控制面和验收面同样不可删除，其他误删交给原始 build/test/pack/install/contract/verifier 判失败，不维护第二份关键文件清单。
- 已确认不设置改动文件数或增删行数的硬上限；报告只记录这些数据供人判断。防失控继续使用已有 token/CNY/墙钟/轮次预算、每版本一次自动维修、保护路径和独立 verifier，不增加新配置。
- 已确认模型 secret 只在可信默认分支 SHA 的定时、手工或默认分支 push campaign 中使用；已审核 contract 要求的 candidate 固定 smoke 可临时注入一次，repair DSH 必须等无 key 检查确认不兼容后才注入。普通/fork PR、检出 PR 的 pull_request_target 和任意 ref 均不可获得，publisher Git 写权限继续隔离。
- 已再次收紧产品范围：只维护 DSH 更新造成的插件兼容性。无关依赖升级、普通 CI 修复、代码质量整理和通用仓库维护不进入自动维修；其他能力只有确实支撑探测、验证、修复、交付和报告时才加入。
- 已确认默认每 6 小时检查一次 NPM latest 和实际安装图，支持手工立即检查，并在默认分支 Guardian 配置、lock 或已审核 smoke contract 变化时触发；普通插件源码 push 不触发。cron 只负责唤醒，延迟或跨过中间版本时直接收敛到当时 latest。
- 已确认 onboarding 没有历史 verified 时，直接用本轮解析并冻结的 repair DSH（默认 rc.2）跑完整 gate 建立第一份基线；通过后才测试当前 latest，失败则 `ONBOARDING_BLOCKED` 且不调模型，不增加 baseline 配置项。
- 已确认 campaign 锁定启动时的默认分支 commit；发布前分支变化就将旧 attempt 标为 `STALE_SOURCE` 并禁止发布，下一次只先对新 commit 无模型复测。此前未调用模型则保留那一次维修机会，已经调用则源码变化不重置预算，仍需 reset 才能再次调模型。
- 已确认一目标版本一维修 PR；PR 未合并时 latest 变化，旧 PR 标记 `SUPERSEDED` 后自动关闭并保留历史，新目标从当前默认分支重新验证、必要时另开 PR，不 force-push 或复用旧 PR。
- 已确认插件薄 workflow 用完整 commit SHA 固定 Guardian 引擎并注释版本，不使用可移动 main/v1；V1 不做 Guardian 自升级检测或更新 PR。DSH 更新不改变该 SHA，未来确需升级时由用户手工改一行或重跑安装。
- 已确认 candidate 直接 PASS、无需修代码时仍提交 verified lock，以便下次可靠去重；简短报告放 PR/Issue/Actions Summary 并由 lock 保存 URL，不提交逐版本报告文件。默认小 PR，auto-merge/direct-push 开启时按对应模式交付，不改插件代码。
- 已确认默认 campaign 上限为 1,000,000 总 token、估算 10 元、60 分钟实际运行时间和最多 2 轮维修，任一先到即停；剩余 30% 时默认只发一次收敛消息，等待低价窗口不计入 60 分钟。全部数值可覆盖。
- 已确认 repair DSH 默认允许使用 DeepSeek 官方搜索但不要求每轮都搜；提示词建议查官方标准、文档、源码和 NPM 元数据作辅助。Guardian 不设搜索专属次数/uses 上限，失败只记录并继续本地诊断，不换模型、不代替 verifier；整体 60 分钟和 provider 限制仍有效。
- 已确认 candidate 默认不调用模型；只有 onboarding 已审核 contract 明确 `requires_model_turn: true` 时，才在无 Git 写权限的独立 smoke step 用仓库同一套 provider/model/Secret 跑一次固定真实回合。usage 计入同一版本预算，缺 key 为 `BLOCKED`；V1 删除 `ephemeral-proxy` 方案，并明确 candidate 在该 step 内能接触 key 的风险。
- 已确认真实模型 smoke 不匹配具体回答措辞，也不做主观质量评分；PASS 只看本轮冻结输入被插件处理、附件/图片确实进入请求、provider 成功且 DSH 收到非空结果。用户可在 onboarding contract 增加更强的确定性断言，repair 不得修改。
- 已确认真实模型 smoke 默认只测 candidate，contract 可选旧/new differential；repair 后 candidate 必须复测，相同快照/插件树/contract/输入自动去重。smoke 立即执行，不等待低价。
- 已确认模型 smoke 外部错误只立即重试一次，再失败进入 `BLOCKED_EXTERNAL`，不维修、不由六小时 schedule 循环重试，等待手工运行、相关配置变化或新目标版本。
- 已确认 fixture 默认使用已审核固定文件，也可允许 DSH 在隔离区自行寻找、生成或下载公开文件；选择后冻结实际内容/来源/hash，整个 campaign 比较与复测不得更换。
- 已确认模型 smoke 的 commit/PR/report 只保存机械元数据和脱敏错误；失败脱敏 artifact 保留 7 天，不持久化 key、认证头、完整请求或完整模型对话。
- 已确认 contract 本身需要改变时结束当前维修为 `BLOCKED_CONTRACT`，自动另开只含 contract/fixture 的人审 PR；合并后立即完整复测，但不恢复已消耗的预算、attempt 或自动维修机会，也不与代码修复混合。
- 已确认手工运行或相关 provider/contract 配置提交可让 `BLOCKED_EXTERNAL` 再试一次 smoke，无需 `resetBudget`；这不重置维修消耗，新目标版本才使用新 campaign。
- 已确认 lock 只保存机器状态和 report URL，详细报告放 PR/Issue/Actions Summary，不提交逐版本报告文件；direct-push commit 写目标版本与 campaign Issue URL。
- 已确认每个目标只发布一个整理后的最终 bot commit，中间失败轮次保留在评论/Issue/短期 artifact；contract-change PR 独立。
- 已确认 Actions Summary 每次生成；email/TG/webhook 只对首次等待低价、一次 30% 提醒和 PASS/BLOCKED/SUPERSEDED 状态变化去重发送，NOOP 不通知。
- 已确认 Node 优先读取仓库 `.node-version`、`.nvmrc`、engines，无声明默认 Node 24 LTS；包管理器优先 packageManager/唯一 lockfile，V1 支持 npm/pnpm/yarn、默认 npm，冲突或 Bun 明确阻塞。所有精确解析值写入证据。
- 已确认默认单个 `ubuntu-24.04` runner，可覆盖一个 label，不做默认 OS matrix。
- 已确认首次安装入口为 `npx dsh-plugin-compat-guardian onboard`：临时目录、新分支、有 `gh` 自动开 onboarding PR、无 `gh` 留分支与命令，不直接写默认分支或持久化本地凭据。
- 已确认 publisher 默认使用 `GITHUB_TOKEN` 并接受 GitHub 要求人工批准 bot PR checks；真正无人值守 auto-merge 才可选 publisher-only 细粒度 token，V1 不强制额外 token 或 GitHub App。

当前阶段门：用户已于 2026-08-21 明确结束 grilling，并授权白皮书、完整落地列表和 MVP 验证。M0 本地真实闭环已 PASS；用户随后提供可用于测试/实际运行的模型凭据，普通 DSH 与 native search 最小 probe 已 PASS，但 key 尚未写入仓库或 GitHub。M1 需要先发布 Guardian 引擎并跑公开 fixture Actions；M2 才创建历史接口故障并运行 repair。auto-merge/direct-push 继续关闭。

下一步：获得公开创建 Guardian 远端仓库的明确授权后，推送当前分支，用完整 commit SHA 重新生成 fixture onboarding workflow并执行公开 Actions 与 PR。M1 无模型闭环通过后，再单独进入受控 `httpServer` 故障维修；模型 Secret 只在 M2 的可信默认分支 job 中配置。
