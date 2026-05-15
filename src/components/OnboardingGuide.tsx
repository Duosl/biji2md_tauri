/* ==========================================================================
   新手引导组件 - 分步引导用户完成初始配置
   ========================================================================== */

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-shell";
import logoUrl from "../assets/ic_logo.svg";
import type { DirExportConfig } from "../types";

interface OnboardingGuideProps {
  isOpen: boolean;
  hasToken: boolean;
  hasExportDir: boolean;
  tokenMasked?: string;
  defaultExportDir?: string;
  onComplete: () => void;
  onOpenSettings: () => void;
  onSkip: () => void;
}

type Step = "welcome" | "token" | "directory" | "ready";

const steps: Array<{ key: Step; label: string }> = [
  { key: "welcome", label: "欢迎页" },
  { key: "token", label: "配置 Token" },
  { key: "directory", label: "选择导出目录" },
  { key: "ready", label: "配置完成" }
];

export function OnboardingGuide({
  isOpen,
  hasToken,
  hasExportDir,
  tokenMasked = "",
  defaultExportDir = "",
  onComplete,
  onOpenSettings,
  onSkip
}: OnboardingGuideProps) {
  const [currentStep, setCurrentStep] = useState<Step>("welcome");
  const [token, setToken] = useState("");
  const [exportDir, setExportDir] = useState("");
  const [dirExportConfig, setDirExportConfig] = useState<DirExportConfig>({
    structure: "by_topic",
    linkFormat: "wikilink"
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep("welcome");
      setToken("");
      setExportDir(hasExportDir ? defaultExportDir : "");
      setError(null);
    }
  }, [defaultExportDir, hasExportDir, isOpen]);

  const handleSaveToken = async () => {
    const trimmedToken = token.trim();
    if (hasToken && !trimmedToken) {
      setCurrentStep("directory");
      return;
    }
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
    if (hasExportDir && exportDir === defaultExportDir) {
      setCurrentStep("ready");
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

  const handleMoreSettings = () => {
    onOpenSettings();
  };

  const handlePreviousStep = () => {
    const previousStep: Record<Exclude<Step, "welcome">, Step> = {
      token: "welcome",
      directory: "token",
      ready: "directory"
    };
    if (currentStep === "welcome") return;
    setCurrentStep(previousStep[currentStep]);
  };

  const tokenStatusText = hasToken
    ? tokenMasked
      ? `已配置：${tokenMasked}`
      : "已配置"
    : "";
  const tokenStepCompleted = hasToken || ["directory", "ready"].includes(currentStep);
  const directoryStepCompleted = hasExportDir || currentStep === "ready";
  const displayExportDir = exportDir || defaultExportDir;
  const stepCompletedMap: Record<Step, boolean> = {
    welcome: ["token", "directory", "ready"].includes(currentStep),
    token: tokenStepCompleted,
    directory: directoryStepCompleted,
    ready: currentStep === "ready"
  };
  const tokenPrimaryLabel = hasToken && !token.trim() ? "使用已配置 Token" : "下一步";
  const directoryPrimaryLabel = hasExportDir && exportDir === defaultExportDir ? "使用当前目录" : "下一步";
  const exportStructureLabel = formatExportStructure(dirExportConfig.structure);
  const linkFormatLabel = formatLinkFormat(dirExportConfig.linkFormat);
  const displayExportDirTail = formatPathTail(displayExportDir);

  useEffect(() => {
    if (!isOpen || !displayExportDir) {
      setDirExportConfig({ structure: "by_topic", linkFormat: "wikilink" });
      return;
    }

    let cancelled = false;
    invoke<DirExportConfig>("get_dir_export_config", { exportDir: displayExportDir })
      .then((config) => {
        if (cancelled) return;
        setDirExportConfig({
          structure: normalizeExportStructure(config.structure),
          linkFormat: normalizeLinkFormat(config.linkFormat)
        });
      })
      .catch(() => {
        if (cancelled) return;
        setDirExportConfig({ structure: "by_topic", linkFormat: "wikilink" });
      });

    return () => {
      cancelled = true;
    };
  }, [displayExportDir, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-steps" aria-label="引导步骤">
          <div className="onboarding-brand">
            <img src={logoUrl} alt="" className="onboarding-brand-logo" />
            <strong>biji2md</strong>
          </div>

          <div className="step-list">
            {steps.map((step, index) => (
              <div
                key={step.key}
                className={`step-indicator ${currentStep === step.key ? "active" : ""} ${stepCompletedMap[step.key] ? "completed" : ""}`}
                aria-current={currentStep === step.key ? "step" : undefined}
              >
                <span className="step-num">{index + 1}</span>
                <span className="step-label">{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="onboarding-content">
          {currentStep !== "welcome" && (
            <button className="onboarding-back-link" onClick={handlePreviousStep}>
             ← 上一步
            </button>
          )}

          {currentStep === "welcome" && (
            <div className="step-content">
              <div className="welcome-icon">
                <img src={logoUrl} alt="biji2md" className="logo-img" />
              </div>
              <h2 id="onboarding-title">批量导出笔记到本地目录</h2>
              <p>简单配置，就可以把云端笔记导出为本地 Markdown 文件。</p>

              <div className="onboarding-preview" aria-label="导出效果预览">
                <div className="preview-window-bar">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="preview-file-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                    <path d="M14 3v5h5" />
                  </svg>
                  <strong>我的笔记.md</strong>
                </div>
                <div className="preview-line strong" />
                <div className="preview-line" />
                <div className="preview-line short" />
                <div className="preview-chip-row">
                  <span>Markdown</span>
                  <span>本机保存</span>
                  <span>可重导出</span>
                </div>
              </div>
            </div>
          )}

          {currentStep === "token" && (
            <div className="step-content">
              <h2 id="onboarding-title">配置 Token</h2>
              <div className="form-group">
                <textarea
                  className="text-field text-area"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={hasToken ? "已配置 Token；如需更换，可粘贴新的 Token" : "粘贴您的 Token 到这里"}
                  rows={4}
                />
                <span className={`form-hint ${hasToken ? "success" : ""}`}>
                  {hasToken ? tokenStatusText : "Token 用于读取你的笔记数据，仅保存在本地，不会上传到任何服务器。"}
                </span>
                <button className="link-btn" onClick={() => open("https://my.feishu.cn/wiki/FOBBw4Y5PisOU4k842VcIu0Sndb")}>
                  点击查看如何获取 Token
                </button>
              </div>
            </div>
          )}

          {currentStep === "directory" && (
            <div className="step-content">
              <h2 id="onboarding-title">选择导出目录</h2>
              <div className="form-group">
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
                
                <span className="form-hint">
                  {exportDir ? `已选择: ${exportDir}` : "选择一个文件夹来存放导出的 Markdown 文件"}
                </span>
              </div>
            </div>
          )}

          {currentStep === "ready" && (
            <div className="step-content">
              <div className="success-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              </div>
              <h2 id="onboarding-title">配置完成</h2>
              <div className="config-summary">
                <div className="summary-section-label">必要配置</div>
                <div className="summary-item">
                  <span className="summary-label">Token</span>
                  <span className="summary-value">已配置</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">导出目录</span>
                  <span className="summary-value" title={displayExportDir}>
                    {displayExportDirTail}
                  </span>
                </div>
                <div className="summary-section-label">其他默认配置(可在设置页修改)</div>
                <div className="summary-item">
                  <span className="summary-label">目录结构</span>
                  <span className="summary-value">{exportStructureLabel}</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">父子链接</span>
                  <span className="summary-value">{linkFormatLabel}</span>
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
        </div>

        <div className={`onboarding-footer ${currentStep === "ready" ? "onboarding-footer-ready" : ""}`}>
          {currentStep === "welcome" && (
            <>
              <button className="btn btn-secondary" onClick={onSkip}>
                稍后再说
              </button>
              <button className="btn btn-primary" onClick={() => setCurrentStep("token")}>
                开始配置
              </button>
            </>
          )}

          {currentStep === "token" && (
            <button
              className="btn btn-primary btn-full"
              onClick={handleSaveToken}
              disabled={isSaving || (!hasToken && !token.trim())}
            >
              {isSaving ? "保存中..." : tokenPrimaryLabel}
            </button>
          )}

          {currentStep === "directory" && (
            <button
              className="btn btn-primary btn-full"
              onClick={handleSaveDir}
              disabled={isSaving || !exportDir}
            >
              {isSaving ? "保存中..." : directoryPrimaryLabel}
            </button>
          )}

          {currentStep === "ready" && (
            <>
              <button className="btn btn-primary" onClick={handleStart}>
                开始使用
              </button>
              <button className="btn btn-secondary" onClick={handleMoreSettings}>
                修改默认配置
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function normalizeExportStructure(value?: string | null): DirExportConfig["structure"] {
  return value === "flat" || value === "by_month" || value === "by_tag" || value === "by_topic"
    ? value
    : "by_topic";
}

function normalizeLinkFormat(value?: string | null): DirExportConfig["linkFormat"] {
  return value === "markdown" || value === "wikilink" ? value : "wikilink";
}

function formatExportStructure(value: DirExportConfig["structure"]): string {
  const labels: Record<DirExportConfig["structure"], string> = {
    by_topic: "按知识库分组",
    by_month: "按月份分组",
    by_tag: "按主标签分组",
    flat: "平铺"
  };
  return labels[value];
}

function formatLinkFormat(value: DirExportConfig["linkFormat"]): string {
  return value === "markdown" ? "Markdown 链接" : "Obsidian Wikilink";
}

function formatPathTail(value: string, maxLength = 36): string {
  if (value.length <= maxLength) return value;

  const separator = value.includes("\\") ? "\\" : "/";
  const tail = value
    .split(/[\\/]+/)
    .filter(Boolean)
    .slice(-3)
    .join(separator);
  const compact = `...${separator}${tail}`;

  if (compact.length <= maxLength) return compact;
  return `...${value.slice(-(maxLength - 3))}`;
}
