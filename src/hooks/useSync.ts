/* ==========================================================================
   同步逻辑 Hook - 状态与事件管理
   ========================================================================== */

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useState
} from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type {
  Settings,
  SyncSnapshot,
  SyncCompletedEvent,
  SyncLogEvent,
  LogEntry
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
    lastMode: "incremental"
  });
  const [snapshot, setSnapshot] = useState<SyncSnapshot>(emptySnapshot);
  const [summary, setSummary] = useState<SyncCompletedEvent | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const deferredLogs = useDeferredValue(logs);

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
  });

  useEffect(() => {
    let active = true;
    let cleanup: Array<() => void> = [];

    async function boot() {
      const [loadedSettings, loadedSnapshot] = await Promise.all([
        invoke<Settings>("get_settings"),
        invoke<SyncSnapshot>("get_sync_snapshot")
      ]);

      if (!active) return;

      setSettings(loadedSettings);
      applySnapshot(loadedSnapshot);

      cleanup = await Promise.all([
        listen<SyncSnapshot>("sync_state", ({ payload }) => {
          applySnapshot(payload);
        }),
        listen<SyncLogEvent>("sync_log", ({ payload }) => {
          appendLog(payload);
        }),
        listen<SyncCompletedEvent>("sync_completed", ({ payload }) => {
          applyCompletion(payload);
        })
      ]);
    }

    boot().catch(() => {});

    return () => {
      active = false;
      for (const unlisten of cleanup) {
        unlisten();
      }
    };
  }, [appendLog, applyCompletion, applySnapshot]);

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
    setSummary(null);
    setLogs([]);

    await invoke<Settings>("save_settings", {
      input: {
        defaultOutputDir: params.exportDir,
        defaultPageSize: params.pageSize
      }
    });

    await invoke("start_sync", {
      request: {
        exportDir: params.exportDir,
        syncMode: params.mode,
        pageSize: params.pageSize
      }
    });
  };

  const cancelSync = async () => {
    await invoke("cancel_sync");
  };

  const clearLogs = () => setLogs([]);

  return {
    settings,
    snapshot,
    summary,
    logs: deferredLogs,
    refreshSettings,
    saveSettings,
    startSync,
    cancelSync,
    clearLogs
  };
}
