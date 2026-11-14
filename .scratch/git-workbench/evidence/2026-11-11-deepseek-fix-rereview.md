# DeepSeek 修复复审与保存重读

2026-11-11，香港时间 22:58 开始模型调用。按用户授权复用系统保护的已保存 DeepSeek 配置，在无窗口后台进程调用实际 ReviewService；没有操作桌面。

## 范围与调用

在 `.local/model-validation/1794409122132-36d249f5-6736-4c14-a0d3-5de08bc29028-fix-rereview/repository` 创建专用隔离仓库。组件父版本取上次真实评审树 `1facb796487585bf653323958a4d0ebc268bc5cd`，新版本取任务 18 修复后的工作区文件。实际 App 调用方保存在两棵树中作为未变文件，不修改用户索引。

发送 3 个差异文件：`src/CommitMessageComposer.tsx`、`tests/commit-message-ui.cjs`、`scripts/desktop-smoke.mjs`，并由正常上下文收集器补充同一固定版本的片段；无差异文件被排除。配置预算内统计 36847 字符。需求只描述准备取消、旧请求与重试隔离、仓库隔离的预期行为，没有预填通过结论。

真实服务 `https://api.deepseek.com`，模型 `deepseek-flash`，单次请求，无自动重试。实际阶段完整结束：核对 → 请求 → 思考 → 接收 → 格式/位置核对 → 保存 → 完成。模型耗时 218.05 秒，实际流传输 10731226 字节，正文 794 字符。实际用量 prompt 11010、completion 34104、total 45114 tokens；金额未知。

## 复审结论与后续处理

模型摘要正确识别了准备取消立即释放 phase/任务、成功/失败/收尾按 activeTask 身份隔离，以及取消 IPC 错误只影响当前任务。原先准备取消卡住问题未再次报告；这属于“本轮未再发现”，不能单凭模型判断宣称验证修复。

本轮唯一发现是一条测试同步 P2：主进程 prepare 的 done 先于 IPC 返回和渲染端 finally，固定 75 毫秒等待可能漏检晚到任务。该时间顺序成立，已将生成按钮直接绑定返回 Promise 的真实 generate 函数，专项测试保存并等待实际 React 处理函数的 Promise 后再断言，覆盖渲染端 catch/finally；删除了两个固定 75 毫秒等待及主进程 done 信号。常规 DOM 点击由完整桌面回归覆盖。

四项后台专项再次通过：准备时切换仓库、取消后立即重试及旧成功晚到、旧失败晚到、生成已发出后切换仓库。模型复审针对任务 18 的固定版本；之后的测试同步改动由执行回归验证，未再额外请求模型。不自动暂存工作区修复，原用户暂存快照保持不变。

测试同步调整后，完整隐藏桌面回归、TypeScript 检查、生产构建、diff 空白检查通过，常规 DOM 生成点击、人工编辑、生成中取消、评审定位、提交与同步流程继续正常。

## 保存和重新读取

结果 ID：`4475b288-597f-4e07-a0ba-0b030a406527`。

记录保存在上述目录的 `state/reviews/f0d93b03438eda7f6ddb.json`，详细检查报告为 `report.json`。正常服务已返回 completed 并原子保存；新服务读取结果 ID、摘要、完整发现数组一致，结果未过期。另启动独立无窗口进程，结果 ID、摘要 SHA-256、发现数组 SHA-256 再次一致，读取时模型调用为 0。

后台验证脚本最初直接比较内存对象与 JSON 对象，误将 JSON 省略的 undefined 可选字段（暂存范围 localRevision）判为不一致。修正验证比较方式后，使用新进程核对已保存结果；没有重新调用模型，没有修改产品存储代码。报告保留 harnessCorrection 说明。

复核读取（不联网）命令：

```powershell
node .local/verify-fixed-review.mjs --reread=.local/model-validation/1794409122132-36d249f5-6736-4c14-a0d3-5de08bc29028-fix-rereview/report.json
```

用户索引 SHA-256 仍为 `007F7BBC139E4C1E2EBFD9F6BADDBED59D2C42E8382E3C61C7FCCDBA7A9E50EC`。密钥与模型配置只读，未打印密钥、认证头或内部推理；评审记录仅落入隔离验证目录。
