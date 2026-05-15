/* ==========================================================================
   打赏弹窗 - 展示微信与支付宝收款码
   ========================================================================== */

import { useEffect } from "react";
import wechatRewardUrl from "../assets/reward-wechat.jpeg";
import alipayRewardUrl from "../assets/reward-alipay.jpeg";

interface RewardDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const rewardChannels = [
  {
    key: "wechat",
    label: "微信",
    hint: "微信扫一扫",
    imageUrl: wechatRewardUrl
  },
  {
    key: "alipay",
    label: "支付宝",
    hint: "支付宝扫一扫",
    imageUrl: alipayRewardUrl
  }
];

export function RewardDialog({ isOpen, onClose }: RewardDialogProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="reward-overlay" onClick={onClose}>
      <section
        className="reward-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reward-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="reward-close-btn" onClick={onClose} aria-label="关闭打赏弹窗">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>

        <div className="reward-header">
          <span className="reward-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M20.4 4.6a5.5 5.5 0 0 0-7.8 0L12 5.2l-.6-.6a5.5 5.5 0 0 0-7.8 7.8l.6.6L12 20.8l7.8-7.8.6-.6a5.5 5.5 0 0 0 0-7.8Z" />
            </svg>
          </span>
          <div>
            <p className="reward-kicker">支持 biji2md</p>
            <h2 id="reward-title">请作者喝杯咖啡</h2>
          </div>
        </div>

        <div className="reward-code-grid">
          {rewardChannels.map((channel) => (
            <figure className={`reward-code-card reward-code-${channel.key}`} key={channel.key}>
              <div className="reward-code-frame">
                <img src={channel.imageUrl} alt={`${channel.label}收款码`} />
              </div>
              <figcaption>
                <strong>{channel.label}</strong>
                <span>{channel.hint}</span>
              </figcaption>
            </figure>
          ))}
        </div>

        <p className="reward-note">谢谢你的支持，继续把笔记安全、稳定地导出来。</p>
      </section>
    </div>
  );
}
