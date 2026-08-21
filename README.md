# DSH Plugin Compatibility Guardian

面向 DeepSeek Harness（DSH）插件仓库的版本监测、隔离兼容测试、受控自动修复与兼容性报告流水线。

当前阶段：设计与验收合同初始化。尚未接入真实插件仓库、GitHub Actions 或模型凭据。

第一版产品形态拟定为：一个可复用 GitHub Action，加一个本仓库维护的 orchestrator CLI。插件仓库只需要提交 `.dsh-compat.yml`、兼容测试入口和仓库 secrets。

- [方案与讨论稿](docs/DESIGN.md)
- [历史证据与当前契约](docs/REFERENCE_EVIDENCE.md)
- [配置示例](.dsh-compat.example.yml)
- [长期验收合同](ACCEPTANCE.md)
- [当前切片状态](STATE.md)

设计原则：候选新版 DSH 永远在无模型 secret、无 Git 写凭据的隔离环境中运行；固定稳定版 DSH 负责提出修复，独立 verifier 决定是否通过；默认只推兼容分支和 Pull Request，不直接写主分支。

