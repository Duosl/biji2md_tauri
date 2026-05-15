/* ==========================================================================
   应用入口 - 路由布局与导航（含新手引导）
   ========================================================================== */

import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toolbar } from "./components/Toolbar";
import { SyncPage } from "./pages/SyncPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OnboardingGuide } from "./components/OnboardingGuide";
import { useUpdater } from "./hooks/useUpdater";
import { useSync } from "./hooks/useSync";
import { useCache } from "./hooks/useCache";
import type { PageKey, NavItem, Settings } from "./types";

const navItems: NavItem[] = [
  { key: "sync", label: "笔记同步", icon: "sync" },
  { key: "settings", label: "设置", icon: "settings" }
];

function Icon({ name }: { name: string }) {
  const iconProps = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  const icons: Record<string, React.ReactNode> = {
    sync: (
      <svg {...iconProps}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 12.25h6" />
        <path d="M9 16h6" />
      </svg>
    ),
    automation: (
      <svg {...iconProps}>
        <path d="M13 2.75 5.75 13h5.25l-1 8.25L18.25 11H13.5L13 2.75Z" />
      </svg>
    ),
    settings: (
      <svg {...iconProps} strokeWidth="1.6">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.23.5.74.83 1.3 1H21a2 2 0 1 1 0 4h-.09c-.56.17-1.06.6-1.3 1Z" />
      </svg>
    )
  };
  return icons[name] || null;
}

export function App() {
  const [currentPage, setCurrentPage] = useState<PageKey>("sync");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [onboardingState, setOnboardingState] = useState({
    hasToken: false,
    hasExportDir: false,
    tokenMasked: "",
    exportDir: ""
  });
  const {
    state: updateState,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  } = useUpdater();
  const [appVersion, setAppVersion] = useState("0.0.0");
  const sync = useSync();
  const cache = useCache();

  useEffect(() => {
    void cache.loadCacheInfo();
  }, [cache.loadCacheInfo]);

  useEffect(() => {
    if (!sync.summary) return;
    void cache.loadCacheInfo();
  }, [sync.summary, cache.loadCacheInfo]);

  useEffect(() => {
    async function initApp() {
      try {
        const platformInfo = await invoke<{ platform: string; titleBarHeight: number }>("get_platform_info");
        document.documentElement.dataset.platform = platformInfo.platform;
        document.documentElement.style.setProperty("--title-bar-height", `${platformInfo.titleBarHeight}px`);
        document.documentElement.style.setProperty("--window-controls-space", platformInfo.platform === "macos" ? "76px" : "0px");

        const settings = await invoke<Settings>("get_settings");
        const hasToken = settings.hasToken;
        const exportDir = settings.defaultOutputDir?.trim() || "";
        const hasExportDir = !!exportDir;
        setOnboardingState({
          hasToken,
          hasExportDir,
          tokenMasked: settings.tokenMasked || "",
          exportDir
        });

        const version = await invoke<string>("get_app_version");
        setAppVersion(version);
        if (!settings.onboardingCompleted && (!hasToken || !hasExportDir)) {
          setShowOnboarding(true);
        }
      } catch (err) {
        console.error("Failed to initialize app:", err);
      } finally {
        setIsLoading(false);
      }
    }
    initApp();
  }, []);

  const markOnboardingSeen = async () => {
    try {
      await invoke("save_setting_field", {
        input: { field: "onboardingCompleted", value: true }
      });
    } catch (err) {
      console.error("Failed to save onboarding state:", err);
    }
  };

  const handleOnboardingComplete = () => {
    void markOnboardingSeen();
    setOnboardingState((current) => ({ ...current, hasToken: true, hasExportDir: true }));
    void sync.refreshSettings();
    setShowOnboarding(false);
  };

  const handleOnboardingOpenSettings = () => {
    void markOnboardingSeen();
    setOnboardingState((current) => ({ ...current, hasToken: true, hasExportDir: true }));
    void sync.refreshSettings();
    setShowOnboarding(false);
    setCurrentPage("settings");
  };

  const handleOnboardingSkip = () => {
    void markOnboardingSeen();
    setShowOnboarding(false);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "sync":
        return (
          <SyncPage
            sync={sync}
            cache={cache}
            onOpenSettings={() => setCurrentPage("settings")}
          />
        );
      case "settings":
        return (
          <SettingsPage
            cache={cache}
            updateState={updateState}
            onCheckUpdate={checkForUpdates}
            onDownloadUpdate={downloadUpdate}
            onInstallUpdate={installUpdate}
            onSettingsChanged={sync.refreshSettings}
          />
        );
      default:
        return <SyncPage sync={sync} cache={cache} onOpenSettings={() => setCurrentPage("settings")} />;
    }
  };

  if (isLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed)}
        updateReady={updateState.status === "ready"}
        onInstallUpdate={installUpdate}
      />

      <div className="app-body">
        {!sidebarCollapsed && (
          <aside className="sidebar">
            <nav className="sidebar-nav">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${currentPage === item.key ? "active" : ""}`}
                  onClick={() => setCurrentPage(item.key)}
                >
                  <span className="nav-icon"><Icon name={item.icon} /></span>
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="sidebar-footer">
              <p>v{appVersion}</p>
            </div>
          </aside>
        )}

        <main className="content">
          {renderPage()}
        </main>
      </div>

      {/* 新手引导弹窗 */}
      <OnboardingGuide
        isOpen={showOnboarding}
        hasToken={onboardingState.hasToken}
        hasExportDir={onboardingState.hasExportDir}
        tokenMasked={onboardingState.tokenMasked}
        defaultExportDir={onboardingState.exportDir}
        onComplete={handleOnboardingComplete}
        onOpenSettings={handleOnboardingOpenSettings}
        onSkip={handleOnboardingSkip}
      />
    </div>
  );
}
