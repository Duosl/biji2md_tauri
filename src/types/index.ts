/* ==========================================================================
   类型定义 - 全应用共享
   ========================================================================== */

export type Settings = {
  hasToken: boolean;
  tokenMasked?: string | null;
  defaultOutputDir?: string | null;
  defaultPageSize: number;
  lastMode: "incremental" | "full" | string;
  // 导出偏好设置
  exportStructure: "flat" | "by_month" | "by_tag";
  fileNamePattern: "title_id" | "date_title_id";
  openOutputDirAfterSync: boolean;
  showSyncTips: boolean;
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

export type SyncItemEvent = {
  pageNum: number;
  pageIndex: number;
  processedCount: number;
  totalExpected?: number | null;
  noteId: string;
  title: string;
  action: string;
  filePath?: string | null;
  error?: string | null;
};

export type LogEntry = {
  key: string;
  time: string;
  level: string;
  message: string;
};

export type FailedItem = {
  noteId: string;
  title: string;
  action: string;
  error: string;
};

// 同步历史记录项
export type SyncHistoryEntry = {
  timestamp: number;
  mode: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
};

// 同步概览
export type SyncOverview = {
  lastSyncAt?: number | null;
  lastFullSyncAt?: number | null;
  lastMode?: string | null;
  lastSummary?: SyncHistoryEntry | null;
  indexPath?: string | null;
  recentFailedCount: number;
  hasConfig: boolean;
};

export type PageKey = "sync" | "automation" | "settings";

export type NavItem = {
  key: PageKey;
  label: string;
  icon: string;
};
