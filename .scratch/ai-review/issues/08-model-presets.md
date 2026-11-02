# 08 — 模型服务与模型下拉选择

**What to build:** 模型设置优先通过下拉选择服务与模型，只有自定义时填写地址和模型 ID。保留既有设置和密钥保存方式。

**Blocked by:** 01、06（done）。

**Status:** done

- [x] DeepSeek 官方服务自动填写地址，提供已核对的模型选项及自定义模型。
- [x] 自定义服务才显示地址输入；既有非预设配置原样识别，切换选项保留草稿。
- [x] 下拉沿用深色界面，支持键盘、Esc 和外部点击；不因选择而调用模型或保存配置。
- [x] 构建与隔离桌面检查通过，验证预设、自定义、重开读取及密钥保留，不调用真实供应商。

## Evidence

2026-10-18：已阅读 CONTEXT、产品方案设置与数据配置章节及 ADR-0002。服务地址与模型 ID 继续保存为现有格式，无存储迁移。DeepSeek 预设依据[官方模型文档](https://api-docs.deepseek.com/quick_start/pricing/)核对为 `https://api.deepseek.com`、`deepseek-flash`、`deepseek-v4-pro`；新增预设不宣称该模型已经过真实评审质量验证。

`npm run build` 通过（含 TypeScript 检查）。隔离 Electron 桌面检查通过：预设不显示地址或模型输入、选择不会保存或发送请求、自定义模型草稿与服务草稿切换保留、Esc 只收起菜单、键盘选择及外部点击收起、真实设置表单保存/重开读取、预设模型实际持久化为对应 ID，原有加密密钥不变。模型请求仅发往本机模拟服务，Git 写操作全部使用专用临时仓库。实际渲染截图 [model-presets-preview.png](../../../.local/model-presets-preview.png) 已查看，深色菜单无裁切。
