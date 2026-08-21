# DSH Plugin Compatibility Guardian

安装在 DeepSeek Harness（DSH）插件仓库中的 GitHub Actions 维修机器人：追踪 NPM `latest`，隔离验证插件，不兼容时用本轮已锁定的 repair DSH 自动修复，再由独立 verifier 复验并产出可合并 PR。

当前阶段：设计基线 Draft 0.3。已将产品边界、默认模型、峰谷调度、预算和防循环规则写入长期合同；尚未接入真实插件仓库、GitHub Actions 或模型凭据。

V1 只做“安装进当前插件仓库”：一个薄 workflow 调用本项目的 reusable workflow/orchestrator。无论仓库是原创插件还是魔改 fork，都只维护当前仓库，不自动同步或联系 upstream。

- [方案与讨论稿](docs/DESIGN.md)
- [历史证据与当前契约](docs/REFERENCE_EVIDENCE.md)
- [配置示例](.dsh-compat.example.yml)
- [长期验收合同](ACCEPTANCE.md)
- [当前切片状态](STATE.md)

repair DSH 默认使用 `0.1.1-rc.1`，维修模型默认使用 `deepseek-v4-flash-vision-exp`；二者均可由仓库覆盖，但一次 campaign 开始后必须锁定实际版本、模型与制品完整性，不能中途漂移或静默回退。候选 DSH 跟随当前 `latest` 并最终收敛到最新制品。

该默认模型由当前 DSH 的 `deepseek-official` provider 声明为 `text + image`，可直接消费截图等视觉证据。DeepSeek 官方联网搜索则是 DSH 的独立 search provider，会产生另一笔模型调用；它不是“视觉模型自带搜索”。默认同样选择上述模型，仓库可以覆盖，实际值与费用都必须进入报告。

默认在官方低价时段启动模型维修；版本探测和不花模型额度的确定性兼容测试立即执行。峰谷窗口、价格快照和时区都可配置。交付默认为 PR，同时支持显式开启 `auto-merge` 或 `direct-push`。

设计原则：大道至简；一次只移动一个基线变量；agent 只能提案，独立 verifier 才能判 PASS；可以显式选择高自动化，但不用提示词代替权限、预算和防循环机械门。
