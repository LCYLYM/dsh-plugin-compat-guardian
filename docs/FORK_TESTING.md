# 在 fork 中做一次真实 AI 维修演练

这份教程只用于验证 Guardian 会不会真正调用 repair DSH、改代码、用新 DSH 独立复验并产出 PR。长期使用时，请直接安装到插件原仓库，不需要维护一个中央服务。

## 先说清楚：什么才算真实 AI 维修？

只有下面五项同时存在，才算成功案例：

1. 旧 DSH 对同一仓库 commit 跑过完整 gate，lock 中有可信 PASS 基线。
2. 新 DSH 在无 Key verifier 中明确进入可维修的 `BLOCKED`，而不是首次安装失败。
3. repair 报告有非零 token usage 和 `run-repair-dsh` 耗时。
4. repair DSH 在工作树中留下可审查 diff，不是只说“已修复”。
5. 另一个不拿 Key、不信模型自报的 verifier 用新 DSH 重跑全部 gate，报告记录真实耗时，然后 publisher 产出 PR。

如果插件本来就兼容，结果应该是无模型 PASS。这证明 Guardian 不乱花钱，但不证明 AI 维修能力。

## 一、准备一个只用于测试的 fork

```bash
gh repo fork OWNER/PLUGIN_REPO --clone=false
gh repo clone YOUR_NAME/PLUGIN_REPO
cd PLUGIN_REPO
```

GitHub fork 不会复制 Actions Secret，也可能默认停用 Actions。在 fork 的 Actions 页面先明确启用 workflow，然后才设置 fork 自己的 Secret：

```bash
# 命令会安全地读取终端输入；不要把 Key 写在命令参数、YAML 或 commit 中
gh secret set DEEPSEEK_API_KEY --repo YOUR_NAME/PLUGIN_REPO

gh api --method PUT repos/YOUR_NAME/PLUGIN_REPO/actions/permissions/workflow \
  -f default_workflow_permissions=read \
  -F can_approve_pull_request_reviews=true
```

在 fork 里运行 README 的 onboarding 命令。审核 onboarding PR 后，把生成 workflow 的触发器改为只允许手动：

```yaml
on:
  workflow_dispatch:
```

不要在一次性 fork 中保留 `schedule`。这样只有你点击 Run workflow 时才会运行。

注意：fork 会连同上游的其他 workflow 文件一起复制。它们可能自带 `schedule`，即使 Guardian 已停用也会继续运行。一次性测试 fork 应在开始前就枚举全部 workflow，只临时启用本次需要的 Guardian：

```bash
gh workflow list --all --repo YOUR_NAME/PLUGIN_REPO
```

## 二、先建立旧 DSH 的真实 PASS 基线

在薄 workflow 中临时锁定一个旧版，例如：

```yaml
with:
  target_dsh: 0.1.1-rc.1
```

触发一次 workflow，必须看到仓库原生测试、build、`npm pack`、插件 add/dump、真实 web 启动、插件 smoke 和 remove 都 PASS。合并只更新 `.dsh-compat.lock.json` 的 baseline PR。

如果旧包已从 NPM 撤下、lock 指向本地绝对路径，或仓库原生测试本来就红，先在 fork 中做最小的可复现准备。没有真实 PASS 基线就不允许花模型额度。

## 三、触发一个透明、可审查的兼容边界

最好使用社区历史中已知的真实不兼容 commit。如果 rc.1 到 rc.2 对这个插件没有自然破坏，可以在 **fork 中** 使用“上次人工审核到的宿主版本”边界：

```json
{
  "dsh": {
    "compat": {
      "minHost": "0.1.1-rc.1",
      "maxHost": "0.1.1-rc.1"
    }
  }
}
```

然后把 workflow 的 `target_dsh` 改为 `0.1.1-rc.2`，把 `.dsh-compat.yml` 的 `repair.dsh_version` 也设为 `0.1.1-rc.2`。这不是宣称上游插件代码已经坏了；它的准确含义是“这份插件只人工确认到 rc.1”。repair DSH 需要阅读插件、运行测试，并且只有完整 rc.2 verifier 通过时才能放宽 `maxHost`。

不要制造语法错误、直接把测试改成必败，或用假端点冒充兼容性问题。

## 四、如何验收和处理 BLOCKED

在 Actions artifact 的 `report.json` 中核对：

- `budget.usage.totalTokens > 0`；
- `steps[name=run-repair-dsh].durationMs > 0`；
- 有 `repair.patch`；
- `steps[name=independent-verifier-attempt-1].durationMs > 0`；
- 最终 `status: PASS`，并且出现可审查维修 PR。

`BLOCKED` 就是没成功。额度到顶时，先合并 bot 生成的 blocked-state PR，再二选一：提高 `.dsh-compat.yml` 限额，或把 lock 顶部的 `resetBudget` 从 `N` 改为 `Y` 并提交。`Y` 只授权一个新 budget epoch，随后会自动消费回 `N`；不会因为 rerun 无限加钱。

Guardian 的 token 限额在一次 provider 调用结束后记账，所以单个在途模型回合可以越过设定线。绝对账户限额应在 DeepSeek/provider 侧配置。

## 五、测完立即停止

```bash
REPO=YOUR_NAME/PLUGIN_REPO

# 取消仍在跑的测试（先用 gh run list 确认精确 run id）
gh run list --repo "$REPO" --workflow dsh-compat.yml
gh run cancel RUN_ID --repo "$REPO"

# 先枚举 fork 中的全部 workflow，包括从上游继承的 CI/定时任务
gh workflow list --all --repo "$REPO"

# 对列表中每个仍为 active 的 workflow 逐一执行；优先用精确 ID
gh workflow disable WORKFLOW_ID --repo "$REPO"

# 删除 fork 中的测试 Key
gh secret delete DEEPSEEK_API_KEY --repo "$REPO"

# 一次性测试 fork：关闭仓库级 Actions 总开关，阻止现有和以后新增的 workflow 运行
gh api --method PUT "repos/$REPO/actions/permissions" -F enabled=false

# 回读确认：总开关必须为 false，所有 workflow 均应为 disabled_manually，Secret 不应再有该项
gh api "repos/$REPO/actions/permissions" --jq '.enabled'
gh api "repos/$REPO/actions/workflows?per_page=100" \
  --jq '.workflows[] | [.name, .path, .state] | @tsv'
gh secret list --repo "$REPO"
```

保留 workflow 文件和去敏的 Actions 报告没问题；历史 run 仍会显示在 Actions 页面，但不代表它还在运行。只有当仓库级 Actions 总开关为 `false`、全部 workflow 已停用、活跃/排队 run 为 0 且 Secret 已删除，才算完成一次性测试 fork 停机。以后若要继续测试，可在仓库 Settings → Actions → General 重新允许 Actions，再只启用本次需要的 workflow。

## 本项目的公开 fork 案例

- [`LCYLYM/dsh-whale-report`](https://github.com/LCYLYM/dsh-whale-report)
- [`LCYLYM/dsh-web-ui`](https://github.com/LCYLYM/dsh-web-ui)
- [`LCYLYM/dsh-plugin-better-sidebar-plugin-office`](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office)
- [`LCYLYM/dsh-ankh-guard`](https://github.com/LCYLYM/dsh-ankh-guard)

这四个只用于试验。最新的 run、模型耗时、token、独立 verifier 耗时、PR 和最终停用证据统一记录在 [最终验收报告](FINAL_VALIDATION.md)。
