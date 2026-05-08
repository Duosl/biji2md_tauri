/* ==========================================================================
   应用入口 - 路由布局与导航（含新手引导）
   ========================================================================== */

import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Toolbar } from "./components/Toolbar";
import { SyncPage } from "./pages/SyncPage";
import { SettingsPage } from "./pages/SettingsPage";
import { OnboardingGuide } from "./components/OnboardingGuide";
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
  const [syncPageVersion, setSyncPageVersion] = useState(0);
  const [onboardingState, setOnboardingState] = useState({
    hasToken: false,
    hasExportDir: false
  });

  // 检查是否需要显示新手引导
  useEffect(() => {
    async function checkOnboarding() {
      try {
        const settings = await invoke<Settings>("get_settings");
        const hasToken = settings.hasToken;
        const hasExportDir = !!settings.defaultOutputDir?.trim();
        setOnboardingState({ hasToken, hasExportDir });
        // 如果 Token 或导出目录未配置，显示引导
        if (!hasToken || !hasExportDir) {
          setShowOnboarding(true);
        }
      } catch (err) {
        console.error("Failed to check onboarding status:", err);
      } finally {
        setIsLoading(false);
      }
    }
    checkOnboarding();
  }, []);

  const handleOnboardingComplete = () => {
    setOnboardingState({ hasToken: true, hasExportDir: true });
    setSyncPageVersion((current) => current + 1);
    setShowOnboarding(false);
  };

  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
  };

  const renderPage = () => {
    switch (currentPage) {
      case "sync":
        return (
          <SyncPage
            key={syncPageVersion}
            onOpenSettings={() => setCurrentPage("settings")}
          />
        );
      case "settings":
        return <SettingsPage />;
      default:
        return <SyncPage onOpenSettings={() => setCurrentPage("settings")} />;
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
              <p>v0.1.0</p>
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
        onComplete={handleOnboardingComplete}
        onSkip={handleOnboardingSkip}
      />
    </div>
  );
}
