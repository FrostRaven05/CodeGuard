# CodeGuard 设计访谈

更新日期：2026-10-15。状态：方案已确认，第一阶段 Git 工作台已交付，后续阶段尚未实现。

## 来源

- 原始设计：`C:\Project\00Write\ob\文章\04项目方案\代码评审工具\代码提交评审工具.md`。
- 用户指定以 grill-with-docs 方式讨论，结合 show-me、Matt 的 PR 与其他代码评审技能。
- 本文记录已确认的选择及未决问题；原始设计中的其他内容不因此自动成为已确认需求。

## 第一轮：已确认

| 问题 | 用户选择 | 确认内容 |
| --- | --- | --- |
| Q1 首批用户 | A | 先满足用户本人自用。 |
| Q2 核心痛点 | A、B | 同时解决 AI 改动难理解、难审查，以及提交、推送、拉取、合并等 Git 操作繁琐的问题；两者优先级尚未单独确定。 |
| Q3 操作分工 | B | AI 可以发起评审并准备操作，由人确认后执行。 |

## 候选产品方向

围绕一次改动组织理解、评审、验证证据和 Git 操作，暂称“AI 改动验收台”。该名称和具体界面仍是建议。

参考机制：

- [Matt PR](https://github.com/mattpocock/skills/blob/main/skills/engineering/pr/SKILL.md)：改动摘要、验证证据、合并影响。
- [Matt Code Review](https://github.com/mattpocock/skills/blob/main/skills/engineering/code-review/SKILL.md)：分开核对需求符合度和代码规范。
- [Anthropic Code Review](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-review/commands/code-review.md)：候选问题再次核验，减少误报。
- [PR Review Toolkit](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/pr-review-toolkit/commands/review-pr.md)：按改动选择专项检查。

上述机制是设计参考，尚未选定直接执行或集成这些技能。

## 第二轮：已确认

| 问题 | 用户选择 | 确认内容 |
| --- | --- | --- |
| Q4 默认入口 | A | 默认展示全部本地改动，先理解，再选择本次提交内容。 |
| Q5 首版操作 | A、B、C | 覆盖暂存、提交说明生成、提交、推送、拉取远程更新、本地分支切换与合并。远程 PR 流程未选入首版。 |
| Q6 AI 分析来源 | B | 工具独立接入模型、采集上下文并完成评审，不依赖现有编码助手提供评审结果。 |
| Q7 阅读顺序 | A | 默认先展示行为变化与问题摘要，再按需打开代码证据和差异。 |

## 第三轮：已确认

| 问题 | 用户选择 | 确认内容 |
| --- | --- | --- |
| Q8 评审范围 | A | 支持当前未提交改动、单个历史提交、分支相对主分支的改动评审。 |
| Q9 使用入口 | A | 独立桌面应用。 |
| Q10 修复边界 | A | 工具提供证据与修复建议，修复工作交给编码助手；首版不生成或应用修复补丁，不直接修改源码。 |

用户进一步强调：先把评审与 Git 操作做简洁，界面风格和操作均参考 GitKraken。VS Code 的 Git 仍是改动管理方面的参考。

参考入口：

- [VS Code 暂存与提交](https://code.visualstudio.com/docs/sourcecontrol/staging-commits)。
- [GitKraken 差异与历史](https://help.gitkraken.com/gitkraken-desktop/diff/)。
- [GitKraken 推送、拉取与获取](https://help.gitkraken.com/gitkraken-desktop/pushing-and-pulling/)。

## 第四轮：已确认

| 问题 | 用户选择 | 确认内容 |
| --- | --- | --- |
| Q11 模型及代码发送 | A | 模型服务由用户自行配置；允许向该服务发送评审所需代码，支持文件排除，限制为当前评审及必要上下文。 |
| Q12 评审与操作关系 | A | 评审只提醒，不强制阻止提交或合并；使用者决定是否继续。 |
| Q13 需求依据 | A | 自动读取项目规范，需求文档按次可选；没有需求文档时明确显示“未核对需求”。需求符合度与代码问题分别展示。 |

评审提醒规则与执行一致性是两件事：评审问题不构成强制门禁；操作内容发生变化时仍需刷新操作预览，避免执行与所见不一致的内容。

## 第五轮：已确认

| 问题 | 用户选择 | 确认内容 |
| --- | --- | --- |
| Q14 验证命令 | A | 工具支持用户配置并手动运行测试、类型检查等验证命令。 |
| Q15 拉取与冲突 | A | 默认仅快进拉取；分叉时展示差异，由人显式发起合并；冲突交给编码助手，工具展示文件和处理状态。 |
| Q16 首版系统 | A | 首版交付 Windows 独立桌面应用。 |
| Q17 语言 | 自由回答 | TypeScript、JavaScript、Python、Rust、Go、C++。 |

新增明确要求：代码规范可由用户自行配置。先整理完整方案，界面和操作保持简洁，参考 GitKraken。

## 方案交付

- 完整方案：`docs/product-plan.md`。
- 界面概念演示：`docs/ui-concept.html`，使用标注的虚构数据，不执行 Git、模型或检查命令。
- 领域术语：`CONTEXT.md`。

用户随后确认按方案开工，批准四个第一阶段任务、本地 Markdown 跟踪方式、默认状态及 AGENTS.md。实际工作台与旧概念页分开保留，启动入口见根目录 README.md；任务和验收记录见 `.scratch/git-workbench/`。

概念页已通过脚本语法检查，并在浏览器中核对历史视图切换和合并方向预览。浏览器的完整页面截图能力受当前预览环境限制，未作为桌面布局完整视觉验收；概念页不等同于可用的 Git 客户端。
