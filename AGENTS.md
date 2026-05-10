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
│   │   └── useSettings.ts       # 设置管理 Hook
│   ├── pages/
│   │   ├── SyncPage.tsx         # 同步页面
│   │   └── SettingsPage.tsx     # 设置页面
│   └── components/
│       └── Toolbar.tsx          # 工具栏组件
├── src-tauri/                   # Rust 后端
│   ├── src/
│   │   ├── main.rs              # 程序入口
│   │   ├── lib.rs               # 模块声明与 app 初始化
│   │   ├── types.rs             # 数据结构定义
│   │   ├── config.rs            # 配置管理
│   │   ├── api.rs               # API 客户端
│   │   ├── index.rs             # 本地索引管理
│   │   ├── export.rs            # Markdown 导出逻辑
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
| types.rs | 核心数据结构 (Note, Index, SyncSnapshot, SyncOverview...) |
| config.rs | 应用配置持久化 (config.json) |
| api.rs | API 客户端，处理网络请求 |
| index.rs | 本地索引管理 (index.json) |
| export.rs | Markdown 文件生成 |
| sync.rs | 同步流程编排 |
| history.rs | 同步历史记录 (history.json) |
| state.rs | 运行时状态管理 |
| commands.rs | Tauri 命令桥接层 |

### 前端模块 (React)

| 模块 | 职责 |
|------|------|
| useSync.ts | 同步状态管理、事件监听 |
| useSettings.ts | 设置加载/保存、脏状态检测 |
| SyncPage.tsx | 同步界面、状态展示 |
| SettingsPage.tsx | 设置界面、配置编辑 |

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
初始化: ApiClient + IndexManager + Exporter
  ↓
循环拉取笔记分页
  ├─ 每页笔记处理
  │   ├─ should_update_note() → 判断是否需要更新
  │   ├─ export_note() → 导出 Markdown
  │   └─ update_note_entry() → 更新索引
  └─ 发送进度事件 (sync_state, sync_log, sync_item)
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
    pub export_structure: Option<String>,      // flat, by_month, by_tag
    pub file_name_pattern: Option<String>,     // title_id, date_title_id
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
- 文件名规则配置 (title_id/date_title_id)
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
