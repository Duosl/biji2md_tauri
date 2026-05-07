/* ==========================================================================
   设置页面 - 全局配置
   ========================================================================== */

import { useState, useEffect } from "react";
import { useSettings } from "../hooks/useSettings";

export function SettingsPage() {
  const { settings, loadSettings, saveSettings, saveToken, selectExportDir } = useSettings();
  const [tokenDraft, setTokenDraft] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [pageSize, setPageSize] = useState("100");
  const [autoStart, setAutoStart] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    setExportDir(settings.defaultOutputDir || "");
    setPageSize(String(settings.defaultPageSize || 100));
  }, [settings]);

  const handleSaveToken = async () => {
    const token = tokenDraft.trim();
    if (!token) return;
    await saveToken(token);
    setTokenDraft("");
  };

  const handleSelectDir = async () => {
    const selected = await selectExportDir();
    if (selected) {
      setExportDir(selected);
    }
  };

  const handleSave = async () => {
    await saveSettings({
      defaultOutputDir: exportDir,
      defaultPageSize: Number(pageSize) || 100
    });
  };

  return (
    <div className="page-content">
      <header className="content-header">
        <div>
          <p className="content-label">设置</p>
          <h2>全局配置</h2>
        </div>
      </header>

      {/* API 配置 */}
      <section className="section">
        <h3 className="section-title">API 配置</h3>
        <div className="form-group">
          <label className="form-label">Bearer Token</label>
          <textarea
            className="text-field text-area"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder={settings.tokenMasked ? `已保存: ${settings.tokenMasked}` : "输入 Token"}
          />
          <div className="btn-row">
            <button className="btn btn-secondary" onClick={handleSaveToken}>
              保存 Token
            </button>
          </div>
        </div>
      </section>

      {/* 导出设置 */}
      <section className="section">
        <h3 className="section-title">导出设置</h3>
        <div className="form-group">
          <label className="form-label">默认导出目录</label>
          <div className="inline-field">
            <input
              className="text-field"
              value={exportDir}
              onChange={(e) => setExportDir(e.target.value)}
              placeholder="选择目录"
              readOnly
            />
            <button className="btn btn-secondary" onClick={handleSelectDir}>
              浏览
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">默认分页大小</label>
          <input
            className="text-field"
            type="number"
            min={1}
            value={pageSize}
            onChange={(e) => setPageSize(e.target.value)}
            style={{ width: 120 }}
          />
        </div>
      </section>

      {/* 应用设置 */}
      <section className="section">
        <h3 className="section-title">应用设置</h3>
        <div className="setting-list">
          <div className="setting-item">
            <div className="setting-info">
              <h4>开机启动</h4>
              <p>系统启动时自动运行</p>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => setAutoStart(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
          <div className="setting-item">
            <div className="setting-info">
              <h4>深色模式</h4>
              <p>切换暗色主题</p>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={darkMode}
                onChange={(e) => setDarkMode(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>
      </section>

    </div>
  );
}
