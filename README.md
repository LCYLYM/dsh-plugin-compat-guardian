# DSH Plugin Compatibility Guardian

安装在 DeepSeek Harness（DSH）插件仓库中的 GitHub Actions 维修机器人：追踪 NPM `latest`，隔离验证插件，不兼容时用本轮已锁定的 repair DSH 自动修复，再由独立 verifier 复验并产出可合并 PR。

当前阶段：grilling / 设计基线 Draft 0.3。已建立公开真实样本仓库 [`LCYLYM/dsh-attachments-guardian-fixture`](https://github.com/LCYLYM/dsh-attachments-guardian-fixture)，但实现已明确冻结；只有用户宣布 grilling 结束并要求开工后，才会安装 Guardian workflow、创建故障场景、配置模型凭据或运行自动维修。

V1 只做“安装进当前插件仓库”：一个薄 workflow 调用本项目的 reusable workflow/orchestrator。无论仓库是原创插件还是魔改 fork，都只维护当前仓库，不自动同步或联系 upstream。

- [方案与讨论稿](docs/DESIGN.md)
- [历史证据与当前契约](docs/REFERENCE_EVIDENCE.md)
- [配置示例](.dsh-compat.example.yml)
- [长期验收合同](ACCEPTANCE.md)
- [当前切片状态](STATE.md)

repair DSH 默认使用 `0.1.1-rc.1`，provider/model 默认使用 `deepseek-official/deepseek-v4-flash-vision-exp`；DSH 版本、provider、base URL、key 的环境变量引用和 model ID 均可由仓库覆盖，但一次 campaign 开始后必须锁定实际值与制品完整性，不能中途漂移或静默回退。候选 DSH 跟随当前 `latest` 并最终收敛到最新制品。

有时 NPM 上显示的 DSH 版本号没变，但它依赖的内部组件已经更新。同一次测试或维修会锁定整套依赖，保证前后使用同一套代码；以后的定时巡检则重新模拟“用户今天全新运行 `npx` 会装到什么”。如果实际安装内容变了，Guardian 会重新执行仓库测试、插件打包安装、`dump-config`、真实 `dsh web` 启动和插件专属 smoke 断言。这时 GitHub Actions 仍在正常运行，只是还不调用 repair DSH 的模型、不消耗模型 token。测试失败后才进入维修；如果这个根版本已经用过一次自动维修，就提示用户把 `resetBudget` 从 `N` 改成 `Y` 后继续。

该默认模型由当前 DSH 的 `deepseek-official` provider 声明为 `text + image`，可直接消费截图等视觉证据。DeepSeek 官方联网搜索则是 DSH 的独立 search provider，会产生另一笔模型调用；它不是“视觉模型自带搜索”。默认同样选择上述模型，仓库可以覆盖；搜索缺少 token usage 时只记录调用次数，不为几分钱的误差另造计费系统。

默认在官方低价时段启动模型维修；发现新版后，仓库测试、插件安装、真实 DSH 启动和 smoke 断言立即执行，只有确实需要修代码时才等待低价时段调用模型。MVP 统计 DSH/DeepSeek 暴露的 token usage，并按官方默认价格快照估算人民币；不单独实现 OpenAI-compatible 账单解析。自定义 route 若费率不同可覆盖价格，否则仍报告 token、把人民币标为 unknown。交付默认为 PR，同时支持显式开启 `auto-merge` 或 `direct-push`。

维修时默认允许改当前仓库内普通插件文件，不要求用户按插件结构维护一长串路径。workflow、Guardian 配置与 lock、onboarding smoke contract、独立 verifier、secret/凭据和仓库外路径不能改；publisher 会在接收 diff 时机械拒绝这些修改。

仓库测试也可以由机器人提案修改，但只要维修 diff 改了测试文件、测试配置或测试命令，本次就强制生成普通 PR，不能自动合并或直接推送，必须由人检查是否在“改答案”。没有修改测试面的维修仍按仓库选择的交付模式执行。

依赖只做与本次 DSH 不兼容直接相关的最小调整：可以改已有 DSH 依赖的版本范围并同步 lockfile，但不允许顺手全量升级、更新无关依赖或更换包管理器。新增/删除依赖、跨 major 升级或修改安装生命周期脚本时强制普通 PR；其余通过完整复验后仍可按仓库配置自动交付。

`lib/dist` 不会仅凭目录名被当成生成物。仓库有明确构建命令和对应源码时，机器人改源码，verifier 在干净环境重建并要求已跟踪产物完全一致；无法复现就不通过。仓库没有构建命令且 `lib` 本身就是维护代码时，它按普通源码处理。可重复构建且一致的产物不额外触发人工审核。

普通仓库文件可以新增、修改和删除，不再针对重命名、可执行文件等情况设计额外分级。前述 workflow、Guardian、contract/verifier、凭据等保护内容同样不能删除；其他误删会由原有构建、测试、打包、安装和 smoke 验收拦住。

报告会列出改动文件数和增删行数，但不会因为数字大就机械阻断；生成文件可能让这个数字失真。防死循环与失控仍由 token/金额/时间/轮次预算、每版本一次自动维修、保护路径和独立 verifier 负责，不增加新的行数配置。

repair model 的 key 只会在可信默认分支上的定时、手工或默认分支 push campaign 中使用，而且先由无 key job 确认确实是 DSH 兼容失败，才进入带 key 的维修 job。普通 PR、fork PR、检出 PR 代码的 `pull_request_target` 和任意 ref 都拿不到 key；负责提交的 Git 写权限仍放在独立 publisher job。

本项目只修“DSH 更新后插件不兼容”这一件事。它不是通用依赖升级机器人、CI 修复机器人或代码整理机器人；测试、预算、通知和交付功能都必须直接服务于发现、证明、修好并交付 DSH 兼容修复。

默认每 6 小时检查一次 NPM `latest` 和实际安装图，也支持手工立即检查；默认分支中的 Guardian 配置或 lock 变化会触发一次处理，普通源码 push 不会。GitHub cron 只是唤醒器，即使延迟或错过中间版本，醒来后也直接处理当时的最新版本。

设计原则：大道至简；一次只移动一个基线变量；agent 只能提案，独立 verifier 才能判 PASS；可以显式选择高自动化，但不用提示词代替权限、预算和防循环机械门。
