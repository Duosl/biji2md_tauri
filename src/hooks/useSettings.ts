/* ==========================================================================
   设置管理 Hook - 字段级自动保存
   ========================================================================== */

import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../types";

export type SaveStatus = "idle" | "saving" | "success" | "error";

// 字段级保存状态
export type FieldSaveState = {
  status: SaveStatus;
  error: string | null;
};

export function useSettings() {
  // 当前保存的设置（从后端加载的）
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

  // 加载状态
  const [loading, setLoading] = useState(false);

  // 全局保存状态（用于批量保存，现在主要作为兼容）
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  // 字段级保存状态
  const [fieldSaveStates, setFieldSaveStates] = useState<Record<string, FieldSaveState>>({});

  // Token 草稿（未保存的输入）
  const [tokenDraft, setTokenDraft] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await invoke<Settings>("get_settings");
      setSettings(loaded);
      return loaded;
    } catch (error) {
      setSaveError(String(error));
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  // 保存单个字段（自动保存核心）
  const saveField = useCallback(async <T extends string | number | boolean>(
    field: string,
    value: T
  ): Promise<void> => {
    // 设置该字段为保存中状态
    setFieldSaveStates(prev => ({
      ...prev,
      [field]: { status: "saving", error: null }
    }));

    try {
      const loaded = await invoke<Settings>("save_setting_field", {
        input: { field, value }
      });
      setSettings(loaded);

      // 保存成功
      setFieldSaveStates(prev => ({
        ...prev,
        [field]: { status: "success", error: null }
      }));

      // 3秒后清除成功状态
      setTimeout(() => {
        setFieldSaveStates(prev => {
          const next = { ...prev };
          if (next[field]?.status === "success") {
            delete next[field];
          }
          return next;
        });
      }, 2000);
    } catch (error) {
      setFieldSaveStates(prev => ({
        ...prev,
        [field]: { status: "error", error: String(error) }
      }));
      throw error;
    }
  }, []);

  // 保存 Token（特殊处理，需要清空草稿）
  const saveToken = useCallback(async (token: string): Promise<void> => {
    if (!token.trim()) return;

    setFieldSaveStates(prev => ({
      ...prev,
      token: { status: "saving", error: null }
    }));

    try {
      await saveField("token", token.trim());
      setTokenDraft(""); // 清空草稿
    } catch (error) {
      setFieldSaveStates(prev => ({
        ...prev,
        token: { status: "error", error: String(error) }
      }));
      throw error;
    }
  }, [saveField]);

  // 清空 Token
  const clearToken = useCallback(async (): Promise<void> => {
    setFieldSaveStates(prev => ({
      ...prev,
      token: { status: "saving", error: null }
    }));

    try {
      const loaded = await invoke<Settings>("clear_token");
      setSettings(loaded);
      setTokenDraft(""); // 清空草稿

      setFieldSaveStates(prev => ({
        ...prev,
        token: { status: "success", error: null }
      }));

      // 3秒后清除成功状态
      setTimeout(() => {
        setFieldSaveStates(prev => {
          const next = { ...prev };
          if (next.token?.status === "success") {
            delete next.token;
          }
          return next;
        });
      }, 2000);
    } catch (error) {
      setFieldSaveStates(prev => ({
        ...prev,
        token: { status: "error", error: String(error) }
      }));
      throw error;
    }
  }, []);

  // 批量保存（兼容旧接口，现在内部调用单个字段保存）
  const saveSettings = useCallback(async (input: Partial<Settings>): Promise<void> => {
    setSaveStatus("saving");
    setSaveError(null);

    try {
      // 并行保存所有字段
      const promises: Promise<void>[] = [];

      if (input.defaultOutputDir !== undefined && input.defaultOutputDir !== null) {
        promises.push(saveField("defaultOutputDir", input.defaultOutputDir));
      }
      if (input.defaultPageSize !== undefined) {
        promises.push(saveField("defaultPageSize", input.defaultPageSize));
      }
      if (input.exportStructure !== undefined) {
        promises.push(saveField("exportStructure", input.exportStructure));
      }
      if (input.fileNamePattern !== undefined) {
        promises.push(saveField("fileNamePattern", input.fileNamePattern));
      }
      if (input.openOutputDirAfterSync !== undefined) {
        promises.push(saveField("openOutputDirAfterSync", input.openOutputDirAfterSync));
      }
      if (input.showSyncTips !== undefined) {
        promises.push(saveField("showSyncTips", input.showSyncTips));
      }

      await Promise.all(promises);
      setSaveStatus("success");
    } catch (error) {
      setSaveStatus("error");
      setSaveError(String(error));
      throw error;
    }
  }, [saveField]);

  const selectExportDir = useCallback(async (): Promise<string | null> => {
    return invoke<string | null>("select_export_dir");
  }, []);

  // 获取字段保存状态
  const getFieldStatus = useCallback((field: string): FieldSaveState => {
    return fieldSaveStates[field] || { status: "idle", error: null };
  }, [fieldSaveStates]);

  // 重置保存状态
  const resetSaveStatus = useCallback(() => {
    setSaveStatus("idle");
    setSaveError(null);
    setFieldSaveStates({});
  }, []);

  // 自动清除全局成功状态
  useEffect(() => {
    if (saveStatus === "success") {
      const timer = setTimeout(() => {
        setSaveStatus("idle");
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [saveStatus]);

  return {
    settings,
    loading,
    saveStatus,
    saveError,
    fieldSaveStates,
    tokenDraft,
    setTokenDraft,
    loadSettings,
    saveField,
    saveToken,
    clearToken,
    saveSettings,
    selectExportDir,
    getFieldStatus,
    resetSaveStatus
  };
}
