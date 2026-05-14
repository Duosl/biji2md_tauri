# AGENTS.md

本文件适用于整个仓库。如果子目录中存在新的 `AGENTS.md`，则该子目录下的文件以更近的指令为准。

## 项目概述

`biji2md` 是一个基于 Tauri 2 的桌面应用，用于同步笔记并导出为 Markdown 文件。

- 前端：React 19、TypeScript、Vite。
- 后端：Rust、Tauri 2。
- 支持平台：macOS、Windows、Linux。
- 当前应用版本定义在 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中；修改版本号时必须保持三处一致。

## 仓库结构

- `src/main.tsx`：React 入口。
- `src/App.tsx`：应用外壳、平台初始化、更新状态所有者。
- `src/index.css`：全局 CSS 和平台相关布局变量。
- `src/types/index.ts`：前端共享 TypeScript 类型。
- `src/hooks/useSync.ts`：同步状态、事件监听和历史日志。
- `src/hooks/useCache.ts`：本地笔记缓存查询与重导出。
- `src/hooks/useSettings.ts`：设置加载/保存和字段级持久化。
- `src/hooks/useUpdater.ts`：更新检查、下载/安装状态、重启就绪状态。
- `src/pages/SyncPage.tsx`：同步流程界面。
- `src/pages/SettingsPage.tsx`：设置、Token、导出偏好、缓存重导出、关于和更新界面。
- `src/pages/AutomationPage.tsx`：自动化相关界面。
- `src/components/Toolbar.tsx`：顶部工具栏和更新徽标/重启动作。
- `src/components/OnboardingGuide.tsx`：首次使用引导。
- `src-tauri/src/main.rs`：二进制入口。
- `src-tauri/src/lib.rs`：Tauri builder、插件初始化、命令注册。
- `src-tauri/src/types.rs`：后端数据结构和事件载荷。
- `src-tauri/src/config.rs`：应用配置持久化。
- `src-tauri/src/api.rs`：笔记 API 客户端和原始 JSON 捕获。
- `src-tauri/src/cache.rs`：本地笔记缓存，位于应用配置目录的 `notes-cache.json`。
- `src-tauri/src/index.rs`：本地同步索引管理。
- `src-tauri/src/export.rs`：Markdown 导出和同名文件冲突处理。
- `src-tauri/src/log.rs`：持久化 JSONL 同步日志。
- `src-tauri/src/sync.rs`：同步和缓存重导出编排。
- `src-tauri/src/history.rs`：同步历史持久化。
- `src-tauri/src/state.rs`：运行时同步状态。
- `src-tauri/src/commands.rs`：Tauri 命令桥接层。
- `src-tauri/capabilities/default.json`：应用权限配置。
- `src-tauri/keys/biji2md.key.pub`：仅包含更新器公钥。

## 开发命令

- `npm run frontend:dev`：在 `127.0.0.1:1420` 启动 Vite。
- `npm run dev`：运行完整 Tauri 开发应用。
- `npm run frontend:typecheck`：运行 TypeScript 类型检查。
- `npm run frontend:build`：构建前端到 `dist`。
- `cargo check`：从仓库根目录或 `src-tauri` 检查 Rust 代码。
- `npm run build`：构建 Tauri 应用包。
- `npm run build:mac`、`npm run build:mac-intel`、`npm run build:mac-arm`、`npm run build:windows`、`npm run build:linux`：平台构建命令。

优先选择能覆盖改动面的最小验证命令。仅前端改动运行 `npm run frontend:typecheck`；如果影响打包行为或 Vite 配置，再加跑 `npm run frontend:build`。Rust 改动运行 `cargo check`。涉及前后端命令或类型契约的改动，需要同时运行 TypeScript 类型检查和 `cargo check`。

## Agent 工作流

- 编辑前先阅读相关文件，并遵循已有本地模式。
- 改动范围应聚焦用户请求，不做无关重构。
- 保留工作区中已有的用户改动或生成改动。
- 除非任务明确要求，不要手动编辑 `dist/`、lockfile 内部内容或 Tauri 生成的 schema。
- 搜索优先使用 `rg`，读取文件时尽量定向读取。
- 新增、删除或重命名 Tauri 命令时，需要同步更新 `src-tauri/src/commands.rs`、`src-tauri/src/lib.rs` 中的命令注册、前端 `invoke(...)` 调用点，以及必要的 TypeScript/Rust 载荷类型。
- 添加依赖插件的能力时，需要同时检查 `src-tauri/tauri.conf.json` 和 `src-tauri/capabilities/default.json`。
- 不要提交密钥、私有更新签名 key、Token、导出的笔记或本地用户数据。仓库中只应保留 `src-tauri/keys/` 下的更新器公钥。

## 代码风格

- Rust 使用 `snake_case`；面向命令边界的错误使用 `Result<T, String>`，并通过可读的 `map_err(...)` 转换错误信息。
- TypeScript 使用 `camelCase`；共享 UI/领域类型放在 `src/types/index.ts`。
- CSS 使用 `:root` 变量和类 BEM 命名。
- 保持模块聚焦。建议单文件不超过约 800 行，函数不超过约 50 行，React 组件围绕单一职责组织。
- 只有在能解释非显而易见行为时才添加注释。

## 前端规则

- 除非任务明确要求重新设计，否则保持当前桌面应用的视觉语言。
- 平台布局由 `get_platform_info`、`data-platform` 和 `--title-bar-height`、`--window-controls-space` 等 CSS 变量驱动。
- 设置项通过 `save_setting_field` 做字段级自动保存；Token 保存仍是独立的显式动作。
- 更新状态由 `App` 顶层的 `useUpdater` 持有，并共享给工具栏和设置页。避免重复维护更新检查/下载状态。
- 更新下载完成后，仅在更新器就绪时调用 `relaunch()`。必须保留 capabilities 中的 `process:allow-restart`。
- 不要重新引入已移除的占位设置，例如 `autoStart`、`darkMode` 或同步完成后自动打开导出目录的行为。

## 后端规则

- 保持同步进度事件与前端兼容：`sync_state`、`sync_log`、`sync_item`、`sync_page`、`sync_completed`。
- 同步日志以 JSONL 形式持久化到导出目录的 `sync.log`。`SyncLog` 会在日志超过 10 MB 时裁剪，并保留最近 1000 行。
- 应用配置/缓存目录存放应用级数据，例如 `notes-cache.json`；导出目录存放面向用户的输出和同步产物，例如 `notes/`、`index.json`、`history.json` 和 `sync.log`。
- 缓存重导出在命令边界上是 fire-and-forget；进度应通过同一套同步事件/日志路径上报。
- `SyncStatus::Cancelled` 是独立于成功完成的终态。
- 导出文件名基于标题。`Exporter` 必须继续安全处理重复标题，并追加数字后缀。
- 当前导出设置支持的目录结构为 `by_topic`、`by_month`、`by_tag` 和 `flat`；除非现有代码另有要求，默认使用 `by_topic`。

## 数据与安全

- Bearer Token 是本地用户密钥。不要写入日志，也不要在 UI 中暴露，现有密码框明文切换行为除外。
- 不要把私有签名密钥加入仓库。发布签名密钥应只存在于发布环境。
- 导出和迁移代码中的文件删除要谨慎。只能删除应用创建且当前流程明确拥有的文件。
- 网络/API 错误信息应便于诊断，但不能泄露凭据。

## 测试说明

- 当前 `package.json` 中没有专用单元测试脚本。
- TypeScript 验证使用 `npm run frontend:typecheck`。
- Rust 验证使用 `cargo check`。
- 前端构建产物或打包行为可能受影响时，使用 `npm run frontend:build`。
- 同步相关手动冒烟测试：运行 `npm run dev`，配置 Token 和导出目录，按需测试增量同步和全量同步，然后检查日志展示、失败项展示、取消流程和导出文件。
