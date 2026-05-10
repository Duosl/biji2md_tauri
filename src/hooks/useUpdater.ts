/* ==========================================================================
   自动更新 Hook - 检测、下载、安装
   ========================================================================== */

import { useState, useCallback, useRef, useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "uptodate"
  | "error";

export type UpdateState = {
  status: UpdateStatus;
  version?: string;
  currentVersion?: string;
  body?: string;
  progress?: number;
  error?: string;
};

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 小时
const STARTUP_DELAY = 3000; // 启动后 3 秒检测

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCheckingRef = useRef(false);

  const checkForUpdates = useCallback(async (silent = true) => {
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    try {
      setState((prev) => ({ ...prev, status: "checking" }));

      const update = await check();

      if (update) {
        setState({
          status: "available",
          version: update.version,
          currentVersion: undefined,
          body: update.body || undefined,
        });

        // 静默下载
        if (silent) {
          setState((prev) => ({
            ...prev,
            status: "downloading",
            progress: 0,
          }));

          let downloaded = 0;
          let contentLength = 0;

          await update.downloadAndInstall((event) => {
            switch (event.event) {
              case "Started":
                contentLength = event.data.contentLength || 0;
                break;
              case "Progress":
                downloaded += event.data.chunkLength;
                if (contentLength > 0) {
                  const progress = Math.round(
                    (downloaded / contentLength) * 100
                  );
                  setState((prev) => ({ ...prev, progress }));
                }
                break;
              case "Finished":
                setState((prev) => ({ ...prev, status: "ready" }));
                break;
            }
          });
        }
      } else {
        setState({ status: "idle" });
      }
    } catch (error) {
      const msg = String(error);
      const isRemoteEmpty =
        /release\s*json|fetch|404|not\s*found|invalid/i.test(msg);
      if (isRemoteEmpty) {
        setState({ status: "uptodate" });
      } else {
        setState({ status: "error", error: msg });
      }
    } finally {
      isCheckingRef.current = false;
    }
  }, []);

  const installUpdate = useCallback(async () => {
    await relaunch();
  }, []);

  // 启动时检测 + 定时检测
  useEffect(() => {
    const startupTimer = setTimeout(() => {
      checkForUpdates(true);
    }, STARTUP_DELAY);

    timerRef.current = setInterval(() => {
      checkForUpdates(true);
    }, CHECK_INTERVAL);

    return () => {
      clearTimeout(startupTimer);
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [checkForUpdates]);

  return {
    state,
    checkForUpdates,
    installUpdate,
  };
}
