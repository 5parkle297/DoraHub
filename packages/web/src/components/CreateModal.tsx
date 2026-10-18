/** 新建会话弹窗：选执行机 + 项目文件夹，不命名（0.5-B + M4）。 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { envLabel, projectOf } from "./Sidebar.tsx";
import { Modal } from "./Modal.tsx";
import type { ExecutorInfo } from "@dorahub/shared";

export function CreateModal({
  executors,
  onClose,
  onCreate,
}: {
  executors: ExecutorInfo[];
  onClose: () => void;
  onCreate: (opts: { cwd?: string; envId?: string }) => void;
}) {
  const [envId, setEnvId] = useState<string>("hub");
  const [custom, setCustom] = useState("");

  // 选中执行机的默认 cwd（切换机器时重置手输路径）
  const currentExec = executors.find((e) => e.envId === envId);

  // 最近用过的 cwd（按执行机分组）
  const recent = useMemo(() => {
    const seen = new Map<string, number>();
    try {
      const cached = JSON.parse(localStorage.getItem("dorahub.recentCwds") ?? "[]") as { cwd: string; at: number; envId?: string }[];
      for (const r of cached) {
        // 旧数据无 envId 视为 hub
        if (!r.envId || r.envId === envId) seen.set(r.cwd, r.at);
      }
    } catch { /* ignore */ }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd).slice(0, 8);
  }, [envId]);

  useEffect(() => {
    // 列表数据到达后补全 recent
    api.listConversations().then((cs) => {
      const cached = JSON.parse(localStorage.getItem("dorahub.recentCwds") ?? "[]") as { cwd: string; at: number; envId?: string }[];
      let changed = false;
      for (const c of cs) {
        if (c.cwd && !cached.some((r) => r.cwd === c.cwd)) {
          cached.push({ cwd: c.cwd, at: c.updatedAt, envId: c.envId ?? "hub" });
          changed = true;
        }
      }
      if (changed) localStorage.setItem("dorahub.recentCwds", JSON.stringify(cached.slice(-30)));
    }).catch(() => {});
  }, []);

  function pick(cwd: string) {
    rememberCwd(cwd, envId);
    onCreate({ cwd, envId });
  }

  return (
    <Modal onClose={onClose}>
      <h3>新建会话</h3>
      <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginBottom: 12 }}>
        不用起名——发出第一条消息后会自动生成标题和摘要。
      </div>

      <label className="picker-label">在哪台机器上执行</label>
      <div className="picker-row">
        <button
          key="hub"
          className={`picker-chip ${envId === "hub" ? "on" : ""}`}
          onClick={() => setEnvId("hub")}
          title="hub 云端主机（阿里云 VM，常开）"
        >
          ☁ 云端 hub
        </button>
        {executors.filter((e) => e.envId !== "hub").map((e) => (
          <button
            key={e.envId}
            className={`picker-chip ${envId === e.envId ? "on" : ""} ${e.online ? "" : "chip-offline"}`}
            onClick={() => setEnvId(e.envId)}
            title={e.online ? `${e.host} · 在线` : `${e.host} · 离线（开机并连上 Tailscale 后可用；仍可创建会话，工具调用会等它上线）`}
          >
            🖥 {e.envId}
            <span className="chip-status">{e.online ? "" : " · 离线"}</span>
          </button>
        ))}
      </div>
      {executors.some((e) => e.envId !== "hub" && !e.online) && (
        <div className="offline-hint">灰色 = 设备离线；仍可选择，agent 工具调用会等它上线后自动恢复</div>
      )}

      <label className="picker-label">项目文件夹{currentExec && `（${envLabel(envId, currentExec.host)} 的路径）`}</label>
      <div className="cwd-options">
        {recent.map((cwd) => (
          <button key={cwd} className="cwd-option" onClick={() => pick(cwd)}>
            <span className="opt-name">{projectOf(cwd).name}</span>
            <span className="opt-path" title={cwd}>{cwd}</span>
          </button>
        ))}
        {recent.length === 0 && (
          <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", padding: "4px 2px" }}>
            还没有最近项目，在下面输入路径
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          value={custom}
          placeholder={
            envId === "hub"
              ? "或输入路径（如 /var/lib/dorahub/workspace/xxx）"
              : `或输入 ${envId} 上的路径`
          }
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && custom.trim()) pick(custom.trim());
          }}
        />
        <button
          className="btn primary"
          style={{ flex: "none" }}
          disabled={!custom.trim()}
          onClick={() => pick(custom.trim())}
        >
          创建
        </button>
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => onCreate({ envId })}>不选文件夹，直接建</button>
      </div>
    </Modal>
  );
}

function rememberCwd(cwd: string, envId: string) {
  try {
    const cached = JSON.parse(localStorage.getItem("dorahub.recentCwds") ?? "[]") as { cwd: string; at: number; envId?: string }[];
    const next = [...cached.filter((r) => r.cwd !== cwd), { cwd, at: Date.now(), envId }];
    localStorage.setItem("dorahub.recentCwds", JSON.stringify(next.slice(-30)));
  } catch { /* ignore */ }
}
