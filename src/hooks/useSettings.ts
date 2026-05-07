/* ==========================================================================
   设置管理 Hook
   ========================================================================== */

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings>({
    hasToken: false,
    tokenMasked: null,
    defaultOutputDir: "",
    defaultPageSize: 100,
    lastMode: "incremental"
  });
  const [loading, setLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
      return loaded;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveToken = useCallback(async (token: string) => {
    await invoke("save_token", { token });
    return loadSettings();
  }, [loadSettings]);

  const saveSettings = useCallback(async (input: Partial<Settings>) => {
    await invoke<Settings>("save_settings", { input });
    return loadSettings();
  }, [loadSettings]);

  const selectExportDir = useCallback(async (): Promise<string | null> => {
    return invoke<string | null>("select_export_dir");
  }, []);

  return {
    settings,
    loading,
    loadSettings,
    saveToken,
    saveSettings,
    selectExportDir
  };
}
