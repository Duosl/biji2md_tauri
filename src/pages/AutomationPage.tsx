/* ==========================================================================
   自动化任务页面 - 定时同步、规则配置
   ========================================================================== */

import { useState } from "react";

export function AutomationPage() {
  const [tasks, setTasks] = useState([
    { id: 1, name: "每日自动同步", enabled: true, schedule: "每天 09:00", lastRun: "2024-01-15 09:00", nextRun: "2024-01-16 09:00" },
    { id: 2, name: "每周全量备份", enabled: false, schedule: "每周日 02:00", lastRun: "-", nextRun: "2024-01-21 02:00" }
  ]);

  return (
    <div className="page-content">
      <header className="content-header">
        <div>
          <p className="content-label">自动化</p>
          <h2>定时任务</h2>
        </div>
      </header>

      {/* 任务列表 */}
      <section className="section">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 className="section-title">任务列表</h3>
          <button className="btn btn-primary">新建任务</button>
        </div>

        <div className="task-list">
          {tasks.map((task) => (
            <div key={task.id} className="task-item">
              <div className="task-info">
                <div className="task-name">{task.name}</div>
                <div className="task-schedule">{task.schedule}</div>
              </div>
              <div className="task-meta">
                <span>上次: {task.lastRun}</span>
                <span>下次: {task.nextRun}</span>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={task.enabled}
                  onChange={() => {}}
                />
                <span className="toggle-slider" />
              </label>
            </div>
          ))}
        </div>

        {tasks.length === 0 && (
          <div className="empty-state">
            <p>暂无自动化任务</p>
            <p>创建定时同步规则，让备份自动化运行</p>
          </div>
        )}
      </section>

      {/* 快速配置 */}
      <section className="section">
        <h3 className="section-title">快速配置</h3>
        <p className="section-subtitle">常用定时规则模板</p>
        <div className="template-grid">
          <button className="template-card">
            <strong>每日同步</strong>
            <span>每天上午 9 点自动增量同步</span>
          </button>
          <button className="template-card">
            <strong>每周备份</strong>
            <span>每周日凌晨全量备份</span>
          </button>
          <button className="template-card">
            <strong>每小时</strong>
            <span>整点自动检查更新</span>
          </button>
        </div>
      </section>
    </div>
  );
}
