/* ==========================================================================
   缓存管理 Hook - 本地笔记缓存查询与重导出
   ========================================================================== */

import { useEffectEvent, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CacheInfo } from "../types";

export function useCache() {
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [reexporting, setReexporting] = useState(false);

  const loadCacheInfo = useEffectEvent(async () => {
    try {
      const data = await invoke<CacheInfo>("get_cache_info");
      setCacheInfo(data);
    } catch (error) {
      console.error("Failed to load cache info:", error);
    }
  });

  const reexportFromCache = async (
    targetDir?: string,
    structure?: string,
    linkFormat?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (reexporting) return { success: false, error: "正在重导出" };

    setReexporting(true);
    try {
      await invoke("reexport_from_cache", { exportDir: targetDir, structure, linkFormat });
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    } finally {
      setReexporting(false);
    }
  };

  const reexportSafe = async (
    structure?: string,
    linkFormat?: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (reexporting) return { success: false, error: "正在重导出" };

    setReexporting(true);
    try {
      await invoke("reexport_from_cache_safe", { structure, linkFormat });
      return { success: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    } finally {
      setReexporting(false);
    }
  };

  return { cacheInfo, reexporting, loadCacheInfo, reexportFromCache, reexportSafe };
}
