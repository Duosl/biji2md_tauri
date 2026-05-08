/* ==========================================================================
   设置页面 - 字段级自动保存
   ========================================================================== */

import { useState, useEffect } from "react";
import { useSettings } from "../hooks/useSettings";

export function SettingsPage() {
  const {
    settings,
    loading,
    saveError,
    fieldSaveStates,
    tokenDraft,
    setTokenDraft,
    loadSettings,
    saveField,
    saveToken,
    clearToken,
    selectExportDir
  } = useSettings();

  // 本地编辑状态（用于输入框）
  const [localValues, setLocalValues] = useState({
    defaultOutputDir: "",
    defaultPageSize: 100,
  });

  // 初始化加载
  useEffect(() => {
    loadSettings();
  }, []);

  // 同步本地值到设置
  useEffect(() => {
    setLocalValues({
      defaultOutputDir: settings.defaultOutputDir || "",
      defaultPageSize: settings.defaultPageSize || 100,
    });
  }, [settings]);

  // 渲染字段保存状态
  const renderFieldStatus = (field: string) => {
    const state = fieldSaveStates[field];
    if (!state) return null;

    if (state.status === "saving") {
      return <span className="field-status saving">保存中...</span>;
    }
    if (state.status === "success") {
      return <span className="field-status success">已保存</span>;
    }
    if (state.status === "error") {
      return <span className="field-status error">保存失败: {state.error}</span>;
    }
    return null;
  };

  // 目录选择
  const handleSelectDir = async () => {
    const selected = await selectExportDir();
    if (selected) {
      await saveField("defaultOutputDir", selected);
    }
  };

  // 目录清空
  const handleClearDir = async () => {
    await saveField("defaultOutputDir", "");
  };

  // 分页大小变更（失焦时保存）
  const handlePageSizeBlur = () => {
    const num = Number(localValues.defaultPageSize);
    if (!isNaN(num) && num > 0 && num !== settings.defaultPageSize) {
      saveField("defaultPageSize", num);
    }
  };

  // Token 保存
  const handleSaveToken = async () => {
    const token = tokenDraft.trim();
    if (!token) return;
    await saveToken(token);
  };

  // Token 清空
  const handleClearToken = async () => {
    await clearToken();
  };

  return (
    <div className="page-content">
      <header className="content-header">
        <div>
          <p className="content-label">设置</p>
          <h2>全局配置</h2>
        </div>
        {saveError && (
          <div className="header-actions">
            <span className="save-status error">错误: {saveError}</span>
          </div>
        )}
      </header>

      {/* API 配置 */}
      <section className="section">
        <h3 className="section-title">API 配置</h3>
        <div className="form-group">
          <label className="form-label">
            Bearer Token
            {settings.hasToken && (
              <span className="field-status success">已配置</span>
            )}
            {renderFieldStatus("token")}
          </label>
          <textarea
            className="text-field text-area"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder={settings.tokenMasked ? `已保存: ${settings.tokenMasked}` : "输入 Token"}
          />
          <div className="btn-row">
            <button
              className="btn btn-secondary"
              onClick={handleSaveToken}
              disabled={!tokenDraft.trim() || fieldSaveStates.token?.status === "saving"}
            >
              {fieldSaveStates.token?.status === "saving" ? "保存中..." : "保存 Token"}
            </button>
            {settings.hasToken && (
              <button
                className="btn btn-danger"
                onClick={handleClearToken}
                disabled={fieldSaveStates.token?.status === "saving"}
              >
                清空 Token
              </button>
            )}
          </div>
        </div>
      </section>

      {/* 导出设置 */}
      <section className="section">
        <h3 className="section-title">导出设置</h3>
        <div className="form-group">
          <label className="form-label">
            默认导出目录
            {renderFieldStatus("defaultOutputDir")}
          </label>
          <div className="inline-field">
            <input
              className="text-field"
              value={localValues.defaultOutputDir}
              onChange={(e) => setLocalValues(prev => ({ ...prev, defaultOutputDir: e.target.value }))}
              placeholder="选择目录"
              readOnly
            />
            <button className="btn btn-secondary" onClick={handleSelectDir}>
              浏览
            </button>
            {settings.defaultOutputDir && (
              <button className="btn btn-danger" onClick={handleClearDir}>
                清空
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            默认分页大小
            {renderFieldStatus("defaultPageSize")}
          </label>
          <input
            className="text-field"
            type="number"
            min={1}
            value={localValues.defaultPageSize}
            onChange={(e) => setLocalValues(prev => ({ ...prev, defaultPageSize: Number(e.target.value) }))}
            onBlur={handlePageSizeBlur}
            style={{ width: 120 }}
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            导出目录结构
            {renderFieldStatus("exportStructure")}
          </label>
          <div className="radio-group">
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="flat"
                checked={settings.exportStructure === "flat"}
                onChange={(e) => saveField("exportStructure", e.target.value)}
              />
              <span>平铺（所有文件在同一目录）</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="by_month"
                checked={settings.exportStructure === "by_month"}
                onChange={(e) => saveField("exportStructure", e.target.value)}
              />
              <span>按月份分组</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="exportStructure"
                value="by_tag"
                checked={settings.exportStructure === "by_tag"}
                onChange={(e) => saveField("exportStructure", e.target.value)}
              />
              <span>按标签分组</span>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            文件名规则
            {renderFieldStatus("fileNamePattern")}
          </label>
          <div className="radio-group">
            <label className="radio-item">
              <input
                type="radio"
                name="fileNamePattern"
                value="title_id"
                checked={settings.fileNamePattern === "title_id"}
                onChange={(e) => saveField("fileNamePattern", e.target.value)}
              />
              <span>标题__ID</span>
            </label>
            <label className="radio-item">
              <input
                type="radio"
                name="fileNamePattern"
                value="date_title_id"
                checked={settings.fileNamePattern === "date_title_id"}
                onChange={(e) => saveField("fileNamePattern", e.target.value)}
              />
              <span>日期_标题__ID</span>
            </label>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            同步完成后操作
            {renderFieldStatus("openOutputDirAfterSync")}
          </label>
          <label className="checkbox-item">
            <input
              type="checkbox"
              checked={settings.openOutputDirAfterSync}
              onChange={(e) => saveField("openOutputDirAfterSync", e.target.checked)}
            />
            <span>自动打开导出目录</span>
          </label>
        </div>
      </section>
    </div>
  );
}
