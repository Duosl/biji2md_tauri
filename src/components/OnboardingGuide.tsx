/* ==========================================================================
   新手引导组件 - 分步引导用户完成初始配置
   ========================================================================== */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import logoUrl from "../assets/ic_logo.svg";

interface OnboardingGuideProps {
  isOpen: boolean;
  hasToken: boolean;
  hasExportDir: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

type Step = "welcome" | "token" | "directory" | "ready";

export function OnboardingGuide({
  isOpen,
  hasToken,
  hasExportDir,
  onComplete,
  onSkip
}: OnboardingGuideProps) {
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [token, setToken] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const nextStep: Step = hasToken
        ? (hasExportDir ? "ready" : "directory")
        : (hasExportDir ? "token" : "welcome");
      setCurrentStep(nextStep);
      setToken("");
      setExportDir("");
      setError(null);
    }
  }, [hasExportDir, hasToken, isOpen]);

  const handleSaveToken = async () => {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      setError("请输入 Token");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await invoke("save_token", { token: trimmedToken });
      setCurrentStep("directory");
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectDir = async () => {
    try {
      const selected = await invoke<string | null>("select_export_dir");
      if (selected) {
        setExportDir(selected);
        setError(null);
      }
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSaveDir = async () => {
    if (!exportDir) {
      setError("请选择导出目录");
      return;
    }
    setIsSaving(true);
    try {
      await invoke("save_settings", {
        input: { defaultOutputDir: exportDir }
      });
      setCurrentStep("ready");
    } catch (err) {
      setError(String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleStart = () => {
    onComplete();
  };

  if (!isOpen) return null;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal">
        {/* 步骤指示器 */}
        <div className="onboarding-steps">
          <div className={`step-indicator ${currentStep === "welcome" ? "active" : ""} ${["token", "directory", "ready"].includes(currentStep) ? "completed" : ""}`}>
            <span className="step-num">1</span>
            <span className="step-label">欢迎</span>
          </div>
          <div className={`step-line ${["token", "directory", "ready"].includes(currentStep) ? "completed" : ""}`} />
          <div className={`step-indicator ${currentStep === "token" ? "active" : ""} ${["directory", "ready"].includes(currentStep) ? "completed" : ""}`}>
            <span className="step-num">2</span>
            <span className="step-label">配置 Token</span>
          </div>
          <div className={`step-line ${["directory", "ready"].includes(currentStep) ? "completed" : ""}`} />
          <div className={`step-indicator ${currentStep === "directory" ? "active" : ""} ${currentStep === "ready" ? "completed" : ""}`}>
            <span className="step-num">3</span>
            <span className="step-label">选择目录</span>
          </div>
          <div className={`step-line ${currentStep === "ready" ? "completed" : ""}`} />
          <div className={`step-indicator ${currentStep === "ready" ? "active" : ""}`}>
            <span className="step-num">4</span>
            <span className="step-label">完成</span>
          </div>
        </div>

        {/* 步骤内容 */}
        <div className="onboarding-content">
          {currentStep === "welcome" && (
            <div className="step-content">
              <div className="welcome-icon">
                <img src={logoUrl} alt="biji2md" className="logo-img" />
              </div>
              <h2>欢迎使用 biji2md</h2>
              <p>只需 3 步，即可开始将您的笔记导出为 Markdown 格式</p>
              <ul className="feature-list">
                <li>批量导出笔记为 Markdown</li>
                <li>支持增量同步，只导出新内容</li>
                <li>本地存储，数据安全可控</li>
              </ul>
            </div>
          )}

          {currentStep === "token" && (
            <div className="step-content">
              <h2>配置 API Token</h2>
              <p>Token 用于访问您的笔记数据，我们不会存储或上传您的数据</p>
              <div className="form-group">
                <label>Bearer Token</label>
                <textarea
                  className="text-field text-area"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="粘贴您的 Token 到这里"
                  rows={4}
                />
                <span className="form-hint">Token 仅保存在本地，不会上传到任何服务器</span>
                <button className="link-btn" onClick={() => open("https://my.feishu.cn/wiki/FOBBw4Y5PisOU4k842VcIu0Sndb")}>
                  如何获取 Token
                </button>
              </div>
            </div>
          )}

          {currentStep === "directory" && (
            <div className="step-content">
              <h2>选择导出目录</h2>
              <p>选择一个文件夹来存放导出的 Markdown 文件</p>
              <div className="form-group">
                <label>导出目录</label>
                <div className="inline-field">
                  <input
                    className="text-field"
                    value={exportDir}
                    readOnly
                    placeholder="点击浏览选择目录"
                  />
                  <button className="btn btn-secondary" onClick={handleSelectDir}>
                    浏览
                  </button>
                </div>
                {exportDir && (
                  <span className="form-hint success">已选择: {exportDir}</span>
                )}
              </div>
            </div>
          )}

          {currentStep === "ready" && (
            <div className="step-content">
              <div className="success-icon">🎉</div>
              <h2>配置完成！</h2>
              <p>您已完成所有必要配置，可以开始同步笔记了</p>
              <div className="config-summary">
                <div className="summary-item">
                  <span className="summary-label">Token</span>
                  <span className="summary-value">已配置</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">导出目录</span>
                  <span className="summary-value" title={exportDir}>
                    {exportDir.length > 30 ? exportDir.slice(0, 30) + "..." : exportDir}
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>

        {/* 底部按钮 */}
        <div className="onboarding-footer">
          {currentStep === "welcome" && (
            <>
              <button className="btn btn-secondary" onClick={onSkip}>
                跳过引导
              </button>
              <button className="btn btn-primary" onClick={() => setCurrentStep("token")}>
                开始配置
              </button>
            </>
          )}

          {currentStep === "token" && (
            <>
              <button className="btn btn-secondary" onClick={() => setCurrentStep("welcome")}>
                上一步
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveToken}
                disabled={isSaving || !token.trim()}
              >
                {isSaving ? "保存中..." : "下一步"}
              </button>
            </>
          )}

          {currentStep === "directory" && (
            <>
              <button className="btn btn-secondary" onClick={() => setCurrentStep("token")}>
                上一步
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveDir}
                disabled={isSaving || !exportDir}
              >
                {isSaving ? "保存中..." : "下一步"}
              </button>
            </>
          )}

          {currentStep === "ready" && (
            <button className="btn btn-primary btn-full" onClick={handleStart}>
              开始使用
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
