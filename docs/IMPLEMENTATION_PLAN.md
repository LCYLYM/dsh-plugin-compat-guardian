# 完整落地列表

日期：2026-08-22
执行状态：M0/M1/M2 MVP 公开 PASS，M3 增强项待实现

本文把 `ACCEPTANCE.md` 的 R1–R51 映射成可实现、可验证、可暂停的工程任务。`open` 表示尚无真实证据，`doing` 表示当前切片，`partial` 表示只覆盖了需求的一部分，`pass` 必须绑定真实运行证据。

## 1. 里程碑顺序

| 里程碑 | 目标 | 退出条件 |
| --- | --- | --- |
| M0 | 本地无模型真实兼容闭环 | fixture 对 `0.1.1-rc.2` 完成 pack/add/dump/web/smoke/remove，生成报告与 lock；相同 snapshot 再跑为 NOOP |
| M1 | 仓库内 GitHub Actions + PR | onboarding PR 合并后，公开 fixture 的 schedule/manual run 可真实复现 M0，默认只开 PR |
| M2 | 自动维修 | 受控历史不兼容由固定 repair DSH 真修复，独立 verifier 通过并产出一个可合并 PR |
| M3 | 完整恢复与可选自动化 | 预算/reset、峰谷、模型 smoke、通知、auto-merge/direct-push、竞态和 contract PR 全部有真实/故障注入证据 |

## 2. M0 当前切片

- [x] 建立独立设计/实现 worktree 和公开 fixture。
- [x] 锁定默认 repair DSH 为 `0.1.1-rc.2`，确认 NPM root integrity 和 CLI 契约。
- [x] 建立 Node ESM CLI、配置解析、runtime/package-manager resolver。
- [x] 解析 NPM dist-tag、精确 manifest、integrity，并对实际 pnpm lock 计算 graph digest。
- [x] 对目标仓库执行原测试和 `npm pack`，记录 tarball hash。
- [x] 在全新 runner 目录安装精确 candidate DSH，在全新 `DSH_HOME` add 插件 tarball。
- [x] dump profile、启动真实 `dsh web`、执行 fixture `/health` 断言。
- [x] 停止 web、remove 插件、再次 dump，证明无残留激活层。
- [x] 生成去敏 JSON/Markdown/Actions Summary；PASS 才更新 lock。
- [x] 同 snapshot 重跑返回 NOOP。
- [x] 单元测试覆盖 runtime/package-manager、状态去重、脱敏和失败不前移 lock。
- [x] 在 fixture 的隔离分支完成本地真实验证；公开 onboarding PR 留到 Guardian 远端和完整 SHA 确定后生成。

M0 明确不调用 repair/model，不开 auto-merge/direct-push；这些不是被忘记，而是后续单独验收。

## 3. R1–R51 映射

| ID | 里程碑 | 实现项 | 必须看到的证据 | 状态 |
| --- | --- | --- | --- | --- |
| R1 | M0/M1 | registry resolver、latest 收敛、root integrity、pnpm graph digest、supersede/dedupe | 两份同版本不同 graph fixture；latest 跳变 | partial |
| R2 | M0/M2 | candidate/repair 两套临时安装根和 DSH_HOME；动态 spec 开局冻结 | 目录、version、integrity、graph 全不同且可回读 | pass |
| R3 | M0/M2 | baseline 与 candidate 执行同一个 gate runner | 只替换 DSH snapshot 的差分报告 | partial |
| R4 | M0/M1 | PASS 报告、verified lock、无代码 PASS 提交 | 失败不写 verified；下一轮 NOOP | pass |
| R5 | M2 | repair worktree、原 contract hash、独立 verifier | 真实失败、窄 diff、原 gate PASS | pass |
| R6 | M2 | campaign ledger、usage 归一化、CNY map、30% steer | 跨 run 累计与四个硬上限故障注入 | partial |
| R7 | M1/M2 | 状态机、concurrency、一次自动维修门 | schedule 重放不再调模型 | partial |
| R8 | M2 | DSH 原生 provider/env 适配和 redactor | 默认/自定义 route 真实调用且无 secret 泄漏 | partial |
| R9 | M1 | 薄 workflow + reusable action，无中央依赖 | 公开 fixture 的仓库内完整 run | pass |
| R10 | M0/M1 | onboarding 发现器、hints、生成 contract、人审 PR | fixture contract 覆盖报告和防篡改测试 | partial |
| R11 | M1/M3 | publisher 的 PR/auto-merge/direct-push 三模式 | 三模式 GitHub 回读及保护分支失败 | open |
| R12 | M2 | `N -> Y` edge、budget epoch、reset commit 去重 | 静态 Y/rerun 不重复恢复 | open |
| R13 | M1 | current-repo-only guard；不读取 upstream remote | fork fixture 零 upstream 写调用 | partial |
| R14 | M1/M3 | Summary/Issue + email/TG/webhook 窄 adapter | 终态消息真实回读且去重 | open |
| R15 | M2/M3 | 默认 vision model、真实图片 smoke、DSH search 事件 | image 入请求、搜索调用/usage 分开记录 | open |
| R16 | M2 | 价格 revision、时区窗口、立即检测/延迟维修 | 峰谷边界和未知 route CNY unknown | open |
| R17 | M0/M2 | 同根 graph 变化复测；不赠预算 | 两份 graph、完整 gate、repair 门保持 | doing |
| R18 | M0/M2 | 先无 key PASS，再注入 `httpServer` 故障真修 | 两阶段公开证据，均无自动合并 | pass |
| R19 | M2 | realpath denylist、protected diff guard | 普通源码允许；每类保护路径拒绝 | partial |
| R20 | M2 | 测试面 classifier 强制普通 PR | test/config/script 三类降级 | open |
| R21 | M2 | 依赖 diff classifier 和因果说明 | allow/reject/human-review 三组样例 | open |
| R22 | M2 | build/source detector、干净重建、byte compare | deterministic/nondeterministic/no-build 四样例 | open |
| R23 | M2 | 普通文件增删；复用同一保护清单 | 普通删除通过、保护删除拒绝、误删 gate fail | open |
| R24 | M2 | diff stat 只报告不设阈值 | 大生成 diff 不误拦、预算仍生效 | open |
| R25 | M1/M2 | event/ref/permission guard；分 job secret 映射 | 三允许事件与 PR/fork/ref 拒绝矩阵 | open |
| R26 | M2 | baseline/candidate failure classifier | DSH 差分才 repair，无关失败只报告 | open |
| R27 | M1 | `17 */6 * * *`、manual、控制文件 push filter | 四触发、源码 push 静默、latest 跳变 | partial |
| R28 | M0 | 无 verified 时先跑 frozen repair baseline | baseline PASS/FAIL/与 latest 同 snapshot 去重 | doing |
| R29 | M1/M2 | base SHA 二次读取、STALE_SOURCE | 四阶段竞态测试且预算不重置 | open |
| R30 | M1/M2 | target-version branch/PR、supersede close | 旧 PR 留痕关闭、新 PR 新建、无 force push | open |
| R31 | M1 | full-SHA workflow ref validator/generator | 拒绝 branch/tag；DSH 更新 workflow 零 diff | pass |
| R32 | M0/M1 | no-repair PASS 只改 lock，报告 URL 持久化 | 三交付模式、下一轮 NOOP | partial |
| R33 | M2 | token/CNY/time/attempt 硬门和一次 steer | 四上限、等待不计时、尾差阻断 | open |
| R34 | M2 | repair prompt + DSH native search telemetry | 用/不用/失败/无 fallback 四记录 | open |
| R35 | M3 | reviewed contract 才给 candidate smoke Secret | 默认无 key、缺 key blocked、usage 入同桶 | open |
| R36 | M3 | request trace 的机械模型断言 | 随机措辞 PASS、未传附件/空结果 FAIL | open |
| R37 | M3 | candidate-only/differential、snapshot cache key | 四路径调用计数与去重 | open |
| R38 | M3 | candidate smoke 绕过 price queue | 高峰 candidate 立即、repair 等待 | open |
| R39 | M3 | timeout/429/5xx retry once + frozen external state | schedule NOOP、manual/config/new target 恢复 | open |
| R40 | M3 | fixed/agent-selected fixture sandbox 与 hash freeze | 生成/下载/越界/复用同 hash | open |
| R41 | M1/M3 | report redactor、7-day artifact policy | 日志/报告/产物 secret/raw payload 扫描 | partial |
| R42 | M3 | `BLOCKED_CONTRACT` + 独立 contract-only PR | 永远人审、合并重测、预算保持 | open |
| R43 | M3 | external recovery edge，不改 repair ledger | manual/config 恢复与 schedule NOOP | open |
| R44 | M1 | lock 仅机器状态+URL；报告在 GitHub surface | 三交付模式，仓库无版本报告文件 | partial |
| R45 | M2 | publisher squash/clean commit，失败尝试不发布 | 两轮后仍只有一个 bot commit | partial |
| R46 | M1/M3 | Summary always + event-id notifier dedupe | 所有允许事件一次，NOOP 零通知 | open |
| R47 | M0/M1 | Node 声明优先级、冲突检查、setup-node 接线 | 三声明/fallback/conflict/精确版本 | pass |
| R48 | M0/M1 | packageManager/lockfile resolver，npm/pnpm/yarn | 三支持/fallback/conflict/Bun blocked | partial |
| R49 | M1 | 默认 `ubuntu-24.04` + 单 label override | workflow 无 matrix 且报告 actual OS | pass |
| R50 | M0/M1 | onboard 临时分支、gh PR/fallback、secret scan | 有/无 gh 两条真实路径，默认分支零 diff | partial |
| R51 | M1/M3 | GITHUB_TOKEN publisher、WAITING_APPROVAL、可选 PAT | 默认 PR、审批等待、token job 隔离 | open |

## 4. M0 文件落地

```text
bin/dsh-plugin-compat-guardian.js   CLI 入口
lib/config.js                       默认值、YAML 读取和窄校验
lib/runtime.js                      Node/包管理器解析
lib/registry.js                     NPM exact snapshot
lib/process.js                      带超时、截断和脱敏的子进程
lib/verifier.js                     pack/add/dump/web/smoke/remove 编排
lib/report.js                       JSON/Markdown/Summary 与 verified lock
lib/onboard.js                      onboarding 文件生成
templates/                          薄 workflow、配置、contract、lock
test/                               确定性单元和集成测试
```

M0 允许实现时因真实 DSH CLI 调整文件拆分，但不得降低上述行为边界。

## 5. GitHub Actions 落地

M1 workflow 拆成最少四个 job：

1. `detect-and-verify`：只读仓库，无 Secret，产出冻结 snapshot 和 gate 证据。
2. `candidate-model-smoke`：仅 contract 明确要求且 event 可信时运行；无 Git 写权限。
3. `repair`：仅差分失败、预算允许时运行；有模型 Secret，无 Git 写权限。
4. `publish`：只消费通过 verifier 的签名/哈希产物；有 GitHub 写权限，无模型 Secret。

workflow 必须有 per-repository concurrency；触发源只包括 schedule、manual 和默认分支上 Guardian config/lock/contract 的 push。

## 6. 真实验证矩阵

### 正常路径

- 初次 baseline PASS；
- candidate 与 baseline 同 snapshot 去重；
- 新 root version PASS；
- 同 root version/new graph PASS；
- PASS 只改 lock，不改插件源码；
- 下一次 poll `NOOP`。

### 可维修路径

- candidate 因 DSH API 改名失败，baseline PASS；
- repair 第一次失败、第二次成功；
- repair 触碰普通源码可交付；
- repair 触碰测试或高风险依赖强制人审；
- verifier 不接受 agent 自报成功。

### 阻断与竞态

- onboarding baseline 自身失败；
- registry/provider timeout；
- package manager/Node 声明冲突；
- budget 四种任一耗尽；
- protected path diff；
- source SHA 在等待、维修、复验、发布前变化；
- latest 在 repair PR 未合并时变化；
- PR/fork/ref 尝试取得 Secret；
- 静态 reset `Y` 和 workflow rerun。

## 7. 发布前检查

- [ ] 所有 `ACCEPTANCE.md` ID 保持不变，状态由证据更新而非口头更新。
- [ ] `npm test`、CLI smoke、fixture real run 全部 PASS。
- [ ] `git diff --check` 和 secret/path/transcript 扫描通过。
- [ ] README 对 auto-merge/direct-push、candidate model key 和价格估算风险说人话。
- [ ] workflow 引用完整 SHA，权限逐 job 最小化。
- [ ] 失败不会更新 verified，不会调用 publisher，不会静默 fallback。
- [ ] 公开 fixture 的 Actions/PR/lock URL 回读完成。
- [ ] M2 模型维修前再次确认预算、Secret 名和低价策略。

## 8. 当前停止线

M0/M1/M2 MVP 已按真实公开证据完成，详见 `STATE.md`。下一切片只能从 M3 未完成项中选择；不能把配置文件中保留的未来字段或 M2 单次成功外推成 30% 动态 steer、低价排队、通知、自动合并、跨 run 失败冻结或 provider 账单级硬上限已经完成。
