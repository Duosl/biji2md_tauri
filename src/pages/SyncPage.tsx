/* ==========================================================================
   同步页面 - 笔记导出同步功能（含环境状态卡与配置引导）
   ========================================================================== */

import { useState, useEffect } from "react";
import { useSync } from "../hooks/useSync";
import type { SyncOverview, RecentExportItem } from "../types";

// 格式化时间戳
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
  } else if (days === 1) {
    return "昨天";
  } else if (days < 7) {
    return `${days} 天前`;
  }
  return date.toLocaleDateString("zh-CN");
}

// 获取动作标签
function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    created: "新增",
    updated: "更新",
    failed: "失败"
  };
  return labels[action] || action;
}

export function SyncPage() {
  const {
    settings,
    snapshot,
    summary,
    logs,
    overview,
    recentExports,
    failedItems,
    saveSettings,
    startSync,
    cancelSync,
    openExportDir
  } = useSync();

  const [statusText, setStatusText] = useState("准备就绪");

  const mode = settings.lastMode === "full" ? "full" : "incremental";

  // 配置完成状态检查
  const hasToken = settings.hasToken;
  const hasExportDir = !!settings.defaultOutputDir?.trim();
  const isConfigComplete = hasToken && hasExportDir;

  const handleModeChange = async (newMode: "incremental" | "full") => {
    if (isRunning || newMode === mode) return;
    await saveSettings({ lastMode: newMode });
  };

  useEffect(() => {
    setStatusText(snapshot.currentMessage || (snapshot.running ? "同步中..." : "待机"));
  }, [snapshot]);

  const progressTotal = snapshot.totalExpected ?? snapshot.totalFetched ?? 0;
  const progressRatio =
    progressTotal > 0
      ? Math.min((snapshot.processedCount || 0) / progressTotal, 1)
      : 0;

  const isRunning = snapshot.running;
  const hasStarted = snapshot.processedCount > 0 || isRunning || summary !== null;

  const handleStartSync = async () => {
    console.log("[DEBUG] handleStartSync called, isRunning:", isRunning);
    if (isRunning) {
      console.log("[DEBUG] handleStartSync: already running, returning");
      return;
    }
    if (!isConfigComplete) {
      console.log("[DEBUG] handleStartSync: config incomplete, returning");
      return;
    }
    const exportDir = settings.defaultOutputDir || "";
    console.log("[DEBUG] handleStartSync: calling startSync");
    await startSync({
      exportDir,
      mode,
      pageSize: settings.defaultPageSize || 100
    });
    console.log("[DEBUG] handleStartSync: startSync returned");
  };

  // 渲染配置状态卡
  const renderConfigCard = () => {
    return (
      <section className="config-status-card">
        <div className="config-card-header">
          <h3>环境状态</h3>
          {!isConfigComplete && (
            <span className="config-incomplete-badge">配置未完成</span>
          )}
        </div>
        <div className="config-items">
          <div className={`config-item ${hasToken ? "ok" : "missing"}`}>
            <span className="config-icon">{hasToken ? "✓" : "!"}</span>
            <span className="config-label">Token</span>
            <span className="config-value">
              {hasToken ? (settings.tokenMasked || "已配置") : "未配置"}
            </span>
          </div>
          <div className={`config-item ${hasExportDir ? "ok" : "missing"}`}>
            <span className="config-icon">{hasExportDir ? "✓" : "!"}</span>
            <span className="config-label">导出目录</span>
            <span className="config-value" title={settings.defaultOutputDir || ""}>
              {hasExportDir ? truncatePath(settings.defaultOutputDir!) : "未设置"}
            </span>
          </div>
        </div>
      </section>
    );
  };

  // 渲染上次同步摘要
  const renderLastSyncSummary = (data?: SyncOverview | null) => {
    if (!data?.lastSummary) return null;
    const summary = data.lastSummary;

    return (
      <section className="last-sync-summary">
        <div className="summary-header">
          <h3>上次同步摘要</h3>
          <span className="summary-time">{formatTimestamp(summary.timestamp)}</span>
        </div>
        <div className="summary-stats">
          <div className="summary-stat">
            <span className="stat-num">{summary.total}</span>
            <span className="stat-name">总计</span>
          </div>
          <div className="summary-stat created">
            <span className="stat-num">{summary.created}</span>
            <span className="stat-name">新增</span>
          </div>
          <div className="summary-stat updated">
            <span className="stat-num">{summary.updated}</span>
            <span className="stat-name">更新</span>
          </div>
          <div className="summary-stat skipped">
            <span className="stat-num">{summary.skipped}</span>
            <span className="stat-name">跳过</span>
          </div>
          {summary.failed > 0 && (
            <div className="summary-stat failed">
              <span className="stat-num">{summary.failed}</span>
              <span className="stat-name">失败</span>
            </div>
          )}
        </div>
        <div className="summary-mode">
          模式: {summary.mode === "incremental" ? "增量" : "全量"}
          {summary.cancelled && " · 已取消"}
        </div>
      </section>
    );
  };

  // 渲染最近导出列表
  const renderRecentExports = (exports: RecentExportItem[]) => {
    const displayExports = exports.length > 0 ? exports : overview?.recentExports || [];
    if (displayExports.length === 0 && !isRunning) return null;

    return (
      <section className="recent-exports">
        <div className="section-header">
          <h3>最近导出</h3>
          <span className="section-count">{displayExports.length}</span>
        </div>
        <div className="exports-list">
          {displayExports.length === 0 ? (
            <div className="exports-empty">等待同步数据...</div>
          ) : (
            displayExports.map((item, idx) => (
              <div className={`export-item ${item.action}`} key={`${item.noteId}-${idx}`}>
                <span className="export-action">{getActionLabel(item.action)}</span>
                <span className="export-title" title={item.title}>
                  {item.title || "未命名"}
                </span>
                <span className="export-file" title={item.filePath}>
                  {truncatePath(item.filePath, 25)}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    );
  };

  // 渲染失败项
  const renderFailedItems = () => {
    const displayFailed = failedItems.length > 0 ? failedItems : [];
    if (displayFailed.length === 0) return null;

    return (
      <section className="failed-items">
        <div className="section-header">
          <h3>失败项</h3>
          <span className="section-count error">{displayFailed.length}</span>
        </div>
        <div className="exports-list">
          {displayFailed.map((item, idx) => (
            <div className="export-item failed" key={`${item.noteId}-${idx}`}>
              <span className="export-action">失败</span>
              <span className="export-title" title={item.title}>
                {item.title || "未命名"}
              </span>
              <span className="export-note-id">{item.noteId}</span>
            </div>
          ))}
        </div>
      </section>
    );
  };

  // 截断路径显示
  const truncatePath = (path: string, maxLen: number = 30) => {
    if (path.length <= maxLen) return path;
    return "..." + path.slice(-maxLen + 3);
  };

  return (
    <div className="page-content sync-page">
      {/* 环境状态卡 */}
      {renderConfigCard()}

      {/* 主操作区 */}
      <section className="sync-hero">
        {/* 图标 */}
        <div className={`sync-icon ${isRunning ? "running" : ""}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>

        <div className={`sync-status ${isRunning ? "running" : ""}`}>
          <span className={`status-indicator ${isRunning ? "running" : ""}`} />
          <span className="status-text">{statusText}</span>
        </div>

        {/* 配置未完成时的提示 */}
        {!isConfigComplete && !isRunning && (
          <div className="config-hint">
            {!hasToken && <p>请先配置 Token</p>}
            {!hasExportDir && <p>请先设置导出目录</p>}
          </div>
        )}

        <button
          className={`sync-button ${isRunning ? "running" : ""} ${!isConfigComplete ? "disabled-hint" : ""}`}
          onClick={handleStartSync}
          disabled={isRunning || !isConfigComplete}
        >
          {isRunning ? (
            <>
              <span className="spinner" />
              同步中
            </>
          ) : !isConfigComplete ? (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              去完成配置
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              开始同步
            </>
          )}
        </button>

        <div className="mode-selector">
          <button
            className={`mode-pill ${mode === "incremental" ? "active" : ""}`}
            onClick={() => handleModeChange("incremental")}
            disabled={isRunning}
          >
            增量
          </button>
          <button
            className={`mode-pill ${mode === "full" ? "active" : ""}`}
            onClick={() => handleModeChange("full")}
            disabled={isRunning}
          >
            全量
          </button>
        </div>

        {/* 模式说明文案 */}
        <div className="mode-hint">
          {mode === "incremental" ? (
            <span>增量适合日常同步；历史编辑可能需要全量</span>
          ) : (
            <span>全量会重新获取所有笔记，适合历史数据更新</span>
          )}
        </div>

        {isRunning && (
          <button className="cancel-link" onClick={cancelSync}>
            取消同步
          </button>
        )}
      </section>

      {/* 进度与统计 - 同步开始后显示 */}
      {hasStarted && (
        <section className="sync-metrics">
          <div className="metrics-header">
            <span className="metrics-label">同步进度</span>
            <span className="metrics-count">
              {snapshot.processedCount || 0} / {progressTotal || "-"}
            </span>
          </div>
          
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${progressRatio * 100}%` }}
            />
          </div>

          <div className="stats-row">
            <div className="stat-item">
              <span className="stat-value">{snapshot.totalFetched || 0}</span>
              <span className="stat-label">拉取</span>
            </div>
            <div className="stat-item">
              <span className="stat-value created">{snapshot.counters.created || 0}</span>
              <span className="stat-label">新增</span>
            </div>
            <div className="stat-item">
              <span className="stat-value updated">{snapshot.counters.updated || 0}</span>
              <span className="stat-label">更新</span>
            </div>
            <div className="stat-item">
              <span className="stat-value skipped">{snapshot.counters.skipped || 0}</span>
              <span className="stat-label">跳过</span>
            </div>
            {snapshot.counters.failed > 0 && (
              <div className="stat-item">
                <span className="stat-value failed">{snapshot.counters.failed}</span>
                <span className="stat-label">失败</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 上次同步摘要 - 从概览数据 */}
      {!isRunning && renderLastSyncSummary(overview)}

      {/* 最近导出列表 */}
      {!isRunning && renderRecentExports(recentExports)}

      {/* 失败项列表 */}
      {!isRunning && renderFailedItems()}

      {/* 实时同步结果 - 完成后显示 */}
      {summary && !isRunning && (
        <section className="sync-result">
          <div className="result-header">
            <span className="result-title">本次同步完成</span>
            <span className="result-time">{summary.total} 条笔记</span>
          </div>
          <div className="result-detail">
            新增 {summary.created} · 更新 {summary.updated} · 跳过 {summary.skipped}
            {summary.failed > 0 && ` · 失败 ${summary.failed}`}
          </div>
          {summary.indexPath && (
            <code className="result-path">{summary.indexPath}</code>
          )}
          {/* 快捷操作 */}
          <div className="quick-actions">
            <button
              className="btn btn-secondary"
              onClick={() => openExportDir()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
              </svg>
              打开导出目录
            </button>
            {summary.indexPath && (
              <button
                className="btn btn-secondary"
                onClick={() => navigator.clipboard.writeText(summary.indexPath)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                复制索引路径
              </button>
            )}
          </div>
        </section>
      )}

      {/* 日志列表 - 同步开始后显示 */}
      {hasStarted && (
        <section className="sync-logs">
          <div className="logs-header">
            <span>运行日志</span>
            <span className="logs-count">{logs.length}</span>
          </div>
          <div className="logs-list">
            {logs.length === 0 ? (
              <div className="logs-empty">等待同步开始...</div>
            ) : (
              logs.map((entry) => (
                <div className="log-entry" key={entry.key}>
                  <span className="log-time">{entry.time}</span>
                  <span className={`log-level ${entry.level}`}>{entry.level}</span>
                  <span className="log-msg">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
