/* ==========================================================================
   工具栏 - macOS 标题栏区域自定义按钮
   ========================================================================== */

interface ToolbarProps {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  updateReady: boolean;
  onInstallUpdate: () => void;
}

export function Toolbar({ sidebarCollapsed, onToggleSidebar, updateReady, onInstallUpdate }: ToolbarProps) {
  const iconProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.25,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <button
          className="toolbar-btn"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
        >
          {sidebarCollapsed ? (
            <svg {...iconProps}>
              <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25" />
              <path d="M5.9 3.35v9.3" />
            </svg>
          ) : (
            <svg {...iconProps}>
              <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.25" />
              <rect x="3.35" y="3.35" width="2.45" height="9.3" rx="0.9" fill="currentColor" stroke="none" />
            </svg>
          )}
        </button>
        {updateReady && (
          <button
            className="toolbar-update-action"
            onClick={onInstallUpdate}
            title="新版本已下载，点击重启更新"
          >
            <span className="update-dot" aria-hidden="true" />
            <svg {...iconProps} width={14} height={14}>
              <path d="M13.25 9.25v2.25a1.75 1.75 0 0 1-1.75 1.75h-7a1.75 1.75 0 0 1-1.75-1.75V9.25" />
              <path d="M5 6.25 8 9.25l3-3" />
              <path d="M8 9.25v-7.5" />
            </svg>
            <span>重启更新</span>
          </button>
        )}
      </div>

      <div className="toolbar-center" data-tauri-drag-region />

      <div className="toolbar-right" data-tauri-drag-region>
        {/* 可扩展更多工具按钮 */}
      </div>
    </div>
  );
}
