# 2026-08-27 远端 grok-4.6 纯文字 Smoke 发布记录

## 结论

本轮按“纯文字 + 至少一次安全工具调用”的最小真实路径完成远端验证。五个仓库均已安装并启用 Guardian；四个社区样本的兼容门通过，公开 fixture 另外完成了真实 DSH `0.1.1-rc.2` + `grok-4.6` 模型 smoke。默认交付仍是 Pull Request，没有开启自动合并或直接推送。

这次没有伪造 AI 维修：四个社区样本本身的确定性兼容检查已通过，所以 repair 按设计跳过；fixture 的候选模型 smoke 确实调用了远端模型并产生了 `tool/call`、`tool/result`、`assistant/message` 和 `turn/end` 事件。没有兼容差异时不为了“看起来像修复”而改代码。

## 授权和凭据边界

- 用户明确授权将五个仓库的源码、测试、必要图片和去敏日志发送到 `https://fast.xpeach.codes/v1` 做真实 `grok-4.6` 测试。
- 凭据只通过 GitHub Actions Secret `DEEPSEEK_API_KEY` 注入；本文件、commit message、PR 描述、artifact 和可读日志不保存或回显 key。
- Guardian 继续使用 `provider: deepseek-official` 的 DSH 原生适配器，配置的 `base_url` 为 xpeach 的 OpenAI-compatible `/v1` 路由，模型为 `grok-4.6`，搜索开关为 `false`。
- 这不是 DeepSeek 官方计费路由：本次 artifact 能可靠记录 token，但 xpeach 路由不匹配内置 DeepSeek 价目表，所以 `estimatedCny` 为未知，不能把它写成确定金额。

## 五个仓库的配置提交

| 仓库 | 配置提交 | 远端设置 |
| --- | --- | --- |
| [dsh-whale-report](https://github.com/LCYLYM/dsh-whale-report) | `ba4c44472425492f18be248283c6057e3564af46` | Actions 开启；仅 Guardian workflow active |
| [dsh-web-ui](https://github.com/LCYLYM/dsh-web-ui) | `cbc00ff68aae9ed0ec746dbe911616386fc84d01` | Actions 开启；仅 Guardian workflow active |
| [dsh-plugin-better-sidebar-plugin-office](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office) | `8b6d776583d04db3c409cfdf27f33d91b91678e8` | Actions 开启；仅 Guardian workflow active |
| [dsh-ankh-guard](https://github.com/LCYLYM/dsh-ankh-guard) | `3fce11572af672bce82396c77cb5d1477d07f0c0` | Actions 开启；仅 Guardian workflow active |
| [dsh-attachments-guardian-fixture](https://github.com/LCYLYM/dsh-attachments-guardian-fixture) | `751de22bf4d8c527b561a783f3fc05e60e19b825` | Actions 开启；Guardian active |

四个社区 fork 的其它上游 workflow 没有启用；五个仓库只配置了 Secret 名称 `DEEPSEEK_API_KEY`。配置值本身不记录在文档中。

## 四个社区样本：真实远端兼容复测

这些 run 做的是候选 DSH 安装、依赖安装、原仓库 gate、打包、安装到隔离 profile、真实 `dsh web` 启停、插件专属 HTTP smoke 和卸载。因为样本的 `modelSmokeRequired=false` 且候选与基线均通过，repair 和 candidate-model-smoke 均按设计 skipped；这些 run 是“兼容通过”，不是“AI 已修改代码”。

| 样本 | Run | 结果 | 兼容报告 | 关键耗时 |
| --- | --- | --- | ---: | ---: |
| Whale Report | [33043825705](https://github.com/LCYLYM/dsh-whale-report/actions/runs/33043825705) | PASS | 23/23 | 26.27s |
| dsh-web-ui | [33043830083](https://github.com/LCYLYM/dsh-web-ui/actions/runs/33043830083) | PASS | 20/20 | 23.38s |
| Better Sidebar Office | [33043994867](https://github.com/LCYLYM/dsh-plugin-better-sidebar-plugin-office/actions/runs/33043994867) | PASS | 23/23 | 42.96s |
| Ankh Guard | [33043998918](https://github.com/LCYLYM/dsh-ankh-guard/actions/runs/33043998918) | PASS | 21/21 | 124.70s |

## fixture：真实模型和工具调用

### 远端 run

[run 33049476958](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/actions/runs/33049476958) 在 `main` 的 `751de22` 上完成：

- `verify`：PASS，18/18，报告总耗时 12.76s；包含真实 DSH 安装、插件安装、web 启动、插件健康检查、停止和移除。
- `candidate-model-smoke`：PASS；`@deepseek-ai/dsh@0.1.1-rc.2` 通过 xpeach 路由调用 `grok-4.6`。
- `repair`：skipped；没有兼容差异，不应产生维修 diff。
- `publish` / `notify`：PASS；生成只含锁文件变更的候选 PR。
- 运行结束后没有留下 queued 或 in-progress 的本轮任务。

模型 smoke artifact 的关键证据：

```text
candidate: 0.1.1-rc.2
fixtureMode: none
inputMode: text
imageObserved: false
eventTypes: tool/call, tool/result, assistant/message, turn/end
attempts: 1
totalTokens: 16443
estimatedCny: unknown (xpeach route 未匹配内置价目表)
```

提示词要求 DSH 先对 `package.json` 发起安全只读 `read` 工具调用，再用一句话回答文件中的具体事实。因本轮选择纯文字 smoke，artifact 中 `fixtures=[]` 是预期行为；它证明了文本与工具事件链，不证明视觉附件兼容。

### 本地同路径校验

Guardian 自身测试为 80/80 PASS；同一纯文字 contract 的真实模型 smoke 也 PASS。远端 run 是交付验收证据，本地结果仅用于定位配置和事件协议问题，不替代远端仓库状态。

## 旧 PR 和新 PR

- 按用户授权关闭旧 [PR #20](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/20)，原因和新纯文字 smoke 的替代关系已通过 PR comment 留痕：<https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/20#issuecomment-5435694951>。
- 精确删除旧分支 `automation/dsh-compat/0.1.1-rc.2`；GitHub ref 回读为 deleted。旧 PR 的历史仍可查看。
- 当前新 [PR #21](https://github.com/LCYLYM/dsh-attachments-guardian-fixture/pull/21) 为 OPEN、非 draft、`mergeStateStatus=CLEAN`，head 为 `65fcac72114b8984c22c1ccf4926b61f9ebf2bd7`。它尚未合并，保留一次用户审核门；默认没有自动合并。

## 视觉边界

直接向 xpeach 的兼容 API 发图片可以得到响应，但 DSH `0.1.1-rc.2` 原生适配器对 attachment 输入仍返回 `attachment-error`。因此本轮 fixture contract 明确采用纯文字 + 工具调用，不能把它宣传为已完成视觉兼容。视觉 smoke 要单独升级 DSH/适配器后再开，不在本次最小部署中偷偷降级或伪造通过。

## 额度、收敛和停机

- 本次真实模型 smoke 的 campaign ledger 记录 476,020 tokens、约 2.77 wall minutes、attempts=1；单次模型事件记录 16,443 tokens。CNY 估算未知，不作虚构换算。
- 预算仍按“下一次调用前阻断、一次调用完成后记账”执行；单次在途请求可能使供应商账单略微越界，属于设计边界。
- 同一目标版本只有一次自动维修机会；没有兼容差异时不消耗 repair。失败/冻结后需要新的版本信号或用户显式 `reset-budget`/增加额度。
- 本轮按用户要求保持五个仓库的 Guardian 开启，以便继续追踪 DSH 更新；若测试结束，应先停用该 workflow，再按需关闭仓库 Actions 总开关并删除 Secret。默认仍不开 direct-push/auto-merge。

## 可复核文件和实现提交

- Guardian text-only smoke 实现：`28898380f3f6a03dab99027ef86850e999f3627b`。
- 本记录所在分支：`codex/design-foundation`。
- 本文件不包含 API key、私有路径、原始 transcript 或未脱敏日志。

