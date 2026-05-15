/* ==========================================================================
   设置页面 - 字段级自动保存
   ========================================================================== */

import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "../hooks/useSettings";
import type { CacheController } from "../hooks/useCache";
import type { UpdateState } from "../hooks/useUpdater";
import type { DirExportConfig, SyncSnapshot } from "../types";
import logoUrl from "../assets/ic_logo.svg";

type SettingsPageProps = {
  cache: CacheController;
  updateState: UpdateState;
  onCheckUpdate: (silent?: boolean) => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => Promise<void>;
  onSettingsChanged?: () => void;
};

type ReexportPhase = "hint" | "choice" | "picking" | "progress" | "success";
type ReexportResult = { type: "success" | "error"; message: string };
type ReexportProgress = {
  current: number;
  total: number | null;
  message: string;
};
type ExportConfigSnapshot = Record<string, string | undefined>;
type ReexportUiState = {
  dismissed: boolean;
  result: ReexportResult | null;
  phase: ReexportPhase;
  progress: ReexportProgress | null;
  targetDir: string | null;
  initialExportConfig: ExportConfigSnapshot;
  currentExportConfig: ExportConfigSnapshot;
  dirExportConfig: DirExportConfig | null;
  initialSnapshotReady: boolean;
};

const defaultReexportUiState: ReexportUiState = {
  dismissed: false,
  result: null,
  phase: "hint",
  progress: null,
  targetDir: null,
  initialExportConfig: {},
  currentExportConfig: {},
  dirExportConfig: null,
  initialSnapshotReady: false,
};

let retainedReexportUiState: ReexportUiState = { ...defaultReexportUiState };

function isCacheReexportMode(mode?: string | null) {
  return mode === "cache_reexport" || mode === "cache_reexport_safe";
}

function normalizeExportStructure(value?: string | null) {
  return value === "flat" || value === "by_month" || value === "by_tag" || value === "by_topic"
    ? value
    : "by_topic";
}

function normalizeLinkFormat(value?: string | null) {
  return value === "markdown" || value === "wikilink" ? value : "wikilink";
}

export function SettingsPage({
  cache,
  updateState,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onSettingsChanged,
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
    reexportFromCache,
    reexportSafe,
  } = cache;

  const [reexportDismissed, setReexportDismissed] = useState(retainedReexportUiState.dismissed);
  const [reexportResult, setReexportResult] = useState<ReexportResult | null>(retainedReexportUiState.result);
  const [reexportPhase, setReexportPhase] = useState<ReexportPhase>(retainedReexportUiState.phase);
  const [reexportProgress, setReexportProgress] = useState<ReexportProgress | null>(retainedReexportUiState.progress);
  const [reexportTargetDir, setReexportTargetDir] = useState<string | null>(retainedReexportUiState.targetDir);

  // 导出配置变更检测：初始快照 vs 当前值
  const [initialExportConfig, setInitialExportConfig] = useState<ExportConfigSnapshot>(
    retainedReexportUiState.initialExportConfig
  );
  const [currentExportConfig, setCurrentExportConfig] = useState<ExportConfigSnapshot>(
    retainedReexportUiState.currentExportConfig
  );
  const [dirExportConfig, setDirExportConfig] = useState<DirExportConfig | null>(
    retainedReexportUiState.dirExportConfig
  );
  const initialSnapshotReady = useRef(retainedReexportUiState.initialSnapshotReady);
  const loadedExportConfigDir = useRef<string | null>(null);

  const [appVersion, setAppVersion] = useState("0.0.0");

  // 本地编辑状态（用于输入框）
  const [localValues, setLocalValues] = useState({
    defaultOutputDir: "",
  });
  const [showToken, setShowToken] = useState(false);

  // 初始化加载
  useEffect(() => {
    loadSettings();
    invoke<string>("get_app_version").then(setAppVersion).catch(() => {});
    invoke<SyncSnapshot>("get_sync_snapshot")
      .then((snapshot) => {
        if (!isCacheReexportMode(snapshot.mode)) return;

        setReexportTargetDir(snapshot.exportDir ?? null);
        setReexportProgress({
          current: snapshot.processedCount,
          total: snapshot.totalExpected ?? null,
          message: snapshot.currentMessage,
        });

        if (snapshot.status === "failed") {
          setReexportResult({ type: "error", message: snapshot.currentMessage || "重导出失败" });
          setReexportPhase("choice");
          return;
        }

        if (snapshot.running) {
          setReexportResult(null);
          setReexportPhase("progress");
          return;
        }

        if (snapshot.status === "completed") {
          setReexportResult({ type: "success", message: "重新导出完成" });
          setReexportPhase("success");
        }
      })
      .catch((error) => {
        console.error("Failed to load reexport snapshot:", error);
      });
  }, []);

  useEffect(() => {
    retainedReexportUiState = {
      dismissed: reexportDismissed,
      result: reexportResult,
      phase: reexportPhase,
      progress: reexportProgress,
      targetDir: reexportTargetDir,
      initialExportConfig,
      currentExportConfig,
      dirExportConfig,
      initialSnapshotReady: initialSnapshotReady.current,
    };
  }, [
    reexportDismissed,
    reexportResult,
    reexportPhase,
    reexportProgress,
    reexportTargetDir,
    initialExportConfig,
    currentExportConfig,
    dirExportConfig,
  ]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    listen<SyncSnapshot>("sync_state", ({ payload }) => {
      if (!mounted) return;
      if (payload.mode !== "cache_reexport" && payload.mode !== "cache_reexport_safe") {
        return;
      }

      setReexportProgress({
        current: payload.processedCount,
        total: payload.totalExpected ?? null,
        message: payload.currentMessage,
      });
    }).then((cleanup) => {
      if (!mounted) {
        cleanup();
        return;
      }
      unlisten = cleanup;
    }).catch((error) => {
      console.error("Failed to listen reexport progress:", error);
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // 导出目录切换后，重新读取该目录下的 .biji2md/config.json
  useEffect(() => {
    const dir = settings.defaultOutputDir?.trim();
    if (!dir) {
      const fallback: ExportConfigSnapshot = { exportStructure: "by_topic", linkFormat: "wikilink" };
      setInitialExportConfig(fallback);
      setCurrentExportConfig({ ...fallback });
      setDirExportConfig(null);
      initialSnapshotReady.current = false;
      loadedExportConfigDir.current = null;
      return;
    }

    if (initialSnapshotReady.current && loadedExportConfigDir.current === dir) {
      return;
    }

    let cancelled = false;
    const previousDir = loadedExportConfigDir.current;

    invoke<DirExportConfig>("get_dir_export_config", { exportDir: dir })
      .then((cfg) => {
        if (cancelled) return;
        const snapshot: ExportConfigSnapshot = {
          exportStructure: normalizeExportStructure(cfg.structure),
          linkFormat: normalizeLinkFormat(cfg.linkFormat),
        };
        const normalizedConfig: DirExportConfig = {
          structure: snapshot.exportStructure as DirExportConfig["structure"],
          linkFormat: snapshot.linkFormat as DirExportConfig["linkFormat"],
        };
        setInitialExportConfig(snapshot);
        setCurrentExportConfig({ ...snapshot });
        setDirExportConfig(normalizedConfig);
        initialSnapshotReady.current = true;
        loadedExportConfigDir.current = dir;
        if (previousDir && previousDir !== dir) {
          setReexportDismissed(false);
          setReexportResult(null);
          setReexportProgress(null);
          setReexportTargetDir(null);
          setReexportPhase("hint");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load directory export config:", error);
        const fallback: ExportConfigSnapshot = { exportStructure: "by_topic", linkFormat: "wikilink" };
        setInitialExportConfig(fallback);
        setCurrentExportConfig({ ...fallback });
        setDirExportConfig({
          structure: "by_topic",
          linkFormat: "wikilink",
        });
        initialSnapshotReady.current = true;
        loadedExportConfigDir.current = dir;
      });

    return () => {
      cancelled = true;
    };
  }, [settings.defaultOutputDir]);

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
      onSettingsChanged?.();
    }
  };

  // 目录清空
  const handleClearDir = async () => {
    await saveField("defaultOutputDir", "");
    onSettingsChanged?.();
  };

  // Token 保存
  const handleSaveToken = async () => {
    const token = tokenDraft.trim();
    if (!token) return;
    await saveToken(token);
    onSettingsChanged?.();
  };

  // Token 清空
  const handleClearToken = async () => {
    await clearToken();
    onSettingsChanged?.();
  };

  const handleExportConfigChange = (key: string, value: string) => {
    setCurrentExportConfig((prev) => ({ ...prev, [key]: value }));
    setReexportDismissed(false);
    setReexportResult(null);
    setReexportProgress(null);
    setReexportTargetDir(null);
    setReexportPhase("hint");
  };

  const handleReexport = async () => {
    setReexportResult(null);
    setReexportProgress(null);
    setReexportTargetDir(null);
    setReexportPhase("choice");
  };

  const handlePickNewDir = async () => {
    setReexportPhase("picking");
    try {
      const selected = await selectExportDir();
      if (!selected) {
        setReexportPhase("choice");
        return;
      }
      await saveField("defaultOutputDir" as any, selected);
      setReexportResult(null);
      setReexportTargetDir(selected);
      setReexportProgress({
        current: 0,
        total: cacheInfo?.totalCount ?? null,
        message: "准备重新导出...",
      });
      setReexportPhase("progress");
      const structure = selectedExportStructure;
      const result = await reexportFromCache(selected, structure, selectedLinkFormat);
      handleReexportResult(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setReexportResult({ type: "error", message: message || "选择目录失败" });
      setReexportPhase("choice");
    }
  };

  const handleSafeReexport = async () => {
    setReexportResult(null);
    setReexportTargetDir(settings.defaultOutputDir ?? null);
    setReexportProgress({
      current: 0,
      total: cacheInfo?.totalCount ?? null,
      message: "准备重新导出...",
    });
    setReexportPhase("progress");
    const structure = selectedExportStructure;
    const result = await reexportSafe(structure, selectedLinkFormat);
    handleReexportResult(result);
  };

  const handleReexportCancel = () => {
    setReexportResult(null);
    setReexportProgress(null);
    setReexportTargetDir(null);
    setReexportPhase("hint");
  };

  const handleReexportDone = () => {
    setReexportResult(null);
    setReexportProgress(null);
    setReexportTargetDir(null);
    setReexportPhase("hint");
  };

  const handleOpenExportDir = async () => {
    const dir = reexportTargetDir ?? settings.defaultOutputDir;
    if (!dir) return;

    try {
      await invoke("open_export_dir", { dir });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setReexportResult({ type: "error", message: message || "打开导出目录失败" });
    }
  };

  const handleReexportResult = (result: { success: boolean; error?: string }) => {
    if (result.success) {
      const total = reexportProgress?.total ?? cacheInfo?.totalCount ?? null;
      setReexportResult({ type: "success", message: total ? `重新导出完成，共处理 ${total} 条笔记` : "重新导出完成" });
      setReexportProgress((progress) => {
        const finalTotal = progress?.total ?? cacheInfo?.totalCount ?? null;
        return finalTotal
          ? { current: finalTotal, total: finalTotal, message: "重新导出完成" }
          : progress;
      });
      setInitialExportConfig({ ...currentExportConfig });
      setReexportPhase("success");
    } else {
      setReexportResult({ type: "error", message: result.error || "重导出失败" });
      setReexportProgress(null);
      setReexportPhase("choice");
    }
  };

  const selectedExportStructure = normalizeExportStructure(
    currentExportConfig.exportStructure ??
    initialExportConfig.exportStructure ??
    dirExportConfig?.structure
  );

  const selectedLinkFormat = normalizeLinkFormat(
    currentExportConfig.linkFormat ??
    initialExportConfig.linkFormat ??
    dirExportConfig?.linkFormat
  );

  const exportStructureOptions: Array<{
    value: DirExportConfig["structure"];
    title: string;
    description: string;
    samplePath: string;
  }> = [
    {
      value: "by_topic",
      title: "按知识库分组",
      description: "不同知识库导出到不同目录",
      samplePath: "知识库名称/笔记名.md",
    },
    {
      value: "by_month",
      title: "按月份分组",
      description: "把笔记放在对应月份目录下",
      samplePath: "2026-05/笔记名.md",
    },
    {
      value: "by_tag",
      title: "按主标签分组",
      description: "把笔记的第一个标签作为目录名",
      samplePath: "主标签/笔记名.md",
    },
    {
      value: "flat",
      title: "平铺",
      description: "所有笔记都放在一个目录下",
      samplePath: "笔记名.md",
    },
  ];

  const linkFormatOptions: Array<{
    value: DirExportConfig["linkFormat"];
    title: string;
    description: string;
    sampleLink: string;
  }> = [
    {
      value: "wikilink",
      title: "Obsidian Wikilink",
      description: "Obsidian 双链",
      sampleLink: "[[子笔记.md]]",
    },
    {
      value: "markdown",
      title: "Markdown 链接",
      description: "通用阅读器",
      sampleLink: "[子笔记](<子笔记.md>)",
    },
  ];

  const selectedStructureOption = exportStructureOptions.find((option) => option.value === selectedExportStructure)
    ?? exportStructureOptions[0];
  const selectedLinkOption = linkFormatOptions.find((option) => option.value === selectedLinkFormat)
    ?? linkFormatOptions[0];

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
          <div className="form-label form-label-row">
            <span>导出目录结构</span>
            <span className="preview">预览：{selectedStructureOption.samplePath}</span>
          </div>
          <div className="radio-group option-grid">
            {exportStructureOptions.map((option) => (
              <label
                key={option.value}
                className={`radio-item option-card ${selectedExportStructure === option.value ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="exportStructure"
                  value={option.value}
                  checked={selectedExportStructure === option.value}
                  onChange={(e) => handleExportConfigChange("exportStructure", e.target.value)}
                />
                <span className="option-card-body">
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <div className="form-label form-label-row">
            <span>父子笔记链接格式</span>
            <span className="preview">预览：{selectedLinkOption.sampleLink}</span>
          </div>
          <div className="radio-group option-grid option-grid-two">
            {linkFormatOptions.map((option) => (
              <label
                key={option.value}
                className={`radio-item option-card ${selectedLinkFormat === option.value ? "active" : ""}`}
              >
                <input
                  type="radio"
                  name="linkFormat"
                  value={option.value}
                  checked={selectedLinkFormat === option.value}
                  onChange={(e) => handleExportConfigChange("linkFormat", e.target.value)}
                />
                <span className="option-card-body">
                  <strong>{option.title}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </div>

        {(() => {
          const hasExportConfigChanged = Object.keys(initialExportConfig).some(
            (key) => initialExportConfig[key] !== currentExportConfig[key]
          );
          if (!cacheInfo?.exists || reexportDismissed) return null;
          if (!hasExportConfigChanged && reexportPhase !== "success" && reexportResult?.type !== "error") return null;

          if (reexportPhase === "hint") {
            return (
              <div className="reexport-hint" onClick={handleReexport}>
                <div className="reexport-hint-body">
                  <p className="reexport-hint-text">
                    检测到你正在修改<strong>导出配置</strong>，是否重新导出笔记以适配新的配置？
                  </p>
                </div>
                <div className="reexport-hint-actions">
                  <button className="btn btn-secondary btn-sm">重新导出</button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => { e.stopPropagation(); setCurrentExportConfig({ ...initialExportConfig }); setReexportResult(null); setReexportProgress(null); setReexportTargetDir(null); setReexportDismissed(true); }}
                  >
                    不改了
                  </button>
                </div>
              </div>
            );
          }

          if (reexportPhase === "choice") {
            return (
              <div className="reexport-hint reexport-choice">
                <div className="reexport-option" onClick={handlePickNewDir}>
                  <span className="reexport-option-icon"></span>
                  <div className="reexport-option-body">
                    <p className="reexport-option-title">1. 导出到新目录</p>
                    <p className="reexport-option-desc">导出到新目录，与当前目录互相隔离，不受影响当前目录结构</p>
                  </div>
                  <span className="reexport-option-action">选择目录</span>
                </div>
                <div className="reexport-option" onClick={handleSafeReexport}>
                  <span className="reexport-option-icon"></span>
                  <div className="reexport-option-body">
                    <p className="reexport-option-title">2. 在当前目录重新导出</p>
                    <p className="reexport-option-desc">在当前目录重新导出所有笔记</p>
                  </div>
                  <span className="reexport-option-action">开始重导出</span>
                </div>
                {reexportResult && (
                  <div className={`reexport-result reexport-result-${reexportResult.type}`}>
                    <span className="reexport-result-badge">
                      {reexportResult.type === "success" ? "完成" : "失败"}
                    </span>
                    <div className="reexport-result-body">
                      <strong>
                        {reexportResult.type === "success" ? "重新导出完成" : "重新导出没有完成"}
                      </strong>
                      <p>{reexportResult.message}</p>
                    </div>
                  </div>
                )}
                <div className="reexport-choice-footer">
                  <button className="btn btn-ghost btn-sm" onClick={handleReexportCancel}>取消</button>
                </div>
              </div>
            );
          }

          if (reexportPhase === "success") {
            const progressTotal = reexportProgress?.total ?? cacheInfo?.totalCount ?? null;

            return (
              <div className="reexport-hint reexport-result-card">
                <div className="reexport-hint-body">
                  <p className="reexport-hint-text">
                    <strong>重新导出完成</strong>
                    {progressTotal ? (
                      <span className="reexport-progress-hint">（{progressTotal} / {progressTotal}）</span>
                    ) : null}
                  </p>
                  <p className="reexport-option-desc">
                    新的导出配置已保存，Markdown 文件已按当前设置重新生成。
                  </p>
                </div>
                <div className="reexport-hint-actions">
                  <button className="btn btn-secondary btn-sm" onClick={handleOpenExportDir}>
                    打开导出目录
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={handleReexportDone}>
                    完成
                  </button>
                </div>
              </div>
            );
          }

          if (reexportPhase === "picking") {
            return (
              <div className="reexport-hint">
                <div className="reexport-hint-body">
                  <p className="reexport-hint-text">请选择新的导出目录...</p>
                </div>
              </div>
            );
          }

          if (reexportPhase === "progress") {
            const progressCurrent = reexportProgress?.current ?? 0;
            const progressTotal = reexportProgress?.total ?? cacheInfo?.totalCount ?? null;
            const progressText = progressTotal
              ? `${Math.min(progressCurrent, progressTotal)} / ${progressTotal}`
              : progressCurrent > 0
                ? `${progressCurrent}`
                : null;

            return (
              <div className="reexport-hint">
                <div className="reexport-hint-body">
                  <p className="reexport-hint-text">
                    正在重新导出笔记
                    {progressText ? (
                      <span className="reexport-progress-hint">（{progressText}）</span>
                    ) : null}...
                  </p>
                </div>
              </div>
            );
          }

          return null;
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
