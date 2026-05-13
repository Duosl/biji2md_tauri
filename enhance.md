**需求文档**
一期目标是提升可用性和留存基础，不增加自动化能力。范围限定在现有同步、设置、导出体验内。

核心问题：
- 用户不知道当前是否已经配置完整。
- 用户改了设置，缺少明确的保存反馈。
- 用户首次使用路径不顺，需要自己理解页面关系。
- 同步过程和结果反馈偏弱，失败不可诊断。
- 导出结果虽然可用，但不够适合长期使用。

核心目标：
- 首次使用 3 分钟内完成配置并成功同步一次。
- 非首次使用时，首页 5 秒内看懂当前状态。
- 关键错误必须可见、可解释、可重试。
- 导出结果对长期积累更友好。

非目标：
- 不做自动化任务。
- 不做多账户。
- 不做复杂导出模板系统，只做最小可配版本。

成功指标：
- 首次配置完成率提升。
- 同步失败后的二次尝试率提升。
- 用户重开应用后仍能看到上次同步结果。
- 导出目录在中等规模笔记下仍可维护。

**页面改动清单**
1. 同步页 [SyncPage.tsx](/Users/duoshilin/duosl/sidework/biji2mdTauri/src/pages/SyncPage.tsx:8)
- 顶部增加“环境状态卡”：Token、导出目录、同步模式、分页大小。
- 未完成配置时，主 CTA 不直接“开始同步”，改为“去完成配置”或“继续引导”。
- 模式切换旁增加说明文案：
  增量适合日常同步；历史编辑可能需要全量。
- 增加“上次同步摘要”常驻区：
  上次时间、上次模式、新增/更新/失败数量、是否取消。
- 增加“最近导出 5 条”列表：
  标题、动作、导出文件名。
- 日志区增加筛选：
  全部、仅错误、关键节点。
- 同步完成后增加快捷操作：
  打开导出目录、复制索引路径、查看失败项。

2. 设置页 [SettingsPage.tsx](/Users/duoshilin/duosl/sidework/biji2mdTauri/src/pages/SettingsPage.tsx:8)
- 增加“保存设置”主按钮，触发现有 `handleSave`。
- 增加保存成功/失败提示。
- 增加脏状态判断：
  用户修改但未保存时提示。
- 增加导出偏好设置：
  导出组织方式、文件名规则、是否同步完成后打开目录。
- 暂时移除或禁用未落地项：
  `autoStart`、`darkMode`，避免假功能。
- Token 区增加状态说明：
  已配置、最近一次鉴权失败提示位。

3. 首次引导态
- 条件：`hasToken=false` 或 `defaultOutputDir` 为空。
- 步骤：
  配置 Token -> 选择目录 -> 确认模式并试跑。
- 完成后回到普通同步页，并展示首次成功结果。

**后端接口改动清单**
1. 配置模型扩展 [config.rs](/Users/duoshilin/duosl/sidework/biji2mdTauri/src-tauri/src/config.rs:10)
- 新增字段：
  `export_structure`
- 新增字段：
  `file_name_pattern`
- 新增字段：
  `open_output_dir_after_sync`
- 新增字段：
  `show_sync_tips`
- 保持向后兼容，缺省值可自动回填。

2. 设置返回模型扩展 [types.rs](/Users/duoshilin/duosl/sidework/biji2mdTauri/src-tauri/src/types.rs:133)
- `AppSettings` 增加上述新字段。
- `SaveSettingsInput` 增加对应字段。
- `save_settings` 增加字段级校验和默认值处理。[commands.rs](/Users/duoshilin/duosl/sidework/biji2mdTauri/src-tauri/src/commands.rs:31)

3. 同步摘要查询接口
- 新增 `get_sync_overview`
- 返回内容：
  上次同步时间、上次全量时间、上次模式、上次结果摘要、索引路径、最近失败数、最近导出条目。
- 数据来源优先从 `index.json` 和轻量历史文件读取。

4. 同步历史持久化
- 每次同步完成后写一份轻量 `history.json`
- 记录：
  时间、模式、total、created、updated、skipped、failed、cancelled、最近导出项。
- 这样前端重开后还能展示结果，不再依赖内存态 `summary`。[useSync.ts](/Users/duoshilin/duosl/sidework/biji2mdTauri/src/hooks/useSync.ts:57)

5. 导出能力最小扩展 [export.rs](/Users/duoshilin/duosl/sidework/biji2mdTauri/src-tauri/src/export.rs:21)
- 支持导出目录结构：
  `flat`、`by_month`、`by_tag`
- 支持文件名规则：
  `title`、`date_title_id`
- 如果标题变化导致路径变化，利用索引中的 `file_path` 做重命名或旧文件清理。[index.rs](/Users/duoshilin/duosl/sidework/biji2mdTauri/src-tauri/src/index.rs:44)

6. 打开导出目录接口
- 新增 `open_export_dir`
- 同步完成后供前端按钮调用。
- 如果配置了 `open_output_dir_after_sync=true`，同步成功后自动触发。

**前端状态与数据流改动**
- `useSettings` 增加保存状态、错误状态、脏状态。
- `useSync` 增加：
  `overview`
- `useSync` 监听并消费 `sync_page`、`sync_item`，组装最近导出列表与失败列表。
- 初始化阶段不再吞错，改成设置可见错误状态。[useSync.ts](/Users/duoshilin/duosl/sidework/biji2mdTauri/src/hooks/useSync.ts:115)

**开发任务列表**
P0
- 设置页补保存按钮、保存反馈、未保存状态。
- 去掉或禁用 `autoStart` / `darkMode` 假入口。
- 同步页增加配置状态卡。
- 同步页补 Token 缺失提示。
- `useSettings` / `useSync` 统一错误处理。
- 模式说明文案接入同步页。

P1
- 新增首次引导态。
- 新增 `get_sync_overview` 接口。
- 同步历史持久化。
- 首页展示上次同步摘要。
- 前端消费 `sync_item`，展示最近导出 5 条和失败项。

P2
- 导出结构最小配置。
- 文件名规则配置。
- 打开导出目录能力。
- 同步完成后的快捷操作。
- 日志筛选与关键节点展示。

**建议分期**
阶段 A，1 周内可交付
- P0 全部
- 这是“从能用到可信”的最低版本

阶段 B，1 周内可交付
- P1 全部
- 这是“从可信到顺手”的版本

阶段 C，1 周内可交付
- P2 全部
- 这是“从顺手到适合长期使用”的版本

**验收清单**
- 新用户首次打开，无需看文档可完成首次同步。
- 设置变更后有明确保存结果。
- 重启应用后，仍能看到上次同步摘要。
- 同步失败时，页面能明确说明原因。
- 用户能看到最近导出了哪些文件。
- 导出目录可按最小规则组织，不再只能平铺。
