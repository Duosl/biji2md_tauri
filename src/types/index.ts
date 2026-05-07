/* ==========================================================================
   类型定义 - 全应用共享
   ========================================================================== */

export type Settings = {
  hasToken: boolean;
  tokenMasked?: string | null;
  defaultOutputDir?: string | null;
  defaultPageSize: number;
  lastMode: "incremental" | "full" | string;
};

export type SyncCounters = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
};

export type SyncSnapshot = {
  status: string;
  running: boolean;
  cancelRequested: boolean;
  mode?: string | null;
  exportDir?: string | null;
  pageSize?: number | null;
  currentPage?: number | null;
  pageNotes?: number | null;
  processedCount: number;
  totalFetched: number;
  totalExpected?: number | null;
  currentMessage: string;
  indexPath?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  counters: SyncCounters;
};

export type SyncCompletedEvent = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  indexPath: string;
};

export type SyncLogEvent = {
  ts: number;
  level: string;
  message: string;
};

export type LogEntry = {
  key: string;
  time: string;
  level: string;
  message: string;
};

export type PageKey = "sync" | "automation" | "settings";

export type NavItem = {
  key: PageKey;
  label: string;
  icon: string;
};
