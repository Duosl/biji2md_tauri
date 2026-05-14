# biji2md - 项目架构与开发指南

## 项目概述

biji2md 是一个基于 Tauri 2.x 的桌面应用，用于将笔记批量导出为 Markdown 格式。

**技术栈**:
- 前端: React 19 + TypeScript + Vite
- 后端: Rust (Tauri 2.x)
- 支持平台: macOS, Windows, Linux

---

## 目录结构

```
biji2md/
├── src/                          # 前端代码
│   ├── main.tsx                 # 应用入口
│   ├── App.tsx                  # 主应用组件
│   ├── index.css                # 全局样式
│   ├── types/
│   │   └── index.ts             # TypeScript 类型定义
│   ├── hooks/
│   │   ├── useSync.ts           # 同步逻辑 Hook
│   │   ├── useSettings.ts       # 设置管理 Hook
│   │   └── useUpdater.ts        # 自动更新 Hook
│   ├── pages/
│   │   ├── SyncPage.tsx         # 同步页面
│   │   └── SettingsPage.tsx     # 设置页面
│   └── components/
│       ├── Toolbar.tsx          # 工具栏组件
│       └── OnboardingGuide.tsx  # 新手引导组件
├── src-tauri/                   # Rust 后端
│   ├── keys/                    # 签名密钥（公钥提交，私钥本地）
│   │   └── biji2md.key.pub      # Tauri 更新签名公钥
│   ├── capabilities/
│   │   └── default.json         # 权限配置
│   ├── src/
│   │   ├── main.rs              # 程序入口
│   │   ├── lib.rs               # 模块声明与 app 初始化
│   │   ├── types.rs             # 数据结构定义
│   │   ├── config.rs            # 配置管理
│   │   ├── api.rs               # API 客户端
│   ├── cache.rs             # 本地笔记缓存 (notes-cache.json)
│   ├── index.rs             # 本地索引管理 (index.json)
│   │   ├── export.rs            # Markdown 导出逻辑
│   │   ├── log.rs               # 同步日志持久化 (sync.log)
│   │   ├── sync.rs              # 同步流程
│   │   ├── history.rs           # 同步历史记录
│   │   ├── state.rs             # 运行时状态
│   │   └── commands.rs          # Tauri 命令
│   └── Cargo.toml
└── package.json
```

---

## 核心模块

### 后端模块 (Rust)

| 模块 | 职责 |
|------|------|
| types.rs | 核心数据结构 (Note, Index, SyncSnapshot, SyncOverview, CacheInfo...) |
| config.rs | 应用配置持久化 (config.json) |
| api.rs | API 客户端，处理网络请求，内部暂存原始 JSON 数据 |
| cache.rs | 本地笔记缓存 (notes-cache.json)，HashMap<id, raw Value> |
| index.rs | 本地索引管理 (index.json) |
| export.rs | Markdown 文件生成 |
| log.rs | 同步日志持久化 (sync.log)，自动裁剪超 10MB 保留 1000 行 |
| sync.rs | 同步流程编排，日志持久化与进度节流 |
| history.rs | 同步历史记录 (history.json) |
| state.rs | 运行时状态管理 |
| commands.rs | Tauri 命令桥接层 |

### 前端模块 (React)

| 模块 | 职责 |
|------|------|
| useSync.ts | 同步状态管理、事件监听、错误捕获、历史日志加载 |
| useSettings.ts | 设置加载/保存、脏状态检测 |
| useUpdater.ts | 自动更新检测、单一下载状态、下载完成后重启 |
| SyncPage.tsx | 同步界面、状态展示 |
| SettingsPage.tsx | 设置界面、配置编辑、关于与更新面板 |

---

## 数据流

### 同步流程

```
用户点击"开始同步"
  ↓
start_sync(export_dir, mode, page_size)
  ↓
验证 Token & 导出目录
  ↓
初始化: ApiClient + IndexManager + Exporter + SyncLog
  ↓
同步开始时裁剪日志 (trim_if_needed)
  ↓
循环拉取笔记分页
  ├─ 每页笔记处理
  │   ├─ should_update_note() → 判断是否需要更新
  │   ├─ export_note() → 导出 Markdown
  │   └─ update_note_entry() → 更新索引
  └─ 发送进度事件 (sync_state, sync_log, sync_item)
     └─ 进度快照节流: 每 500ms 最多发送一次
     └─ 日志同时持久化到 sync.log
  ↓
保存索引 (index.json)
保存历史 (history.json)
发送完成事件 (sync_completed)
```

### 事件系统

| 事件名 | 方向 | 说明 |
|--------|------|------|
| sync_state | 后端→前端 | 同步状态快照 |
| sync_log | 后端→前端 | 日志消息 |
| sync_item | 后端→前端 | 单条笔记处理结果 |
| sync_page | 后端→前端 | 分页处理完成 |
| sync_completed | 后端→前端 | 同步完成 |

---

## 关键数据结构

### 配置 (AppConfig)

```rust
pub struct AppConfig {
    pub token: Option<String>,
    pub default_output_dir: Option<String>,
    pub default_page_size: Option<u32>,
    pub last_mode: Option<String>,
    // 导出偏好
    pub export_structure: Option<String>,      // flat, by_month, by_tag, by_topic
    pub show_sync_tips: Option<bool>,
}
```

### 同步概览 (SyncOverview)

```rust
pub struct SyncOverview {
    pub last_sync_at: Option<u64>,
    pub last_full_sync_at: Option<u64>,
    pub last_mode: Option<String>,
    pub last_summary: Option<SyncHistoryEntry>,
    pub index_path: Option<String>,
    pub recent_failed_count: u32,
    pub has_config: bool,
}
```

---

## API 接口

### Tauri Commands

| 命令 | 功能 |
|------|------|
| get_platform_info() | 获取平台信息 (macos/windows/linux) |
| save_token(token) | 保存 API Token |
| get_settings() | 获取应用设置 |
| save_settings(input) | 保存应用设置 |
| select_export_dir() | 选择导出目录 |
| open_export_dir(dir) | 打开导出目录 |
| get_sync_snapshot() | 获取同步状态快照 |
| get_sync_overview() | 获取同步概览 |
| start_sync(request) | 开始同步 |
| cancel_sync() | 取消同步 |
| check_update() | 检查更新（返回 UpdateInfo） |
| install_update() | 下载并安装更新 |
| get_app_version() | 获取当前应用版本号 |
| get_sync_logs(export_dir, limit) | 从 sync.log 加载历史日志 |
| get_cache_info() | 获取笔记缓存元信息（是否存在、条数、时间戳、文件大小） |
| reexport_from_cache() | 从本地缓存重新导出 Markdown 文件 |

> 前端更新入口以 `useUpdater` 为主：启动后静默检查并下载，设置页复用同一份更新状态；下载完成后 Toolbar 和设置页只触发 `relaunch()`，避免重复下载。`process:allow-restart` 必须保留在 capability 中。

---

## 开发规范

### 代码风格

- Rust: 使用 `snake_case`，错误处理用 `Result<T, String>`
- TypeScript: 使用 `camelCase`，类型定义在 `types/index.ts`
- CSS: 使用 BEM-like 命名，变量在 `:root` 定义

### 文件规模

- 单文件不超过 800 行
- 函数不超过 50 行
- 组件专注单一职责

### 错误处理

- 后端: 使用 `map_err` 转换错误为可读消息
- 前端: 使用 `try/catch`，错误显示在 UI

---

## 构建命令

```bash
# 开发
npm run dev

# 类型检查
npm run frontend:typecheck

# 构建
npm run build

# 平台特定构建
npm run build:mac
npm run build:windows
npm run build:linux
```

---

## 最近更新

### 阶段 A (P0) - 完成
- 设置页添加保存按钮、保存状态提示、脏状态检测
- 移除 autoStart/darkMode 假功能
- 同步页添加环境状态卡
- 同步页添加 Token 缺失提示
- 模式切换添加说明文案

### 阶段 B (P1) - 完成
- 添加首次引导态（配置未完成时显示）
- 新增 get_sync_overview 接口
- 同步历史持久化 (history.json)
- 首页展示上次同步摘要
- 展示失败项

### 阶段 B+ (P1+) - 完成
- 新增分步新手引导组件 (OnboardingGuide)
- 4 步引导流程：欢迎 → Token → 目录 → 完成
- 步骤指示器显示当前进度
- 支持跳过引导
- 应用启动时自动检测并弹出引导

### 阶段 C (P2) - 完成
- 导出目录结构配置 (flat/by_month/by_tag)
- 文件名规则固定为 title（移除 date_title_id 选项和用户配置）
- 添加打开导出目录功能
- 添加打开导出目录按钮

### 阶段 D (P3) - 完成
- 设置页改为字段级自动保存（失焦即保存）
- 后端新增 `save_setting_field` 命令支持单个字段保存
- 移除页面级保存按钮，每个字段独立显示保存状态
- Token 仍保留独立保存按钮（安全考虑）

### 阶段 E (跨平台适配) - 完成
- 新增 `get_platform_info` Tauri 命令，返回平台类型、标题栏高度、窗口控制按钮位置
- 前端启动时获取平台信息并注入 `data-platform` 属性与 CSS 变量
- 工具栏布局改为数据驱动：`--title-bar-height`、`--window-controls-space` 变量
- 字体栈增加 Ubuntu、Noto Sans、Consolas 支持
- 平台特定 CSS 规则：macOS (38px, 76px 左侧空间)、Windows (40px, 圆角 4px)、Linux (40px, 圆角 3px)

### 阶段 F (UI 精简) - 完成
- 移除「最近导出」列表展示，仅保留失败项（RecentExportItem、ExportCollector 删除）
- 同步结果区模式标签移至标题行，删除索引路径展示和复制按钮
- 移除「同步完成后自动打开目录」功能（openOutputDirAfterSync 删除）
- Token 输入改为密码框，支持明文/密文切换，保存后保留值
- 后端 AppSettings 新增 token 字段返回实际值
- 设置页清空按钮改为危险色（btn-danger）
- section-header 布局改为居左

### 阶段 G (自动更新) - 完成
- 新增 Tauri Updater 插件集成（tauri-plugin-updater + tauri-plugin-process）
- 后端新增 `check_update`、`install_update`、`get_app_version` 三个命令
- 前端 `useUpdater` Hook：启动时 + 每 24 小时静默检测，默认静默下载
- 设置页添加版本信息展示和"检查更新"按钮
- GitHub Actions Release 工作流升级：生成签名、updater 格式、latest.json
- endpoints 配置 GitHub (主) + kkgithub (备) 双源 fallback
- 签名密钥对已生成（公钥提交仓库，私钥需配置 GitHub Secrets）

### 阶段 H (日志持久化 & 同步体验) - 完成
- 新增 `log.rs` 模块：同步日志持久化到导出目录 `sync.log`，JSONL 格式
- `SyncLog` 结构体：`open()` / `append()` / `read_recent()` / `trim_if_needed()`
- 日志文件超 10MB 自动裁剪，保留最近 1000 行；同步开始时主动裁剪
- `emit_log()` 改为同时写入文件和发送前端事件
- 新增 `get_sync_logs` Tauri 命令，前端可从文件加载历史日志
- `useSync` 新增 `syncError` 状态捕获同步失败、`clearSyncError()`、`loadHistoryLogs()`
- 同步页日志区改为可折叠面板（自动展开/手动收起），不再限制预览条数
- 同步页新增错误提示横幅（sync-error-alert），可关闭
- 进度条新增不确定模式（indeterminate），未知总数时显示滑动动画
- 进度快照发送节流至 500ms 间隔，减少前端渲染压力
- 增量模式日志显示上次同步时间戳（`format_timestamp` 工具函数）
- "打开导出目录"按钮移至操作区，同步结果区不再重复
- 设置页新增"关于"区域：版本号展示 + 检查更新按钮 + 更新状态
- App 集成 `useUpdater`，Toolbar 显示更新徽标，侧栏版本号动态获取

### 阶段 I (0.3.0 发布准备) - 完成
- 版本号统一升级到 `0.3.0`（package、Cargo、Tauri 配置与锁文件）
- 自动更新状态统一到 App 顶层 `useUpdater`，设置页和 Toolbar 共享检查、下载、重启状态
- 更新下载完成后 Toolbar 显示「重启更新」胶囊按钮，设置页显示就绪状态和重启按钮
- capability 新增 `process:allow-restart`，确保正式包可调用 `relaunch()`
- 设置页「关于」区域改为品牌信息面板，使用 `ic_logo.svg` 并展示下载/就绪/错误状态
- 移除 Toolbar 左侧拖拽区域，避免标题栏按钮被 `data-tauri-drag-region` 吃掉点击
- 更新检查日志增加 endpoint、请求参数、HTTP 状态与响应摘要，便于诊断私有仓库、404、签名等问题

### 阶段 J (本地笔记缓存) - 完成
- 新增 `cache.rs` 模块：CacheManager 管理以 note_id 为 key 的 HashMap 缓存（原始 serde_json::Value）
- 存储位置：`dirs::config_dir()/biji2md/notes-cache.json`（跟随应用走，不绑定导出目录）
- `api.rs` 前置改造：精简 extract_notes 为精确 c.list 路径；ApiClient 新增 last_raw_notes 暂存 + take_raw_notes()
- 同步流程自动填充缓存：每页拉取后 take_raw + upsert_raw；子笔记同样缓存；同步完成后保存
- 新增 `reexport_from_cache` Tauri 命令：从缓存读取原始数据 → 用当前版 note_from_value 解析 → Exporter 重导出
- 新增 `get_cache_info` Tauri 命令：返回缓存元信息（是否存在、条数、时间戳、文件大小）
- 前端 useSync 扩展 cacheInfo/loadCacheInfo/reexportFromCache
- SyncPage 添加「📦 使用缓存重导出」按钮 + 缓存状态展示
- Tag 结构体新增 tag_type 字段
- note_from_value 改为 pub（供 reexport 路径使用）

### 阶段 K (Bug 修复 & 精简) - 进行中
- 文件名模式精简：移除 `date_title_id`，仅保留 `title`，移除用户配置 UI
- 修复重导出结束后按钮卡在置灰状态（catch_unwind + disabled 保护）
- 修复 `run_reexport` IndexManager 加载路径不一致，统一从 app_cache_dir 获取
- `run_reexport` 日志持久化到 sync.log（开始/错误/完成摘要）
- 迁移成功后删除导出目录中的原文件（index.json/history.json/sync.log）
- SyncStatus 新增 `Cancelled` 终态变体，取消完成状态正确区分
- 重导出按钮增加 `disabled={isRunning}` 防止并发点击
