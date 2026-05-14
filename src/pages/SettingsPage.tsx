/* ==========================================================================
   设置页面 - 字段级自动保存
   ========================================================================== */

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../hooks/useSettings";
import { useCache } from "../hooks/useCache";
import type { UpdateState } from "../hooks/useUpdater";
import logoUrl from "../assets/ic_logo.svg";

type SettingsPageProps = {
  updateState: UpdateState;
  onCheckUpdate: (silent?: boolean) => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
};

export function SettingsPage({
  updateState,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
}: SettingsPageProps) {
  const {
    settings,
    loading,
    saveError,
    fieldSaveStates,
    tokenDraft,
    setTokenDraft,
    loadSettings,
    saveField,
    saveToken,
    clearToken,
    selectExportDir
  } = useSettings();

  const {
    cacheInfo,
    reexporting,
    loadCacheInfo,
    reexportFromCache
  } = useCache();

  const [reexportDismissed, setReexportDismissed] = useState(false);
  const [reexportResult, setReexportResult] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 导出配置变更检测：初始快照 vs 当前值
  type ExportConfigSnapshot = Record<string, string | undefined>;
  const [initialExportConfig, setInitialExportConfig] = useState<ExportConfigSnapshot>({});
  const [currentExportConfig, setCurrentExportConfig] = useState<ExportConfigSnapshot>({});
  const initialSnapshotReady = useRef(false);

  const [appVersion, setAppVersion] = useState("0.0.0");

  // 本地编辑状态（用于输入框）
  const [localValues, setLocalValues] = useState({
    defaultOutputDir: "",
    defaultPageSize: 100,
  });
  const [showToken, setShowToken] = useState(false);

  // 初始化加载
  useEffect(() => {
    loadSettings();
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    loadCacheInfo();
  }, []);

  // 页面加载时记录导出配置初始快照，用于变更检测（只记录一次）
  useEffect(() => {
    if (!settings.exportStructure || initialSnapshotReady.current) return;
    const snapshot: ExportConfigSnapshot = { exportStructure: settings.exportStructure };
    setInitialExportConfig(snapshot);
    setCurrentExportConfig({ ...snapshot });
    initialSnapshotReady.current = true;
  }, [settings.exportStructure]);

  const handleCheckUpdate = async () => {
    console.log("[DEBUG] settings update check request:", {
      source: "SettingsPage",
      method: "checkForUpdates",
      params: { silent: false },
    });
    await onCheckUpdate(false);
  };

  const handleUpdateAction = async () => {
    console.log("[DEBUG] settings update action request:", {
      source: "SettingsPage",
      status: updateState.status,
    });
    if (updateState.status === "ready") {
      await onInstallUpdate();
      return;
    }
    await onDownloadUpdate();
  };

  // 同步本地值到设置
  useEffect(() => {
    setLocalValues({
      defaultOutputDir: settings.defaultOutputDir || "",
      defaultPageSize: settings.defaultPageSize || 100,
    });
  }, [settings]);

  // 渲染字段保存状态
  const renderFieldStatus = (field: string) => {
    const state = fieldSaveStates[field];
    if (!state) return null;

    if (state.status === "saving") {
      return <span className="field-status saving">保存中...</span>;
    }
    if (state.status === "success") {
      return <span className="field-status success">已保存</span>;
    }
    if (state.status === "error") {
      return <span className="field-status error">保存失败: {state.error}</span>;
    }
    return null;
  };

  // 目录选择
  const handleSelectDir = async () => {
    const selected = await selectExportDir();
    if (selected) {
      await saveField("defaultOutputDir", selected);
    }
  };

  // 目录清空
  const handleClearDir = async () => {
    await saveField("defaultOutputDir", "");
  };

  // 分页大小变更（失焦时保存）
  const handlePageSizeBlur = () => {
    const num = Number(localValues.defaultPageSize);
    if (!isNaN(num) && num > 0 && num !== settings.defaultPageSize) {
      saveField("defaultPageSize", num);
    }
  };

  // Token 保存
  const handleSaveToken = async () => {
    const token = tokenDraft.trim();
    if (!token) return;
    await saveToken(token);
  };

  // Token 清空
  const handleClearToken = async () => {
    await clearToken();
  };

  const handleExportConfigChange = async (key: string, value: string) => {
    await saveField(key as any, value);
    setCurrentExportConfig((prev) => ({ ...prev, [key]: value }));
    setReexportDismissed(false);
  };

  const handleReexport = async () => {
    setReexportResult(null);
    const result = await reexportFromCache();
    if (result.success) {
      setReexportResult({ type: "success", message: "重新导出完成" });
      setTimeout(() => setReexportResult(null), 3000);
    } else {
      setReexportResult({ type: "error", message: result.error || "重导出失败" });
      setTimeout(() => setReexportResult(null), 6000);
    }
  };

  return (
    <div className="page-content">
      <header className="content-header">
        <div>
          <p className="content-label">设置</p>
          <h2>全局配置</h2>
        </div>
        {saveError && (
          <div className="header-actions">
            <span className="save-status error">错误: {saveError}</span>
          </div>
        )}
      </header>

      {/* API 配置 - 核心区域 */}
      <section className="section section-primary">
        <h3 className="section-title">API 配置</h3>
        <div className="form-group">
          <label className="form-label">
            Bearer Token
            {settings.hasToken && (
              <span className="field-status success">已配置</span>
            )}
            {renderFieldStatus("token")}
          </label>
          <div className="token-input-wrapper">
            <input
              type={showToken ? "text" : "password"}
              className="text-field"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="输入 Token"
            />
            {tokenDraft && (
              <button
                type="button"
                className="token-toggle-btn"
                onClick={() => setShowToken((prev) => !prev)}
                tabIndex={-1}
              >
                {showToken ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            )}
          </div>
          <div className="btn-row">
            <button
              className="btn btn-secondary"
              onClick={handleSaveToken}
              disabled={!tokenDraft.trim() || fieldSaveStates.token?.status === "saving"}
            >
              {fieldSaveStates.token?.status === "saving" ? "保存中..." : "保存 Token"}
            </button>
            {settings.hasToken && (
              <button
                className="btn btn-danger"
                onClick={handleClearToken}
                disabled={fieldSaveStates.token?.status === "saving"}
              >
                清空 Token
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 导出设置 */}
      <section className="section section-card">
        <h3 className="section-title">导出设置</h3>
        <div className="form-group">
          <label className="form-label">
            导出目录
            {renderFieldStatus("defaultOutputDir")}
          </label>
          <div className="inline-field">
            <input
              className="text-field"
              value={localValues.defaultOutputDir}
              onChange={(e) => setLocalValues(prev => ({ ...prev, defaultOutputDir: e.target.value }))}
              placeholder="选择目录"
              readOnly
            />
            <button className="btn btn-secondary" onClick={handleSelectDir}>
              浏览
            </button>
            {settings.defaultOutputDir && (
              <button className="btn btn-danger" onClick={handleClearDir}>
                清空
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            默认分页大小
            {renderFieldStatus("defaultPageSize")}
          </label>
          <input
            className="text-field"
            type="number"
            min={1}
            value={localValues.defaultPageSize}
            onChange={(e) => setLocalValues(prev => ({ ...prev, defaultPageSize: Number(e.target.value) }))}
            onBlur={handlePageSizeBlur}
            style={{ width: 120 }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            导出目录结构
            {renderFieldStatus("exportStructure")}
          </label>
          <div className="radio-group">
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="by_topic"
                checked={settings.exportStructure === "by_topic"}
                onChange={(e) => void handleExportConfigChange("exportStructure", e.target.value)}
              />
              <span>按知识库分组</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="by_month"
                checked={settings.exportStructure === "by_month"}
                onChange={(e) => void handleExportConfigChange("exportStructure", e.target.value)}
              />
              <span>按月份分组</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="by_tag"
                checked={settings.exportStructure === "by_tag"}
                onChange={(e) => void handleExportConfigChange("exportStructure", e.target.value)}
              />
              <span>按主标签分组</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="flat"
                checked={settings.exportStructure === "flat"}
                onChange={(e) => void handleExportConfigChange("exportStructure", e.target.value)}
              />
              <span>平铺（所有文件在同一目录）</span>
            </label>
          </div>
        </div>

        {(() => {
          const hasExportConfigChanged = Object.keys(initialExportConfig).some(
            (key) => initialExportConfig[key] !== currentExportConfig[key]
          );
          if (!cacheInfo?.exists || reexportDismissed || !hasExportConfigChanged) return null;

          const isRetry = reexportResult?.type === "error";

          return (
            <div className="reexport-hint">
              <div className="reexport-hint-body">
                <p className="reexport-hint-text">
                  <strong>导出目录结构</strong>已变更，是否需要重新导出所有笔记以适配新的目录结构？
                </p>
                {reexportResult && (
                  <span className={`reexport-hint-result ${reexportResult.type}`}>
                    {reexportResult.type === "success" ? "✓ " : "✕ "}
                    {reexportResult.message}
                  </span>
                )}
              </div>
              <div className="reexport-hint-actions">
                <button
                  className={`btn btn-sm ${isRetry ? "btn-danger" : "btn-secondary"}`}
                  onClick={handleReexport}
                  disabled={reexporting}
                >
                  {reexporting ? "正在导出..." : isRetry ? "再次尝试" : "重新导出"}
                </button>
                {!reexporting && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setReexportDismissed(true)}
                  >
                    先不用了
                  </button>
                )}
              </div>
            </div>
          );
        })()}

      </section>

      {/* 关于与更新 */}
      <section className="section section-meta">
        <div className="about-panel">
          <div className="about-mark" aria-hidden="true">
            <img src={logoUrl} alt="" />
          </div>
          <div className="about-copy">
            <div className="about-heading">
              <h3>biji2md</h3>
              <span className="about-version-tag">v{appVersion}</span>
            </div>
            <div className="about-status" aria-live="polite">
              {updateState.status === "idle" && (
                <span className="about-status-item neutral">
                  <span className="status-dot" />
                  更新状态待检查
                </span>
              )}
              {updateState.status === "checking" && (
                <span className="about-status-item checking">
                  <svg className="btn-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  正在检查更新
                </span>
              )}
              {updateState.status === "downloading" && (
                <span className="about-status-item checking">
                  <svg className="btn-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  正在下载{typeof updateState.progress === "number" ? ` ${updateState.progress}%` : ""}
                </span>
              )}
              {updateState.status === "ready" && (
                <span className="about-status-item success">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12" /></svg>
                  更新已就绪，重启后生效
                </span>
              )}
              {updateState.status === "uptodate" && (
                <span className="about-status-item success">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><polyline points="20 6 9 17 4 12" /></svg>
                  已是最新版本
                </span>
              )}
              {updateState.status === "available" && (
                <span className="about-status-item info">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
                  可更新至 v{updateState.version}
                </span>
              )}
              {updateState.status === "error" && (
                <span className="about-status-item error" title={updateState.error || "检查失败"}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                  {(updateState.error?.length ?? 0) > 42 ? updateState.error?.slice(0, 42) + "..." : updateState.error || "检查失败"}
                </span>
              )}
            </div>
          </div>
          <div className="about-actions">
            <button
              className="about-action-btn"
              onClick={handleCheckUpdate}
              disabled={updateState.status === "checking" || updateState.status === "downloading" || updateState.status === "ready"}
              title={updateState.status === "ready" ? "更新已就绪，请重启应用" : "检查更新"}
            >
              <svg className={updateState.status === "checking" ? "btn-icon-spin" : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              <span>{updateState.status === "checking" ? "检查中" : updateState.status === "ready" ? "已就绪" : "检查"}</span>
            </button>
            {(updateState.status === "available" || updateState.status === "ready") && (
              <button className="about-action-btn about-action-primary" onClick={handleUpdateAction}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>{updateState.status === "ready" ? "重启" : "下载"}</span>
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
