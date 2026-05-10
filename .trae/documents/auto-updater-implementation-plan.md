# biji2md 自动更新功能实现计划

## 一、需求概述

为 biji2md 添加完整的自动更新功能：
- 应用启动时 + 每 24 小时自动检测 GitHub Release 新版本
- 默认静默下载更新包，下载完成后提示用户重启
- 支持用户手动检查更新（设置页）
- Git tag 驱动版本发布，GitHub Actions 自动打包并生成更新元数据

## 二、当前状态分析

### 2.1 技术栈
- Tauri 2.x (Rust 后端)
- React 19 + TypeScript + Vite (前端)
- 版本: 0.1.0（三处同步: package.json / Cargo.toml / tauri.conf.json）

### 2.2 已有基础设施
- GitHub Actions release 工作流 (`.github/workflows/release.yml`)
- 多平台构建: macOS (universal/Apple Silicon/Intel dmg), Windows (msi), Linux (AppImage/deb)
- 后端命令体系: `commands.rs` 已有 10+ 个命令
- 前端 Hook 模式: `useSync.ts` / `useSettings.ts`
- 事件系统: `sync_state`, `sync_log`, `sync_completed`, `sync_item`

### 2.3 缺失部分
- 未安装 `tauri-plugin-updater`
- `tauri.conf.json` 中 `createUpdaterArtifacts: false`
- 无 Tauri 签名密钥
- Release 工作流未生成 updater 需要的 `.app.tar.gz` / `.nsis.zip` 格式
- Release 工作流未生成 `latest.json` 元数据文件
- 前端无更新检测 UI

## 三、实现方案

### 3.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                           │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  Build All  │───→│  Sign &     │───→│  Upload to Release  │  │
│  │  Platforms  │    │  Generate   │    │  + latest.json      │  │
│  └─────────────┘    │  .sig files │    └─────────────────────┘  │
│                     └─────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Release Assets                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  .dmg/.msi  │  │ .app.tar.gz │  │      latest.json        │  │
│  │  (用户下载)  │  │  .nsis.zip  │  │  {version, platforms,   │  │
│  │             │  │  (updater)  │  │   signatures, urls}     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Client Application                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  App Launch │───→│  check()    │───→│  downloadAndInstall │  │
│  │  + Timer    │    │  (updater)  │    │  (silent)           │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                                              │                   │
│                                              ▼                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  UI: "新版本已下载，重启以应用更新" [立即重启] [稍后]       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 文件变更清单

#### A. 后端 Rust (src-tauri/)

| 文件 | 操作 | 说明 |
|------|------|------|
| `Cargo.toml` | 修改 | 添加 `tauri-plugin-updater = "2"`, `tauri-plugin-process = "2"` |
| `tauri.conf.json` | 修改 | `createUpdaterArtifacts: true`, 添加 updater 插件配置 |
| `src/lib.rs` | 修改 | 注册 updater 和 process 插件 |
| `src/commands.rs` | 新增命令 | `check_update()`, `install_update()`, `get_app_version()` |
| `src/types.rs` | 新增类型 | `UpdateInfo`, `UpdateProgress` |

#### B. 前端 React (src/)

| 文件 | 操作 | 说明 |
|------|------|------|
| `package.json` | 修改 | 添加 `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process` |
| `hooks/useUpdater.ts` | 新建 | 更新检测、下载、安装逻辑 |
| `components/UpdateNotification.tsx` | 新建 | 更新提示 UI（全局浮动通知） |
| `pages/SettingsPage.tsx` | 修改 | 添加"检查更新"按钮 + 版本信息 |
| `App.tsx` | 修改 | 集成更新检测启动逻辑 |
| `types/index.ts` | 修改 | 添加 `UpdateInfo` 类型 |

#### C. GitHub Actions

| 文件 | 操作 | 说明 |
|------|------|------|
| `.github/workflows/release.yml` | 大幅修改 | 生成签名、生成 latest.json、上传 updater 格式 |

#### D. 密钥与配置

| 文件/位置 | 操作 | 说明 |
|-----------|------|------|
| `src-tauri/keys/` | 新建目录 | 存放公钥文件（公钥提交仓库） |
| GitHub Secrets | 配置 | `TAURI_SIGNING_PRIVATE_KEY`（私钥） |

## 四、详细实现步骤

### 步骤 1: 生成 Tauri 签名密钥对

```bash
# 本地执行，生成密钥对
cd src-tauri
npx tauri signer generate -w ./keys/biji2md.key

# 生成两个文件:
# - keys/biji2md.key      (私钥 → 放入 GitHub Secrets)
# - keys/biji2md.key.pub  (公钥 → 提交到仓库)
```

**GitHub Secrets 配置:**
- Name: `TAURI_SIGNING_PRIVATE_KEY`
- Value: `keys/biji2md.key` 文件内容

### 步骤 2: 后端依赖与配置

**Cargo.toml 修改:**
```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-shell = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

**tauri.conf.json 修改:**
```json
{
  "version": "0.1.0",
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true
  },
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...",
      "endpoints": [
        "https://kkgithub.com/https://github.com/duoshilin/biji2md/releases/latest/download/latest.json",
        "https://github.com/duoshilin/biji2md/releases/latest/download/latest.json"
      ]
    }
  }
}
```

**src/lib.rs 修改:**
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // ... 现有代码
}
```

### 步骤 3: 后端命令实现

**src/commands.rs 新增:**

```rust
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_process::ProcessExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub version: Option<String>,
    pub current_version: String,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("updater not available: {e}"))?;

    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            current_version: app.package_info().version.to_string(),
            body: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: None,
            current_version: app.package_info().version.to_string(),
            body: None,
            date: None,
        }),
        Err(e) => Err(format!("check update failed: {e}")),
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app
        .updater()
        .map_err(|e| format!("updater not available: {e}"))?;

    let update = updater
        .check()
        .await
        .map_err(|e| format!("check failed: {e}")?)
        .and_then(|opt| opt.ok_or_else(|| "no update available".to_string()))?;

    update
        .download_and_install(|_event| {}, || {})
        .await
        .map_err(|e| format!("install failed: {e}"))?;

    Ok(())
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}
```

### 步骤 4: 前端 Hook 实现

**src/hooks/useUpdater.ts (新建):**

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateState = {
  status: "idle" | "checking" | "available" | "downloading" | "ready" | "error";
  version?: string;
  currentVersion?: string;
  body?: string;
  progress?: number;
  error?: string;
};

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCheckingRef = useRef(false);

  const checkForUpdates = useCallback(async (silent = true) => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    try {
      setState((prev) => ({ ...prev, status: "checking" }));

      const update = await check();

      if (update) {
        setState({
          status: "available",
          version: update.version,
          currentVersion: undefined,
          body: update.body || undefined,
        });

        // 静默下载
        if (silent) {
          setState((prev) => ({ ...prev, status: "downloading" }));

          let downloaded = 0;
          let contentLength = 0;

          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case "Started":
                contentLength = event.data.contentLength || 0;
                break;
              case "Progress":
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  const progress = Math.round((downloaded / contentLength) * 100);
                  setState((prev) => ({ ...prev, progress }));
                }
                break;
              case "Finished":
                setState((prev) => ({ ...prev, status: "ready" }));
                break;
            }
          });
        }
      } else {
        setState({ status: "idle" });
      }
    } catch (error) {
      setState({
        status: "error",
        error: String(error),
      });
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  const installUpdate = useCallback(async () => {
    await relaunch();
  }, []);

  const dismissUpdate = useCallback(() => {
    setState({ status: "idle" });
  }, []);

  // 启动时检测 + 定时检测
  useEffect(() => {
    // 启动时检测（延迟 3 秒，避免影响启动速度）
    const startupTimer = setTimeout(() => {
      checkForUpdates(true);
    }, 3000);

    // 每 24 小时检测
    timerRef.current = setInterval(() => {
      checkForUpdates(true);
    }, CHECK_INTERVAL);

    return () => {
      clearTimeout(startupTimer);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [checkForUpdates]);

  return {
    state,
    checkForUpdates,
    installUpdate,
    dismissUpdate,
  };
}
```

### 步骤 5: 前端 UI 组件

**src/components/UpdateNotification.tsx (新建):**

全局浮动通知组件，显示在应用右上角：
- "发现新版本 v1.2.0" + 更新说明
- "正在下载..." 进度条
- "新版本已下载，重启以应用更新" [立即重启] [稍后]

**src/pages/SettingsPage.tsx 修改:**

在设置页底部添加：
- 当前版本号显示
- "检查更新" 按钮
- 更新状态显示（检查中 / 已是最新 / 有更新）

### 步骤 6: App.tsx 集成

```typescript
import { useUpdater } from "./hooks/useUpdater";
import { UpdateNotification } from "./components/UpdateNotification";

export function App() {
  const { state, installUpdate, dismissUpdate } = useUpdater();
  // ... 现有代码

  return (
    <div className="app-shell">
      {/* ... 现有代码 */}
      <UpdateNotification
        state={state}
        onInstall={installUpdate}
        onDismiss={dismissUpdate}
      />
    </div>
  );
}
```

### 步骤 7: GitHub Actions Release 工作流改造

`.github/workflows/release.yml` 需要：

1. **版本同步**: 打 tag 时自动同步版本到 `package.json` / `Cargo.toml` / `tauri.conf.json`
2. **签名环境**: 设置 `TAURI_SIGNING_PRIVATE_KEY` 环境变量
3. **生成 updater 格式**: 
   - macOS: `.app.tar.gz` (updater 需要)
   - Windows: `.nsis.zip` (updater 需要)
4. **生成 latest.json**: 收集所有平台的签名和下载 URL
5. **上传 Release Assets**: 同时上传 `.dmg` / `.msi` / `.app.tar.gz` / `.nsis.zip` / `latest.json`

**latest.json 格式:**
```json
{
  "version": "1.2.0",
  "notes": "更新说明...",
  "pub_date": "2025-05-10T08:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "base64签名...",
      "url": "https://github.com/.../biji2md_1.2.0_macos_apple-silicon.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "base64签名...",
      "url": "https://github.com/.../biji2md_1.2.0_macos_intel.app.tar.gz"
    },
    "windows-x86_64": {
      "signature": "base64签名...",
      "url": "https://github.com/.../biji2md_1.2.0_windows_x64.nsis.zip"
    }
  }
}
```

### 步骤 8: 版本同步脚本

新建 `.github/workflows/version-sync.yml` 或在工作流中添加步骤：

```bash
# 提取 tag 版本号 (v1.2.0 → 1.2.0)
VERSION=${GITHUB_REF_NAME#v}

# 同步到 package.json
jq ".version = \"$VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json

# 同步到 Cargo.toml
sed -i "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" src-tauri/Cargo.toml

# 同步到 tauri.conf.json
jq ".version = \"$VERSION\"" src-tauri/tauri.conf.json > src-tauri/tauri.conf.json.tmp && mv src-tauri/tauri.conf.json.tmp src-tauri/tauri.conf.json
```

## 五、关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| CDN | ghproxy (主) + GitHub (备) | 国内优先走 ghproxy 加速，GitHub 原生作为 fallback |
| 更新检测 | 启动时 + 每 24 小时 | 平衡及时性和资源消耗 |
| 下载策略 | 默认静默下载 | 用户无感知，下载完提示重启 |
| 版本管理 | Git tag 驱动 | 自动化，避免手动改版本出错 |
| macOS 签名 | 自签名（无 Apple Developer） | 成本考虑，用户首次右键打开即可 |
| Windows 签名 | 无 | 个人工具可接受 |
| 构建格式 | .dmg/.msi + updater 格式并存 | 兼顾手动下载和自动更新 |

## 六、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| GitHub 国内访问慢 | 更新下载失败 | endpoints 配置 fallback 到 ghproxy |
| 签名密钥泄露 | 恶意更新 | 私钥仅存在 GitHub Secrets，定期轮换 |
| 版本号不一致 | 无限更新循环 | CI 自动同步，人工检查 |
| macOS Gatekeeper | 首次安装拦截 | README 说明右键打开 |
| 更新包损坏 | 安装失败 | Tauri 签名验证自动拦截 |

## 七、验证清单

- [ ] 打 tag `v0.2.0` 触发 release 工作流
- [ ] Release 页面包含 `.dmg` / `.msi` / `.app.tar.gz` / `.nsis.zip` / `latest.json`
- [ ] `latest.json` 格式正确，签名存在
- [ ] 旧版本应用启动后检测到更新
- [ ] 静默下载完成，显示"重启以应用更新"
- [ ] 点击重启后应用版本变为新版本
- [ ] 设置页"检查更新"按钮工作正常
- [ ] 已是最新版本时正确提示

## 八、实施顺序

1. **准备密钥** → 生成密钥对，配置 GitHub Secrets
2. **后端改造** → 安装插件，修改配置，添加命令
3. **前端实现** → Hook + UI 组件 + 设置页集成
4. **CI/CD 改造** → Release 工作流升级
5. **测试验证** → 打测试 tag，端到端验证
