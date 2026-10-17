/**
 * 执行机切换器（M4 + handoff 用户反馈 2026-10-16）：
 * 会话页 header 显示会话当前在哪台机器执行；点击可切换。
 * 跨机切换弹警告——agent 上下文记得旧机器的文件，但新机器上文件可能不存在/版本不同。
 */
import { useState } from "react";
import { api } from "../api.ts";
import { envLabel } from "../pages/Conversations.tsx";
import { Modal } from "./Modal.tsx";
import type { ExecutorInfo } from "@dorahub/shared";

export function EnvSwitcher({
  convId,
  current,
  executors,
  onSwitched,
  onOpen,
}: {
  convId: string;
  current: string | null;
  executors: ExecutorInfo[];
  onSwitched?: (envId: string | null) => void;
  /** 弹窗打开时触发（父组件刷新执行机状态） */
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const currentLabel = envLabel(current, executors.find((e) => e.envId === current)?.host);
  const switching = current && current !== "hub";

  async function switchTo(target: string) {
    setBusy(true);
    setError("");
    try {
      await api.configure(convId, { envId: target });
      onSwitched?.(target === "hub" ? null : target);
      setOpen(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="model-tag env-tag"
        title="会话在这台机器上执行，点击切换"
        onClick={() => {
          onOpen?.();
          setOpen(true);
        }}
      >
        {currentLabel}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)}>
          <h3>切换执行机</h3>

          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginBottom: 12 }}>
            当前：<strong>{currentLabel}</strong>
          </div>

          {switching && (
            <div className="env-warning">
              ⚠ <strong>跨机切换须知</strong>
              <div style={{ marginTop: 6 }}>
                agent 的对话记忆会完整保留，但它记得的是
                <strong>旧机器上的文件</strong>（改动过什么、文件内容）。
                新机器上的文件可能不存在或版本不同——建议切换后先让 agent
                重新查看关键文件再继续任务。
              </div>
            </div>
          )}

          <label className="picker-label">选择目标机器</label>
          <div className="picker-row">
            <button
              className={`picker-chip ${!current || current === "hub" ? "on" : ""}`}
              disabled={busy}
              onClick={() => switchTo("hub")}
              title="hub 云端主机"
            >
              ☁ 云端 hub
            </button>
            {executors
              .filter((e) => e.envId !== "hub")
              .map((e) => (
                <button
                  key={e.envId}
                  className={`picker-chip ${current === e.envId ? "on" : ""} ${e.online ? "" : "chip-offline"}`}
                  disabled={busy}
                  onClick={() => switchTo(e.envId)}
                  title={e.online ? `${e.host} · 在线` : `${e.host} · 离线（可切换；工具调用会等它上线）`}
                >
                  🖥 {e.envId}
                  <span className="chip-status">{e.online ? "" : " · 离线"}</span>
                </button>
              ))}
          </div>

          {executors.filter((e) => e.envId !== "hub").length === 0 && (
            <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", marginTop: 8 }}>
              还没有注册其他执行机（M4：在 hub 配置 DORAHUB_EXEC_* 环境变量接入远程机器）
            </div>
          )}

          {error && <div className="picker-msg">{error}</div>}

          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(false)}>取消</button>
          </div>
        </Modal>
      )}
    </>
  );
}
