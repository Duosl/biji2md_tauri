/* ==========================================================================
   同步页面 - 概览、操作、结果与诊断
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { useSync } from "../hooks/useSync";

const LOG_FILTERS = [
  { key: "key", label: "关键节点" },
  { key: "error", label: "错误" },
  { key: "all", label: "全部日志" }
] as const;

type SyncPageProps = {
  onOpenSettings?: () => void;
};

type LogFilterKey = (typeof LOG_FILTERS)[number]["key"];

type DisplaySummary = {
  timestamp?: number | null;
  mode: string;
  total: number;
  exported: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
};

function formatTimestamp(ts?: number | null): string {
  if (!ts) return "从未";

  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const mins = Math.floor(diff / (1000 * 60));
      return mins <= 1 ? "刚刚" : `${mins} 分钟前`;
    }
    return `${hours} 小时前`;
  }

  if (days === 1) {
    return "昨天";
  }

  if (days < 7) {
    return `${days} 天前`;
  }

  return date.toLocaleDateString("zh-CN");
}

function isKeyLog(level: string, message: string) {
  if (level === "error" || level === "warn") {
    return true;
  }

  const normalized = message.toLowerCase();
  const markers = [
    "[拉取]",
    "[分页]",
    "同步模式",
    "增量模式",
    "输出目录",
    "同步完成",
    "同步已取消"
  ];

  return markers.some((marker) => normalized.includes(marker.toLowerCase()));
}

export function SyncPage({ onOpenSettings }: SyncPageProps) {
  const {
    settings,
    snapshot,
    summary,
    logs,
    overview,
    failedItems,
    syncError,
    saveSettings,
    startSync,
    cancelSync,
    clearSyncError,
    loadHistoryLogs,
    openLogDir,
    openExportDir
  } = useSync();

  const [statusText, setStatusText] = useState("准备就绪");
  const [logFilter, setLogFilter] = useState<LogFilterKey>("key");
  const [showLogs, setShowLogs] = useState(false);
  const userCollapsedRef = useRef(false);

  const mode = settings.lastMode === "full" ? "full" : "incremental";
  const hasToken = settings.hasToken;
  const hasExportDir = !!settings.defaultOutputDir?.trim();
  const isConfigComplete = hasToken && hasExportDir;
  const isRunning = snapshot.running;
  const hasCurrentRun = (isRunning || syncError !== null) && (snapshot.processedCount > 0 || isRunning);

  useEffect(() => {
    if (syncError) {
      setStatusText("同步失败");
    } else {
      setStatusText(snapshot.currentMessage || (snapshot.running ? "同步中..." : "待机"));
    }
  }, [snapshot, syncError]);

  const hasErrors = logs.some((l) => l.level === "error");
  useEffect(() => {
    if (isRunning) userCollapsedRef.current = false;
  }, [isRunning]);
  useEffect(() => {
    if (userCollapsedRef.current) return;
    if (logs.length > 0 || hasErrors) {
      setShowLogs(true);
    }
  }, [logs.length, hasErrors]);

  const toggleLogs = () => {
    setShowLogs((prev) => {
      const next = !prev;
      userCollapsedRef.current = prev;
      if (next && !isRunning && logs.length === 0 && hasExportDir) {
        void loadHistoryLogs();
      }
      return next;
    });
  };

  const hasRealTotal = snapshot.totalExpected != null && snapshot.totalExpected > 0;
  const progressTotal = hasRealTotal ? snapshot.totalExpected! : 0;
  const progressRatio =
    hasRealTotal
      ? Math.min((snapshot.processedCount || 0) / progressTotal, 1)
      : 0;

  const resultSummary: DisplaySummary | null = summary
    ? {
        timestamp: snapshot.finishedAt ?? Date.now(),
        mode: snapshot.mode || mode,
        total: summary.total,
        exported: summary.created + summary.updated,
        created: summary.created,
        updated: summary.updated,
        skipped: summary.skipped,
        failed: summary.failed,
        cancelled: summary.cancelled
      }
    : overview?.lastSummary
      ? {
          timestamp: overview.lastSummary.timestamp,
          mode: overview.lastSummary.mode,
          total: overview.lastSummary.total,
          exported: overview.lastSummary.created + overview.lastSummary.updated,
          created: overview.lastSummary.created,
          updated: overview.lastSummary.updated,
          skipped: overview.lastSummary.skipped,
          failed: overview.lastSummary.failed,
          cancelled: overview.lastSummary.cancelled
        }
      : null;

  const filteredLogs = logs.filter((entry) => {
    if (logFilter === "error") {
      return entry.level === "error";
    }
    if (logFilter === "key") {
      return isKeyLog(entry.level, entry.message);
    }
    return true;
  });
  const missingItems = [
    !hasToken ? "Token" : null,
    !hasExportDir ? "导出目录" : null
  ].filter(Boolean) as string[];

  const headerStatusText = (() => {
    if (snapshot.cancelRequested) return "正在取消";
    if (isRunning) return "同步中";
    if (!isConfigComplete) return "配置未完成";
    if (summary) return "刚完成同步";
    if (resultSummary?.timestamp) return `上次同步 ${formatTimestamp(resultSummary.timestamp)}`;
    return "待同步";
  })();

  const syncStateValue = (() => {
    if (snapshot.cancelRequested) return "取消中";
    if (isRunning) return "同步中";
    if (resultSummary?.cancelled) return "已取消";
    if (summary) return "刚完成";
    return "空闲";
  })();

  const recentFailedCount = isRunning
    ? failedItems.length
    : overview?.recentFailedCount ?? 0;

  const handleModeChange = async (nextMode: "incremental" | "full") => {
    if (isRunning || nextMode === mode) return;
    await saveSettings({ lastMode: nextMode });
  };

  const handleStartSync = async () => {
    if (isRunning || !isConfigComplete) return;

    await startSync({
      exportDir: settings.defaultOutputDir || "",
      mode
    });
  };

  const handlePrimaryAction = () => {
    if (!isConfigComplete) {
      onOpenSettings?.();
      return;
    }
    void handleStartSync();
  };

  return (
    <div className="page-content sync-page">
      <header className="content-header sync-page-header">
        <div>
          <p className="content-label">笔记同步</p>
          <h2>同步与导出</h2>
        </div>
        <div className="header-status">
          <span className={`dot ${isRunning ? "active" : ""}`} />
          <span>{headerStatusText}</span>
        </div>
      </header>

      <section className="section sync-panel">
        <div className="section-header">
          <h3>概览</h3>
          {!isConfigComplete && <span className="section-count error">待配置</span>}
        </div>

        <div className="stat-grid sync-overview-grid">
          <div className="stat-cell">
            <strong>{isConfigComplete ? "完整" : "待配置"}</strong>
            <span>配置状态</span>
            <small>
              {isConfigComplete ? "Token 与导出目录已就绪" : `缺少 ${missingItems.join(" / ")}`}
            </small>
          </div>
          <div className="stat-cell">
            <strong>{syncStateValue}</strong>
            <span>同步状态</span>
            <small>{isRunning ? statusText : "等待下一次同步"}</small>
          </div>
          <div className="stat-cell">
            <strong>{resultSummary?.timestamp ? formatTimestamp(resultSummary.timestamp) : "从未"}</strong>
            <span>上次同步</span>
            <small>
              {resultSummary
                ? `${resultSummary.mode === "full" ? "全量" : "增量"} · ${resultSummary.total} 个主笔记`
                : "还没有同步历史"}
            </small>
          </div>
          <div className="stat-cell">
            <strong>{recentFailedCount}</strong>
            <span>最近失败</span>
            <small>{isRunning ? "本次运行内" : "近期失败统计"}</small>
          </div>
        </div>
      </section>

      <section className="section sync-panel">
        <div className="sync-action-row">
          <div>
            <h3 className="section-title">同步操作</h3>
            <p className="section-subtitle">
              {isConfigComplete
                ? "当前配置可直接发起同步。"
                : "先完成配置，再开始同步导出。"}
            </p>
          </div>

          <button
            className={`sync-button ${isRunning ? "running" : ""} ${!isConfigComplete ? "sync-button-config" : ""}`}
            onClick={handlePrimaryAction}
            disabled={isRunning}
          >
            {isRunning ? (
              <>
                <span className="spinner" />
                同步中
              </>
            ) : !isConfigComplete ? (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 15v2m-6 4h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2Zm10-10V7a4 4 0 0 0-8 0v4h8Z" />
                </svg>
                去完成配置
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 0 0 4.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 0 1-15.357-2m15.357 2H15" />
                </svg>
                开始同步
              </>
            )}
          </button>
        </div>

        {!isConfigComplete && (
          <div className="sync-inline-alert">
            {missingItems.map((item) => (
              <span key={item}>{item} 未配置</span>
            ))}
          </div>
        )}

        <div className="mode-selector">
          <button
            className={`mode-pill ${mode === "incremental" ? "active" : ""}`}
            onClick={() => void handleModeChange("incremental")}
            disabled={isRunning}
          >
            增量
          </button>
          <button
            className={`mode-pill ${mode === "full" ? "active" : ""}`}
            onClick={() => void handleModeChange("full")}
            disabled={isRunning}
          >
            全量
          </button>
        </div>

        <div className="mode-hint sync-mode-hint">
          {mode === "incremental"
            ? "增量适合日常同步；在云端修改历史笔记希望同步到本地时可切到全量模式。"
            : "全量会重新获取全部笔记，会覆盖本地修改过的笔记。请谨慎使用。"}
        </div>

        <div className="sync-action-buttons">
          <button className="btn btn-secondary" onClick={() => void openExportDir()}>
            打开导出目录
          </button>
        </div>

        {isRunning && (
          <button className="cancel-link" onClick={() => void cancelSync()}>
            取消同步
          </button>
        )}

        {syncError && !isRunning && (
          <div className="sync-error-alert">
            <div className="sync-error-icon">⚠</div>
            <div className="sync-error-content">
              <strong>同步失败</strong>
              <p>{syncError}</p>
            </div>
            <button className="sync-error-dismiss" onClick={() => clearSyncError()}>
              ✕
            </button>
          </div>
        )}
      </section>

      {hasCurrentRun && (
        <section className="section sync-panel">
          <div className="progress-header">
            <span className="progress-title">主笔记处理进度</span>
            <span className="progress-count">
              {hasRealTotal
                ? `${snapshot.processedCount || 0} / ${progressTotal}`
                : `${snapshot.processedCount || 0}`}
            </span>
          </div>

          <div className="progress-track">
            <div
              className={`progress-fill${!hasRealTotal ? " indeterminate" : ""}`}
              style={{ width: hasRealTotal ? `${progressRatio * 100}%` : "40%" }}
            />
          </div>

          <div className="progress-meta">
            <span>{statusText}</span>
            {snapshot.currentPage ? <span>第 {snapshot.currentPage} 页</span> : null}
            {snapshot.pageNotes ? <span>本页 {snapshot.pageNotes} 个主笔记</span> : null}
          </div>

          <div className="stat-grid sync-progress-grid">
            <div className="stat-cell">
              <strong>{snapshot.totalFetched || 0}</strong>
              <span>已拉取主笔记</span>
            </div>
            <div className="stat-cell">
              <strong>{snapshot.counters.created || 0}</strong>
              <span>新增文件</span>
            </div>
            <div className="stat-cell">
              <strong>{snapshot.counters.updated || 0}</strong>
              <span>更新文件</span>
            </div>
            <div className="stat-cell">
              <strong>{snapshot.counters.skipped || 0}</strong>
              <span>跳过主笔记</span>
            </div>
            <div className="stat-cell">
              <strong>{snapshot.counters.failed || 0}</strong>
              <span>导出失败</span>
            </div>
          </div>
        </section>
      )}

      {!isRunning && resultSummary && (
        <section className="section sync-panel">
          <div className="section-header">
            <h3>上次同步结果</h3>
            {resultSummary.mode === "full"
              ? <span className="sync-mode-tag">全量</span>
              : <span className="sync-mode-tag">增量</span>}
            <span className="section-count">
              {resultSummary.timestamp ? formatTimestamp(resultSummary.timestamp) : "刚完成"}
            </span>
          </div>

          <div className="stat-grid sync-result-grid">
            <div className="stat-cell">
              <strong>{resultSummary.total}</strong>
              <span>主笔记</span>
            </div>
            <div className="stat-cell">
              <strong>{resultSummary.exported}</strong>
              <span>导出文件</span>
            </div>
            <div className="stat-cell">
              <strong>{resultSummary.created}</strong>
              <span>新增文件</span>
            </div>
            <div className="stat-cell">
              <strong>{resultSummary.updated}</strong>
              <span>更新文件</span>
            </div>
            <div className="stat-cell">
              <strong>{resultSummary.skipped}</strong>
              <span>跳过主笔记</span>
            </div>
            <div className="stat-cell">
              <strong>{resultSummary.failed}</strong>
              <span>导出失败</span>
            </div>
          </div>
        </section>
      )}

      <section className="section sync-panel">
        <div className={`log-list ${showLogs ? "expanded" : ""}`}>
          <div className="log-header" onClick={toggleLogs}>
            <h3>日志</h3>
            <div className="log-header-actions">
              <button
                className="btn btn-secondary btn-sm"
                onClick={(e) => { e.stopPropagation(); void openLogDir(); }}
              >
                历史日志
              </button>
            </div>
          </div>

          <div className={`log-body ${showLogs ? "expanded" : ""}`}>
            <div className="log-body-inner">
            <div className="sync-log-filters">
              {LOG_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  className={`sync-log-filter ${logFilter === filter.key ? "active" : ""}`}
                  onClick={() => setLogFilter(filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>
              <span className="log-count">{filteredLogs.length}</span>

            <div className="log-scroll">
            {logs.length === 0 ? (
              <div className="logs-empty">暂无日志</div>
            ) : filteredLogs.length === 0 ? (
              <div className="logs-empty">当前筛选下没有日志</div>
            ) : (
              filteredLogs.map((entry) => (
                <div className="log-row" key={entry.key}>
                  <span className="log-time">{entry.time}</span>
                  <span className={`log-tag ${entry.level}`}>{entry.level}</span>
                  <span className="log-message">{entry.message}</span>
                </div>
              ))
            )}
            </div>
            </div>
          </div>
        </div>
      </section>

      {!isRunning && failedItems.length > 0 && (
        <section className="section sync-panel">
          <div className="section-header">
            <h3>失败项</h3>
            <span className="section-count error">{failedItems.length}</span>
          </div>

          <div className="failed-list">
            {failedItems.map((item, idx) => (
              <div className="failed-item" key={`${item.noteId}-${idx}`}>
                <span className="failed-action">失败</span>
                <span className="failed-title" title={item.title}>
                  {item.title || "未命名"}
                </span>
                <span className="failed-note-id">{item.noteId}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
