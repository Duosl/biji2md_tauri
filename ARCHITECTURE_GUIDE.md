# biji2md - 架构与开发流程指南

## 1. 项目概览

biji2md 是一个基于 Tauri 构建的跨平台桌面应用，用于将笔记批量导出为 Markdown 格式。

**技术栈**：
- 前端：Vanilla HTML/CSS/JavaScript
- 后端：Rust (Tauri 2.x)
- 支持平台：macOS, Windows, Linux

---

## 2. 目录结构

```
biji2md/
├── src/                        # 前端代码
│   ├── index.html             # 主页面 (双视图切换)
│   ├── index.css              # 样式
│   └── index.js               # 前端逻辑
├── src-tauri/                 # Rust 后端
│   ├── src/
│   │   ├── main.rs            # 程序入口
│   │   ├── lib.rs             # 模块声明与 app 初始化
│   │   ├── types.rs           # 数据结构定义
│   │   ├── api.rs             # API 客户端
│   │   ├── index.rs           # 本地索引管理
│   │   ├── export.rs          # Markdown 导出逻辑
│   │   └── commands.rs        # Tauri commands (前端调用的接口)
│   ├── capabilities/          # 权限配置
│   ├── icons/                 # 应用图标
│   ├── Cargo.toml             # Rust 依赖
│   └── tauri.conf.json        # Tauri 配置
└── package.json               # Node 配置与脚本
```

---

## 3. 核心流程与模块

### 3.1 同步模式选择

| 模式 | 说明 |
|------|------|
| 增量拉取 (Since ID) | 只获取上次同步之后新增或更新的笔记，速度快 |
| 全量拉取 (Full) | 获取所有笔记，确保完整性，速度较慢 |

### 3.2 主同步流程

```
用户选择同步模式 → 点击「开始同步」
  ↓
前端调用 `start_sync(export_dir, sync_mode)`
  ↓
获取 Token → 初始化 IndexManager → 初始化 Exporter → 调用 API
  ├─ 增量模式: 从索引获取 last_id，API 传入 since_id
  └─ 全量模式: 不传入 since_id，获取全部笔记
  ↓
循环处理每条笔记：
  ├─ 判断笔记是否需要更新 (index.rs)
  ├─ 是 → 导出为 Markdown (export.rs) → 更新索引
  └─ 否 → 跳过
  ↓
保存索引 → 完成同步
```

### 3.2 模块职责

| 模块 | 功能 |
|------|------|
| types.rs | 数据结构定义 (Note, Index, SyncProgress...) |
| api.rs | API 客户端，处理所有网络请求 |
| index.rs | 本地索引管理，判断笔记是否需要更新 |
| export.rs | Markdown 文件生成与写入 |
| commands.rs | Tauri 命令桥接层，暴露给前端调用 |

---

## 4. 数据类型 (types.rs)

### 4.1 同步模式枚举

```rust
pub enum SyncMode {
    Incremental,  // 增量拉取（使用 since_id）
    Full,         // 全量拉取
}
```

### 4.2 主要数据结构

```rust
// 笔记数据
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub tags: Vec<Tag>,
    pub edit_time: String,
    pub created_at: String,
}

// 本地索引 (index.json)
pub struct Index {
    pub version: String,
    pub notes: Vec<IndexEntry>,
}

// 索引条目
pub struct IndexEntry {
    pub id: String,
    pub edit_time: String,
    pub file_path: String,
}
```

---

## 5. API 客户端 (api.rs)

### 5.1 主要功能

- `ApiClient::new(token)`: 创建客户端
- `get_notes(limit, since_id, sort)`: 获取一页笔记
- `get_all_notes()`: 循环获取全部笔记
- `get_notes_since(since_id)`: 获取指定 id 之后的笔记

### 5.2 请求信息

- 基础 URL: `https://get-notes.luojilab.com`
- 端点: `/voicenotes/web/notes`
- 认证: `Authorization: Bearer <token>`
- 分页参数: `limit` + `since_id` (上次最后一个 id)

---

## 6. 本地索引 (index.rs)

### 6.1 功能说明

1. **初始化**: 从导出目录加载 `index.json`，如果不存在则创建空索引
2. **判断更新**: `should_update_note(&note)` - 比较 edit_time
3. **更新索引**: `update_note_entry(&note, file_path)`
4. **获取最后 ID**: `get_last_note_id()` - 返回最近同步的最后一条笔记 ID
5. **保存索引**: `save()` - 写入 index.json

### 6.2 索引扩展

```rust
impl Index {
    pub fn get_last_note_id(&self) -> Option<String> {
        // 返回最新的笔记 id，用于增量同步的 since_id
    }
}
```

### 6.2 增量同步原理

```
第一次同步：
├─ 获取所有笔记
├─ 全部导出
└─ 保存 index.json

后续同步：
├─ 获取所有笔记
├─ 对比 edit_time
├─ 有更新 → 重新导出
└─ 无更新 → 跳过
```

---

## 7. Markdown 导出 (export.rs)

### 7.1 功能

- `new(export_dir)`: 初始化，自动创建目录
- `export_note(&note)`: 导出单条笔记

### 7.2 输出格式

```markdown
---
title: 笔记标题
note_id: note_xxx
tags: [标签1, 标签2]
created_at: 2024-01-01T00:00:00Z
updated_at: 2024-01-02T00:00:00Z
---

笔记正文内容...
```

---

## 8. Tauri 命令 (commands.rs)

### 8.1 暴露给前端的接口

| 命令 | 功能 |
|------|------|
| `save_token(token)` | 保存 API Token 到本地 |
| `get_token()` | 读取已保存的 Token |
| `select_export_dir()` | 弹出目录选择器 |
| `start_sync(export_dir, sync_mode)` | 开始同步 (sync_mode: \"incremental\" 或 \"full\") |

### 8.2 SyncMode 映射

```rust
// 前端传字符串，后端转为枚举
match sync_mode_str {
    "incremental" => SyncMode::Incremental,
    "full" => SyncMode::Full,
    _ => SyncMode::Incremental,  // 默认值
}
```

### 8.2 进度事件

同步过程中发送事件:
```rust
app_handle.emit("sync_progress", SyncProgress {
    current: u32,
    total: u32,
    message: String,
})
```

---

## 9. 前端实现

### 9.1 页面结构 (单页面双视图)

```
┌─────────────────────────────┐
│ 主页面 (home-page)          │
│  • 导出目录选择              │
│  • 设置/开始同步按钮        │
│  • 进度条 + 状态            │
│  • 完成结果                  │
└─────────────────────────────┘
      ⬆⬇ 切换
┌─────────────────────────────┐
│ 设置页面 (settings-page)    │
│  • Token 输入 + 保存        │
│  • 返回按钮                 │
└─────────────────────────────┘
```

### 9.2 交互流程

1. 首次打开 → 显示设置页面
2. 用户输入 Token 并保存 → 回到主页面
3. 选择导出目录
4. 点击「开始同步」
5. 监听进度事件 → 更新 UI
6. 显示同步结果

### 9.3 主要函数

```javascript
showHome()
showSettings()
saveToken()
loadToken()
selectDirectory()
startSync()
```

---

## 10. 配置文件要点

### 10.1 package.json

主要脚本：
```json
{
  "dev": "tauri dev",
  "build": "tauri build",
  "build:mac": "tauri build --target universal-apple-darwin",
  "build:windows": "tauri build --target x86_64-pc-windows-msvc",
  "build:linux": "tauri build --target x86_64-unknown-linux-gnu"
}
```

### 10.2 Cargo.toml

主要依赖：
```toml
tauri = { version = "2" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
reqwest = { version = "0.12", features = ["json"] }
tokio = { version = "1", features = ["full"] }
thiserror = "2.0"
```

---

## 11. 开发与发布流程

### 11.1 开发准备

```bash
npm install
npm run dev
```

### 11.2 发布流程

**方法 1 - Git tag (推荐)**

```bash
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

**方法 2 - GitHub UI**

1. Actions 标签页
2. 选择 Build and Release
3. Run workflow

**自动化步骤**：
1. 创建 GitHub Release
2. 从 git 历史生成 Changelog
3. 并行构建所有平台 (macOS / Windows / Linux)
4. 上传 artifacts 到 Release

---

## 12. 文件系统访问

### 12.1 Token 存储

- 位置: `app_data_dir() + "/token.txt"`
- 自动创建目录

### 12.2 索引文件

- 位置: `export_dir + "/index.json"`
- 随导出目录放置

---

## 13. 关键设计决策

| 问题 | 决策 |
|------|------|
| 如何判断更新 | 比较 `edit_time` 时间戳 |
| 文件命名 | `sanitize_filename()` 过滤非法字符 |
| 增量机制 | 使用 `index.json` 持久化状态 |
| 权限访问 | 使用 Tauri 内置的路径 API |

---

## 14. 下一步扩展建议

1. 添加附件下载支持
2. 支持导出过滤（按标签/日期）
3. 添加自动化测试
4. 支持自定义导出模板
5. 添加导出历史查看
