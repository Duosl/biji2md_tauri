/* ==========================================================================
   同步页面 - 笔记导出同步功能
   ========================================================================== */

import { useState, useEffect } from "react";
import { useSync } from "../hooks/useSync";

export function SyncPage() {
  const {
    settings,
    snapshot,
    summary,
    logs,
    saveSettings,
    startSync,
    cancelSync
  } = useSync();

  const [statusText, setStatusText] = useState("准备就绪");

  const mode = settings.lastMode === "full" ? "full" : "incremental";

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
    if (isRunning) return;
    const exportDir = settings.defaultOutputDir || "";
    if (!exportDir.trim()) {
      setStatusText("请先设置导出目录");
      return;
    }
    await startSync({
      exportDir,
      mode,
      pageSize: settings.defaultPageSize || 100
    });
  };

  return (
    <div className="page-content sync-page">
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

        <button
          className={`sync-button ${isRunning ? "running" : ""}`}
          onClick={handleStartSync}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <span className="spinner" />
              同步中
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

      {/* 上次摘要 - 完成后显示 */}
      {summary && !isRunning && (
        <section className="sync-result">
          <div className="result-header">
            <span className="result-title">上次同步完成</span>
            <span className="result-time">{summary.total} 条笔记</span>
          </div>
          <div className="result-detail">
            新增 {summary.created} · 更新 {summary.updated} · 跳过 {summary.skipped}
            {summary.failed > 0 && ` · 失败 ${summary.failed}`}
          </div>
          {summary.indexPath && (
            <code className="result-path">{summary.indexPath}</code>
          )}
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
