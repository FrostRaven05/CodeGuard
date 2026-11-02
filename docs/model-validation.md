# 小样例真实模型验证

本流程只向已配置服务发送四组合成 TS/JS、Python 样例：两项明确回归（合法零值变成默认值、右侧开区间误改成闭区间）和两项等价简化。样例与已知行为见 `tests/fixtures/review-cases.cjs`，不会把预期结论发送给模型。四个样例不能代表真实项目或完整语言能力。

在项目目录运行：

```powershell
node scripts/validate-model.mjs --inspect
```

默认只输出服务地址、模型、预算、密钥是否存在等公开配置，不联网、不解密密钥。若未配置，请启动 CodeGuard，在现有“模型设置”面板填写服务地址、模型名及密钥并保存；不要在聊天或命令行粘贴密钥。密钥仍由桌面系统存储保护。

现有设置只读取应用保存的配置，不自动导入 `DEEPSEEK_API_KEY` 等环境变量；操作系统中存在 API 密钥不代表 CodeGuard 已配置，也不代表本机已部署模型服务。

确认公开配置后运行：

```powershell
node scripts/validate-model.mjs --run
```

只读复用 `.local/desktop` 配置，不保存或覆盖设置。最多四次调用，不重试，失败立即停止。每项在专用临时仓库构造父版本、暂存版本与相关测试，沿用实际 ReviewService 请求和位置核对。不会使用用户仓库或执行其中脚本。调用可能计费；价格未知保持未知。应在当前 Windows 登录账户的普通终端运行，保留 Electron 渲染沙箱；受限开发环境可能无法启动运行时或写临时 Git 配置。

报告位置会在终端显示，为 `.local/model-validation/<时间戳>-<标识>.json`，不进入 Git。每项记录协议接受/失败、位置核对通过与拒绝数量、耗时、实际返回的 prompt/completion/total tokens（缺失为 null）、费用 null、合成样例 oracle 与归一化结果。`durationMs` 包含准备快照的总耗时，结果内另有模型处理耗时。协议失败、位置核对失败均不能当作语义评审通过。工具只记录所配置的服务，不凭地址宣称供应商真实性；连接模拟服务的结果仍是模拟验证。

人工对照 oracle 和实际触发行为，在报告副本中填写各项 `assessment`：

- `verdicts`：按结果的 finding id 填写 `true-positive` 或 `false-positive`；位置准确仍可能是误报。
- `knownBugFound`：错误样例的已知回归是否被正确识别，填 true/false；正确样例保持 null。
- `notes`：记录触发条件是否成立、是否由本次改动引入、已拒绝候选是否包含已知问题，以及补充观察。
- `complete`：完成所有发现核对后设 true。

汇总人工判断：

```powershell
node scripts/validate-model.mjs --score .local/model-validation/<报告名>.json
```

未判定或调用失败显示待评估，误报、漏报均为未知。错误样例未识别其已知问题记一次漏报；正确样例的发现应记误报。如果发现样例本身还有未预期的问题，应先修订样例及 oracle，不强行套用统计。不要用发现数量或位置核对数量冒充质量分数。

可由助手结合独立执行的 oracle 核对报告，但必须记录 `reviewer`、`method` 与 `userConfirmation`，不能写成用户已人工验收。静态位置校验或模型自报判断不得自动将 `assessment.complete` 设为 true。

若临时目录清理失败，报告另记录 `cleanup.status=retained`、目录与错误码；已返回的评审及用量仍保留，入口会显示报告路径和独立清理警告。不要为了清理失败而重新调用模型。

当前状态（2026-10-18）：已在用户确认后调用 DeepSeek 官方 API `deepseek-flash` 完成四个合成样例。4/4 协议接受，两项已知回归被识别，两项正确简化无发现；助手依据独立执行真值核对为误报 0、漏报 0。实际用量 5514 tokens，金额未知；小样例不代表真实项目总体质量。详见[真实验证证据](../.scratch/ai-review/evidence/2026-10-18-deepseek.md)。
