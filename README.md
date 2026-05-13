# biji2md - 笔记批量导出工具

<p align="center">
  <strong>将笔记批量同步并导出为 Markdown 文件，安全备份到本地</strong>
</p>

<p align="center">
  <img alt="Platform" src="https://img.shields.io/badge/Platform-macOS%20|%20Windows%20|%20Linux-blue" />
</p>

---

## 产品介绍

**biji2md** 是一款基于 Tauri 2 的桌面应用，用于将线上笔记批量同步并导出为 Markdown 文件。

### 为什么需要 biji2md？

- **本地备份**：将云端笔记安全保存到本地
- **格式自由**：导出为通用 Markdown，可被 Obsidian、VS Code 等任何工具读取
- **增量同步**：只同步变化的内容，高效省时

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 批量导出 | 一次同步所有笔记为独立的 `.md` 文件 |
| 增量同步 | 本地索引记录同步状态，只处理新增笔记 |
| 全量同步 | 重新检查所有笔记，完整重建本地文件，可以更新远程修改过的笔记 |
| 目录结构 | 支持按知识库、按月份、按标签、平铺四种组织方式 |
| 文件命名 | 支持「仅标题」「标题+ID」「日期+标题+ID」三种规则 |
| YAML 元数据 | 每个文件包含笔记 ID、标签、创建时间、更新时间 |
| 自动更新 | 启动时静默检测，后台下载完成后一键重启更新 |
| 同步日志 | 日志持久化到本地文件，可离线查看历史诊断信息 |
| 跨平台 | 支持 macOS、Windows、Linux |

---

## 即将实现

暂无规划中的功能。

---

## 快速开始

### 第一步：获取 Token

打开应用后进入 **设置** 页面，在「API 配置」区域填写你的 Bearer Token。

> **Token 安全说明**：Token 仅保存在本地，不会上传至任何服务端。

### 第二步：选择导出目录

在「存储配置」中选择导出目录。所有 Markdown 文件、索引文件和历史记录都会保存在此目录下。

### 第三步：开始同步

回到 **同步** 页面：

- **增量同步**：适合日常使用，只导出新增或变化的笔记
- **全量同步**：首次同步或需要重建本地文件时使用

---

## 详细使用教程

### 首次使用引导

应用启动时，如果检测到未配置 Token，会自动弹出引导流程：

1. **欢迎页**：了解应用功能
2. **填写 Token**：在设置中填入你的 Bearer Token
3. **选择目录**：指定本地导出目录
4. **完成**：开始同步

### 同步页面功能

同步页面展示以下信息：

- **上次同步摘要**：同步时间、模式、处理数量
- **失败项**：本次同步中处理失败的笔记
- **同步错误**：同步失败时显示错误横幅，可关闭
- **诊断日志**：可折叠日志面板，支持按级别筛选

页面顶部可切换同步模式（增量/全量），点击「开始同步」执行同步。

### 设置页面配置项

#### API 配置

| 配置项 | 说明 |
|--------|------|
| Bearer Token | 访问笔记数据的凭证，密码框输入，支持查看明文 |

#### 存储配置

| 配置项 | 说明 |
|--------|------|
| 导出目录 | 同步生成文件的保存位置 |
| 默认分页大小 | 每次请求拉取的笔记数量，默认 100 |

#### 导出偏好

| 配置项 | 可选值 | 说明 |
|--------|--------|------|
| 导出目录结构 | `by_topic`（按知识库）/ `by_month`（按月份）/ `by_tag`（按标签）/ `flat`（平铺） | 决定文件在目录中的组织方式 |
| 文件名规则 | `title`（仅标题）/ `date_title_id`（日期+标题+ID） | 决定文件命名方式 |
| 显示同步提示 | 开/关 | 同步时是否显示详细日志 |

#### 关于与更新

| 配置项 | 说明 |
|--------|------|
| 当前版本 | 动态获取应用版本号 |
| 检查更新 | 手动检查是否有新版本；发现更新后可下载，下载完成后重启生效 |

---

## 导出文件格式

导出的 Markdown 文件包含两部分内容：

### 文件名

```
# title 格式
我的笔记.md

# date_title_id 格式
2026-05-10_我的笔记__title-id.md
```

### 文件内容

```markdown
---
title: "笔记标题"
note_id: "note-id"
tags: ["工作", "项目"]
topics: ["产品知识库"]
created_at: "2026-05-09"
updated_at: "2026-05-10"
---

这里是笔记正文内容，支持所有 Markdown 语法。
```

---

## 目录结构说明

同步后导出目录的结构如下：

```
导出目录/
├── notes/                    # 笔记文件（按配置的组织方式）
│   ├── 我的笔记-title-id.md
│   └── 2026-05/
│       └── 另一篇笔记-title-id2.md
├── index.json                # 本地索引，记录每条笔记的同步状态
├── history.json              # 同步历史记录
└── sync.log                  # 同步日志（JSONL 格式，自动裁剪）
```

### 四种目录结构

- **平铺 (flat)**：所有文件放在 `notes/` 根目录
- **按月份 (by_month)**：按 `YYYY-MM/` 子目录分组
- **按标签 (by_tag)**：按第一个标签创建子目录
- **按知识库 (by_topic)**：按第一个知识库创建子目录；没有知识库时归入 `0未加入知识库/`

---

## 故障排除

### 同步失败

1. **Token 失效**：检查 Token 是否正确，是否有过期
2. **网络问题**：确保网络连接正常，可访问笔记服务端
3. **目录权限**：确认导出目录有写入权限

### 增量同步未生效

如果新增的笔记没有被同步，尝试执行一次全量同步。

### 导出文件缺失

检查 `index.json` 中该笔记的 `synced` 状态，尝试删除索引后重新全量同步。

### 自动更新没有反应

1. 确认当前应用是正式构建的 `.app`/安装包，而不是 `tauri dev`
2. 确认 GitHub Releases 或镜像地址可匿名访问 `latest.json` 和更新包
3. 确认 `latest.json` 中的签名与应用内置公钥匹配
4. macOS 更新依赖 `.app.tar.gz` 和对应 `.sig`，不是 `.dmg`

---

## 下载安装

在 [GitHub Releases](https://github.com/Duosl/biji2md_tauri/releases) 页面下载对应平台的安装包。

### macOS

| 芯片类型 | 下载文件 |
|----------|----------|
| Apple Silicon / M 系列 | `macos_apple-silicon.dmg` |
| Intel 芯片 | `macos_intel.dmg` |
| 不确定 | `macos_universal.dmg` |

### Windows

下载 `.msi` 安装包。

### Linux

下载 `.AppImage` 或 `.deb` 包。

---

## 本地开发

### 环境要求

- Node.js
- npm
- Rust
- Tauri CLI

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

### 类型检查

```bash
npm run frontend:typecheck
```

### 构建应用

```bash
# 构建所有平台
npm run build

# 平台特定构建
npm run build:mac
npm run build:mac-arm
npm run build:mac-intel
npm run build:windows
npm run build:linux
```

---

## 项目结构

```
biji2md/
├── src/                      # 前端 React 代码
│   ├── main.tsx             # 应用入口
│   ├── App.tsx             # 主应用组件
│   ├── pages/              # 页面组件
│   │   ├── SyncPage.tsx   # 同步页面
│   │   └── SettingsPage.tsx # 设置页面
│   ├── hooks/              # React Hooks
│   │   ├── useSync.ts     # 同步状态管理
│   │   ├── useSettings.ts # 设置管理
│   │   └── useUpdater.ts  # 自动更新
│   └── components/         # 通用组件
│       ├── Toolbar.tsx     # 工具栏（含重启更新入口）
│       └── OnboardingGuide.tsx  # 新手引导
├── src-tauri/               # Tauri / Rust 后端
│   ├── src/
│   │   ├── api.rs         # 笔记 API 客户端
│   │   ├── sync.rs       # 同步流程编排
│   │   ├── export.rs     # Markdown 导出逻辑
│   │   ├── index.rs     # 本地索引管理
│   │   ├── history.rs    # 同步历史记录
│   │   ├── log.rs        # 同步日志持久化 (sync.log)
│   │   ├── config.rs     # 配置管理
│   │   ├── types.rs      # 数据结构定义
│   │   └── commands.rs   # Tauri 命令接口
│   └── Cargo.toml
├── package.json
└── README.md
```

---

## 开源协议

MIT License
