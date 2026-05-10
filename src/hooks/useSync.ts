/* ==========================================================================
   同步逻辑 Hook - 状态与事件管理
   ========================================================================== */

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  Settings,
  SyncSnapshot,
  SyncCompletedEvent,
  SyncLogEvent,
  SyncItemEvent,
  LogEntry,
  SyncOverview,
  FailedItem
} from "../types";

const emptySnapshot: SyncSnapshot = {
  status: "idle",
  running: false,
  cancelRequested: false,
  mode: null,
  exportDir: null,
  pageSize: 100,
  currentPage: null,
  pageNotes: null,
  processedCount: 0,
  totalFetched: 0,
  totalExpected: null,
  currentMessage: "等待开始",
  indexPath: null,
  startedAt: null,
  finishedAt: null,
  counters: {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    cancelled: false
  }
};

export function useSync() {
  const [settings, setSettings] = useState<Settings>({
    hasToken: false,
    tokenMasked: null,
    defaultOutputDir: "",
    defaultPageSize: 100,
    lastMode: "incremental",
    exportStructure: "flat",
    fileNamePattern: "title_id",
    openOutputDirAfterSync: false,
    showSyncTips: true
  });
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(emptySnapshot);
  const [summary, setSummary] = useState<SyncCompletedEvent | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const deferredLogs = useDeferredValue(logs);

  // 同步概览数据
  const [overview, setOverview] = useState<SyncOverview | null>(null);
  // 失败的条目
  const [failedItems, setFailedItems] = useState<FailedItem[]>([]);
  // 初始化错误
  const [initError, setInitError] = useState<string | null>(null);

  const appendLog = useEffectEvent((payload: SyncLogEvent) => {
    const time = new Date(payload.ts).toLocaleTimeString();
    startTransition(() => {
      setLogs((current) => {
        const next = [
          ...current,
          {
            key: `${payload.ts}-${current.length}`,
            time,
            level: payload.level || "info",
            message: payload.message
          }
        ];
        return next.length > 400 ? next.slice(-400) : next;
      });
    });
  });

  const applySnapshot = useEffectEvent((next: SyncSnapshot) => {
    setSnapshot(next);
  });

  const applyCompletion = useEffectEvent((event: SyncCompletedEvent) => {
    setSummary(event);
    // 同步完成后刷新概览
    loadOverview();
  });

  // 处理同步条目事件
  const handleSyncItem = useEffectEvent((payload: SyncItemEvent) => {
    if (payload.action === "failed" && payload.error) {
      setFailedItems((current) => {
        const item: FailedItem = {
          noteId: payload.noteId,
          title: payload.title,
          action: "failed",
          error: payload.error ?? ""
        };
        const next = [item, ...current];
        return next.slice(0, 10);
      });
    }
  });

  // 加载同步概览
  const loadOverview = useEffectEvent(async () => {
    try {
      const data = await invoke<SyncOverview>("get_sync_overview");
      setOverview(data);
    } catch (error) {
      console.error("Failed to load sync overview:", error);
    }
  });

  // 使用 ref 来防止重复注册监听器
  const listenersRegistered = useRef(false);

  useEffect(() => {
    if (listenersRegistered.current) {
      return;
    }

    let mounted = true;
    let cleanup: Array<() => void> = [];

    async function boot() {
      try {
        const [loadedSettings, loadedSnapshot] = await Promise.all([
          invoke<Settings>("get_settings"),
          invoke<SyncSnapshot>("get_sync_snapshot")
        ]);

        // 加载概览数据
        await loadOverview();

        if (!mounted) return;

        setSettings(loadedSettings);
        applySnapshot(loadedSnapshot);

        // 注册事件监听器
        cleanup = await Promise.all([
          listen<SyncSnapshot>("sync_state", ({ payload }) => {
            applySnapshot(payload);
          }),
          listen<SyncLogEvent>("sync_log", ({ payload }) => {
            appendLog(payload);
          }),
          listen<SyncCompletedEvent>("sync_completed", ({ payload }) => {
            applyCompletion(payload);
          }),
          listen<SyncItemEvent>("sync_item", ({ payload }) => {
            handleSyncItem(payload);
          })
        ]);
        listenersRegistered.current = true;
        console.log("[DEBUG] Event listeners registered:", cleanup.length);
      } catch (error) {
        if (mounted) {
          setInitError(String(error));
        }
      }
    }

    boot();

    return () => {
      mounted = false;
      console.log("[DEBUG] Cleaning up event listeners:", cleanup.length);
      for (const unlisten of cleanup) {
        unlisten();
      }
      listenersRegistered.current = false;
    };
  }, []);

  const refreshSettings = async () => {
    const nextSettings = await invoke<Settings>("get_settings");
    setSettings(nextSettings);
  };

  const saveSettings = async (params: {
    defaultOutputDir?: string;
    defaultPageSize?: number;
    lastMode?: "incremental" | "full";
  }) => {
    await invoke<Settings>("save_settings", {
      input: {
        defaultOutputDir: params.defaultOutputDir ?? settings.defaultOutputDir,
        defaultPageSize: params.defaultPageSize ?? settings.defaultPageSize,
        lastMode: params.lastMode ?? settings.lastMode
      }
    });
    await refreshSettings();
  };

  const startSync = async (params: {
    exportDir: string;
    mode: "incremental" | "full";
    pageSize: number;
  }) => {
    console.log("[DEBUG] startSync hook called");
    setSummary(null);
    setLogs([]);
    setFailedItems([]);

    console.log("[DEBUG] startSync: calling save_settings");
    try {
      await invoke<Settings>("save_settings", {
        input: {
          defaultOutputDir: params.exportDir,
          defaultPageSize: params.pageSize
        }
      });
      console.log("[DEBUG] startSync: save_settings returned");
    } catch (e) {
      console.warn("[DEBUG] startSync: save_settings failed (non-fatal):", e);
    }

    console.log("[DEBUG] startSync: calling start_sync command");
    await invoke("start_sync", {
      request: {
        exportDir: params.exportDir,
        syncMode: params.mode,
        pageSize: params.pageSize
      }
    });
    console.log("[DEBUG] startSync: start_sync command returned");
  };

  const cancelSync = async () => {
    await invoke("cancel_sync");
  };

  const clearLogs = () => setLogs([]);

  // 打开导出目录
  const openExportDir = useCallback(async (dir?: string) => {
    const targetDir = dir || settings.defaultOutputDir;
    if (!targetDir) return;
    try {
      await invoke("open_export_dir", { dir: targetDir });
    } catch (error) {
      console.error("Failed to open export dir:", error);
    }
  }, [settings.defaultOutputDir]);

  return {
    settings,
    snapshot,
    summary,
    logs: deferredLogs,
    overview,
    failedItems,
    initError,
    refreshSettings,
    saveSettings,
    startSync,
    cancelSync,
    clearLogs,
    openExportDir
  };
}
