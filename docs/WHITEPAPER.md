# DSH Plugin Compatibility Guardian 白皮书

版本：0.1-draft
日期：2026-08-21
状态：设计已冻结，M0 本地真实验证 PASS，M1 公开 Actions 待执行

## 摘要

DeepSeek Harness（DSH）仍在快速发布。一个插件今天能装、能启动、能处理请求，不代表下一次 `npx @deepseek-ai/dsh web` 拉到新制品后仍然兼容。插件作者通常没有精力持续盯版本、重搭环境、复现问题、修代码并发布说明。

Guardian 是安装进插件仓库的 GitHub Actions 维修机器人。它定时查看 NPM `latest`，把候选 DSH 和插件放进一次性隔离目录，运行真实测试、打包、安装、配置检查、`dsh web` 启动和插件专属断言。若全部通过，它只更新一条精确的已验证记录；若确认是 DSH 变化造成的不兼容，它才调用一套固定的 repair DSH，在预算内修复，并由不受 repair 控制的 verifier 复验，最终交付 PR。仓库也可显式开启自动合并或直接推送，但默认都关闭。

产品只解决一件事：**让一个 DSH 插件仓库持续兼容当前最新 DSH**。它不是通用依赖更新器、通用 CI 修复器，也不建设中央托管平台。

## 1. 痛点

手工维护通常会断在四处：

1. 只看版本号，不验证今天全新安装得到的内部依赖是否已经变化。
2. 只跑插件单测，不验证插件能否被真实 DSH profile 安装、加载和启动。
3. 让维修模型自己宣布成功，或者让它同时修改测试标准，结果不可相信。
4. 定时任务失败后反复调用模型，形成烧 token、刷 PR、刷通知的死循环。

Guardian 把这四件事改成机械约束：冻结制品、真实消费面测试、独立判定、每目标一次自动维修和跨 run 累计预算。

## 2. 第一性原理

### 2.1 一次只移动一个基线变量

检测 DSH 兼容性时，插件 commit、Node、包管理器、测试契约和输入都冻结，只替换 DSH 候选制品。这样失败才有资格被归因于 DSH 变化。

### 2.2 agent 只能提案，verifier 才能判 PASS

repair DSH 可以读代码、查文档、改普通插件文件，但不能修改 Guardian workflow、配置、lock、兼容契约或独立 verifier。最终结果只取决于原始 gate 的真实运行结果。

### 2.3 权限和预算必须是代码门，不是提示词

candidate 默认没有模型 key 和 Git 写权限；repair 有模型 key但没有发布凭据；publisher 有 Git 写权限但不运行 repair。token、人民币估算、时间和轮次都由 orchestrator 在请求前检查。

### 2.4 状态以仓库为准

机器状态保存在 `.dsh-compat.lock.json`，详细人类报告放 GitHub Actions Summary、PR 或 campaign Issue。V1 不引入数据库、后台服务或 GitHub App。

## 3. 使用者看到的最小流程

首次安装：

```bash
npx dsh-plugin-compat-guardian onboard
```

命令在新分支生成四类内容：

- `.dsh-compat.yml`：少量可读配置；
- `.dsh-compat.lock.json`：机器状态和已验证基线；
- `compatibility/dsh-smoke.yml`：人审核的插件专属断言；
- `.github/workflows/dsh-compat.yml`：固定到 Guardian 完整 commit SHA 的薄 workflow。

用户审核并合并一次 onboarding PR，随后定时任务每六小时检查一次。平时无变化就是 `NOOP`，不会通知。发现变化后才完整测试；通过则提交 lock 更新，不通过才进入维修。

模型 Secret 始终通过 GitHub Actions Secret 注入。配置里只写 Secret 对应的环境变量名，不写 key 本身。

## 4. 系统边界

```text
NPM registry
    |
    v
detector/resolver -----> frozen campaign snapshot
                              |
                    +---------+---------+
                    |                   |
                    v                   v
             candidate DSH        baseline DSH
             no Git token         no Git token
             no model key*        same verifier
                    |                   |
                    +---------+---------+
                              |
                        deterministic gates
                              |
                    PASS -----+----- FAIL caused by DSH
                     |                    |
                     v                    v
                  publisher         repair DSH
                  Git token         model key, no Git token
                     ^                    |
                     +---- verifier <----+

* 只有已审核 contract 明确要求真实模型 smoke 时，candidate 的独立 smoke
  step 才临时获得模型 Secret；该 step 仍没有 Git 写权限。
```

四个角色不能合并成一个进程权限：

| 角色 | 能读插件代码 | 能用模型 key | 能改隔离 worktree | 能写 GitHub |
| --- | --- | --- | --- | --- |
| detector/candidate | 是 | 默认否 | 否 | 否 |
| repair DSH | 是 | 是 | 是 | 否 |
| verifier | 是 | 仅 contract 必需时 | 否 | 否 |
| publisher | 只读已验证产物 | 否 | 只整理最终提交 | 是 |

## 5. 什么才算同一个候选

根版本号不够。Guardian 的候选身份至少包含：

- `@deepseek-ai/dsh` 精确版本；
- NPM tarball integrity；
- 一次全新安装得到的 lockfile/依赖图 digest；
- 精确 Node 版本、包管理器版本和 runner OS；
- 插件 base commit、排除机器 lock 后的受跟踪源码树 digest、插件 tarball hash；
- smoke contract hash；
- 真实模型 smoke 启用时的冻结输入 hash。

根版本仍是 `0.1.1-rc.2`，但 `^0.1.1-rc.2` 解析出的内部包变化，也会形成新的 snapshot 并重跑完整 gate。同一个根版本不会因此获得新维修预算；如果自动维修机会已经用过，失败后仍需用户明确 reset。仅提交 Guardian 自己生成的 lock 不改变源码树 digest，所以下一轮会正确得到 `NOOP`，不会形成“写 lock 又触发完整测试”的自循环。

## 6. 状态机

| 状态 | 人话含义 | 下一步 |
| --- | --- | --- |
| `NOOP` | 当前安装快照已验证，什么都不做 | 等下次唤醒 |
| `DETECTING` | 正在解析 latest 和真实依赖图 | 生成冻结 snapshot |
| `VERIFYING` | 正在跑无模型兼容 gate | PASS 或分类失败 |
| `WAITING_FOR_PRICE` | 已证明确需维修，默认等待低价窗口 | 到窗后 repair；latest 变化则 supersede |
| `REPAIRING` | 固定 repair DSH 正在有界修改 | 进入独立复验 |
| `PASS` | 原始 gate 全部真实通过 | publisher 交付一次最终 commit |
| `BLOCKED` | 本目标不能再自动前进 | 等预算增加、reset 或明确新信号 |
| `BLOCKED_CONFIG` | Key、provider、model 或 base URL 配置有问题 | 修正配置/Secret 后手工运行；schedule 不重复调模型 |
| `BLOCKED_EXTERNAL` | provider timeout/429/5xx 重试一次仍失败 | 手工运行、相关配置变化或新目标恢复 |
| `BLOCKED_CONTRACT` | 代码无法在现有契约下合理修复，契约可能需调整 | 单独开 contract PR，人审后重测 |
| `ONBOARDING_BLOCKED` | 初始稳定版自身都不能通过 | 先修仓库/契约，不调用 repair |
| `STALE_SOURCE` | 维修期间默认分支已有新提交 | 对新 SHA 先无模型重测 |
| `SUPERSEDED` | PR 未合并时 latest 已更新 | 关闭旧 PR，按新目标重开 campaign |

定时唤醒不是“再试一次模型”。失败状态会被 lock 去重；同一目标默认只自动维修一次。

## 7. 兼容 gate

完整 gate 按固定顺序运行，前一步失败就保留证据并停止：

1. 按仓库声明解析 Node 和 npm/pnpm/yarn；声明冲突或 Bun 在 V1 明确阻塞。
2. 执行仓库原有测试。
3. 执行真实 `npm pack`，记录 tarball SHA-256。
4. 在全新目录安装精确 candidate DSH，记录根 integrity 和依赖图 digest。
5. 在全新 `DSH_HOME` 中执行 `dsh plugin --profile web add <真实 tarball>`。
6. 执行 `--dump-config`，证明插件进入 profile 组合。
7. 启动真实 `dsh web`，等待 HTTP ready。
8. 执行 onboarding contract 中的插件专属 HTTP/进程/文件断言。
9. 若 contract 要求，执行一次冻结输入的真实模型 smoke。
10. 停止进程、remove 插件、再次 dump，证明清理闭环。

M0 不配置模型 key，先证明第 1–8、10 项真实工作。它不是 mock，也不把“CLI 能打印 help”当兼容。

## 8. 首次基线

新安装没有“上一个已验证版本”。Guardian 不增加另一份 baseline 配置，而是先用本 campaign 锁定的 repair DSH（默认 `0.1.1-rc.2`）运行完整 gate：

- 通过：写入第一条 `verified`，若它与当前 latest snapshot 相同就去重；
- 失败：`ONBOARDING_BLOCKED`，不调用模型，因为尚不能证明问题来自 DSH 更新。

以后才使用上一次 verified 与 candidate 做同 gate 对比。

## 9. 自动维修

只有下面条件全部成立才允许 repair：

- baseline PASS；
- candidate FAIL；
- 失败属于 DSH 差分，不是普通 CI、网络或仓库原有故障；
- event 来自可信默认分支的 schedule、manual 或 Guardian 控制文件 push；
- 本目标自动维修机会未用完；
- 预算未耗尽；
- latest 和 base commit 仍是本 campaign 冻结值。

repair 默认使用 `@deepseek-ai/dsh@0.1.1-rc.2` 和 `deepseek-official/deepseek-v4-flash-vision-exp`。普通模型默认端点是 `https://api.deepseek.com`。`rc.2` 的搜索实现会在 base URL 后自行追加 `/messages`，所以它实际需要的 Anthropic 搜索 base 是 `https://api.deepseek.com/anthropic/v1`；不能把普通模型和搜索端点混用。这些都只是默认值，仓库可覆盖；campaign 开始后解析为精确值并保持不变。

repair 可以按需使用 DSH 原生 DeepSeek 搜索，提示词建议优先查官方文档、标准、源码和 NPM 元数据。搜索失败会记入报告，但不会换模型、不会代替 verifier，也不会单独把兼容结论改成 PASS/FAIL。

repair 可以改普通插件源码、manifest、脚本、测试和文档，但控制面和验收面受保护。触及测试面、新增/删除依赖、跨 major、安装生命周期脚本时，即使仓库开了自动交付也强制降级为人审 PR。

## 10. 预算和防死循环

预算桶按“仓库 + 目标 DSH 根版本”累计，而不是按某一次 Actions run：

| 默认限制 | 数值 | 作用 |
| --- | ---: | --- |
| 总 token | 1,000,000 | DSH/DeepSeek 暴露的 usage 累计 |
| 估算费用 | 10 CNY | 使用版本化官方价格快照；route 不匹配则只报 token |
| 活跃时间 | 60 分钟 | repair/verifier 实际运行；等待低价不计 |
| repair attempts | 2 | 同一自动 campaign 内最多两次修改-复验 |
| 自动维修 campaign | 1 次/目标版本 | 失败后定时任务不再调用模型 |

剩余预算到 30% 时，可选给 repair DSH 发送一次“尽快收敛”消息。它不是免费复测，也不改变依赖版本；只是同一维修会话中的一次提醒。

耗尽后有两种恢复方式：提高配置额度，或把 lock 中 `resetBudget` 从 `N` 改成 `Y/y` 并提交。这个 `Y` 是一次性边沿；Guardian 消费该 commit 后会恢复为 `N`，静态 `Y` 或 Actions rerun 不会无限重置。

## 11. 峰谷价格

检测、仓库测试、真实安装、启动和 candidate smoke 都立即执行。只有已经证明确需调用 repair DSH 时，默认等待 DeepSeek 官方低价窗口。手工运行可显式选择立即维修。

默认费率是带日期的配置快照，不是引擎常量。provider/model/base URL 不匹配该快照时，Guardian仍报告 token，但把 CNY 标成 `unknown`，不伪造金额。

## 12. 真实模型 smoke

默认关闭。只有用户在 onboarding PR 中审核并接受 `requires_model_turn: true`，才会执行。

判定只看机械事实：插件处理了输入、图片/附件确实进入出站请求、provider 成功返回、DSH 消费了非空结果。不能要求模型回答固定句子，也不评价回答质量。timeout、429 或 5xx 由 DSH provider 在同一回合内最多重试一次，再失败就是 `BLOCKED_EXTERNAL`，不会每六小时重新烧钱。缺 Key、401/403、错误 model/base URL/provider 是 `BLOCKED_CONFIG`，同样持久化冻结。

V1 不建设临时 key 代理，因此 candidate smoke 进程在该独立 step 内确实能看到 key；它没有 Git 写权限，日志和 artifact 只保存 hash、状态、耗时、usage 和脱敏错误。

## 13. Git 与交付

默认交付 `pull-request`，也支持显式配置：

- `auto-merge`：验证通过后开启合并，仍服从 branch protection；
- `direct-push`：publisher 直接更新默认分支，风险最高，README 必须明显提示；
- 触及测试/高风险依赖/contract 时，无条件回到普通人审 PR。

publisher 在发布前重新读取默认分支 SHA。若源码变化，旧结果是 `STALE_SOURCE`，禁止推送。PR 等待期间 latest 变化，旧 PR 标为 `SUPERSEDED` 并关闭，新版本从当前默认分支新开 PR；不 force-push 旧证据。

每次 repair/model smoke 调模型前还会检查同目标的 `automation/dsh-compat/state/<version>` 和 `automation/dsh-compat/<version>`。任一分支尚未合并都直接冻结，因此“维修 PR 在等人审核”不会被六小时 schedule 当成新维修。

每个目标最终只交付一个整理后的 bot commit。失败轮次不塞入 Git 历史，只留在 PR/Issue 评论和短期脱敏 artifact。

## 14. fork 与 upstream

upstream 是 fork 最初来源的原作者仓库。Guardian 不需要知道它是谁，也不会同步、通知或写它。安装 Guardian 的仓库就是唯一维护对象。

因此，原作者插件和“打了私人补丁、懒得让原作者维护”的 fork 使用完全相同的流程。代价是 upstream 后续更新不会自动并入；这是明确的 V1 非目标，避免同时移动 DSH 和 upstream 两条基线。

## 15. 安全模型

- PR/fork/任意 ref 不获得模型 Secret。
- 不使用检出 PR 代码的 `pull_request_target`。
- candidate 和 repair 不持 Git 写 token。
- publisher 不运行模型生成代码。
- 保护 `.github/workflows/**`、Guardian 配置/lock、`compatibility/**`、凭据和仓库外路径。
- report/log/artifact 统一脱敏；不保存 key、Authorization、完整请求或完整对话。
- 外部 reusable workflow 必须固定完整 commit SHA，不引用 `main` 或可移动 tag。
- direct-push 默认关闭，且不能绕过 GitHub branch protection。

## 16. 报告与通知

每次 run 都有 Actions Summary。详细报告根据交付模式放在 PR 或 campaign Issue；lock 只存稳定 URL，不在仓库堆逐版本 Markdown。

外部 email、Telegram、webhook 只发四类去重事件：首次 `WAITING_FOR_PRICE`、一次 30% 提醒、终态 `PASS/BLOCKED/SUPERSEDED`。`NOOP` 不通知。

报告最少包含：目标/基线 snapshot、base commit、Node/包管理器/runner、每个 gate 的命令/耗时/退出码、插件 tarball hash、DSH graph digest、diff 统计、预算、脱敏错误、最终状态和下一步。

## 17. 里程碑

### M0：无模型真实兼容闭环

在公开 fixture 上完成 latest/精确版解析、隔离安装、仓库测试、真实 pack、profile add/dump、真实 `dsh web`、插件 health 断言、remove、去敏报告、lock 和下一次 NOOP。不开模型、auto-merge、direct-push。

### M1：可信 GitHub Actions 交付

完成 onboarding PR、薄 workflow、reusable workflow、事件守卫、concurrency、publisher PR 和 durable report，验证默认 `GITHUB_TOKEN` 权限不足/需批准时的可理解状态。

### M2：有预算的自动维修

在 fixture 隔离故障分支恢复历史 `httpServer` 接口错误，使用固定 repair DSH 真实修复，独立复验并产生可合并但不自动合并的 PR。加入预算、低价等待、一次性 reset、保护路径和 diff 分类。

### M3：可选生产能力（已实现）

已加入真实模型 smoke、DeepSeek 搜索证据、auto-merge/direct-push、email/TG/webhook，以及竞态、external blocked、contract PR 等完整恢复路径。其中真实视觉、direct-push、auto-merge 默认 token 等待和 external recovery 已有公开 Actions 证据；未提供目标/凭据的外部 adapter 不冒充现场投递。

## 18. 成功标准

V1 成功不是“代码写完”，而是公开 fixture 的 GitHub run 能提供下面这条可复核证据链：

```text
registry exact snapshot
  -> fresh DSH installation
  -> real plugin tarball
  -> add + dump-config
  -> real web process
  -> plugin-specific HTTP assertion
  -> remove + clean dump
  -> verified lock/report
  -> unchanged rerun = NOOP
```

M2 已看到真实旧接口故障、模型实际产生的窄修复、原 contract 全部复验通过和可合并 PR。M3 又看到真实视觉请求、三种发布路径的关键边界、跨峰谷费用累加以及合并后无模型 NOOP。

## 19. 明确不做

- 中央多仓库控制台、数据库、GitHub App；
- 自动同步 upstream；
- 通用 Dependabot、CI 修复或代码整理；
- 默认多 OS matrix；
- 自建 provider 协议或 OpenAI-compatible 计费解析器；
- Guardian 自更新 PR；
- 为了通过而自动改弱测试或 contract；
- 失败后靠定时任务无限重试模型。

## 20. 结论

Guardian 的核心不是“让模型自动写代码”，而是把 DSH 插件维护变成一个受控实验：只变 DSH、真实运行、独立验收、预算有界、状态可恢复、交付可审核。模型只在已经证明需要修复时出现；没有模型也能完成发现和兼容证明。这使自动维护既省心，也不需要相信一段 agent 自述。
