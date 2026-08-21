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

设计原则：大道至简；一次只移动一个基线变量；agent 只能提案，独立 verifier 才能判 PASS；可以显式选择高自动化，但不用提示词代替权限、预算和防循环机械门。
