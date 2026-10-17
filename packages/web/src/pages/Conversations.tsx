/** 会话列表页（06 §2 + handoff §0.5-B + 执行机路由 M4）：
 *  免命名新建（选执行机 + 项目文件夹）、按项目分组、自动元数据卡片、执行机徽章。 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";
import { navigate } from "../route.ts";
import { relTime } from "../util/time.ts";
import { Modal } from "../components/Modal.tsx";
import type { ConversationSummary, ExecutorInfo } from "@dorahub/shared";

/** cwd → 项目显示名（basename） */
function projectOf(cwd: string | null): { name: string; path: string } {
  if (!cwd) return { name: "未指定项目", path: "" };
  const norm = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm.split("/").filter(Boolean).pop() ?? norm;
  return { name: base || norm, path: cwd };
}

/** 执行机显示：envId → 短名（hub 显示"云端"） */
export function envLabel(envId: string | null, host?: string): string {
  if (!envId || envId === "hub") return "☁ 云端 hub";
  return `🖥 ${envId}${host ? ` · ${host}` : ""}`;
}

export function ConversationsPage() {
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  /** 拉执行机状态（打开新建弹窗前必调；服务端 30s 节流，不会打爆） */
  function refreshExecutors() {
    api.executors().then(setExecutors).catch(() => {});
  }

  async function refresh() {
    try {
      setConvs(await api.listConversations());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    refreshExecutors();
    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "conv_status") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, status: f.status } : c)));
        } else if (f.t === "conv_meta") {
          // 自动命名完成 → 无刷新换标题/描述（handoff S5）
          setConvs((cs) =>
            cs.map((c) =>
              c.id === f.conv
                ? { ...c, name: f.name, description: f.description, keywords: f.keywords, envId: f.envId }
                : c,
            ),
          );
        }
      },
    });
    return unsub;
  }, []);

  async function create(opts: { cwd?: string; envId?: string }) {
    try {
      const { id } = await api.createConversation({
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.envId && opts.envId !== "hub" ? { envId: opts.envId } : {}),
      });
      navigate({ page: "conversation", id });
    } catch (e: any) {
      setError(e.message);
      setCreating(false);
    }
  }

  // 按项目分组（cwd 为 key），组内按 updatedAt 倒排
  const groups = useMemo(() => {
    const byCwd = new Map<string, ConversationSummary[]>();
    for (const c of convs) {
      const key = c.cwd ?? "";
      if (!byCwd.has(key)) byCwd.set(key, []);
      byCwd.get(key)!.push(c);
    }
    const list = [...byCwd.entries()].map(([cwd, items]) => ({
      cwd,
      project: projectOf(cwd || null),
      items: items.sort((a, b) => b.updatedAt - a.updatedAt),
    }));
    // 最近活动的组排前面；"未指定"排最后
    list.sort((a, b) => {
      const aLast = Math.max(...a.items.map((c) => c.updatedAt));
      const bLast = Math.max(...b.items.map((c) => c.updatedAt));
      if (!a.cwd) return 1;
      if (!b.cwd) return -1;
      return bLast - aLast;
    });
    return list;
  }, [convs]);

  return (
    <div className="page-list">
      <header className="list-header">
        <h1>
          Dora<span className="brand-dot">Hub</span>
        </h1>
        <button
          className="btn primary"
          onClick={() => {
            refreshExecutors(); // 打开前刷新设备状态（用户要求：有意检查注册设备在线情况）
            setCreating(true);
          }}
        >
          ＋ 新会话
        </button>
      </header>
      {error && <div className="error-banner" onClick={() => setError("")}>{error} ✕</div>}

      <div className="conv-list">
        {convs.length === 0 && (
          <div className="empty">还没有会话。创建一个，任何设备都能接着聊。</div>
        )}
        {groups.map((g) => (
          <div key={g.cwd || "_none"}>
            <div className="group-label" title={g.project.path}>
              <span className="group-name">{g.project.name}</span>
              <span className="group-count">{g.items.length} 个会话</span>
            </div>
            {g.items.map((c) => (
              <ConvCard key={c.id} conv={c} style={{ marginTop: 8 }} />
            ))}
          </div>
        ))}
      </div>

      {creating && (
        <CreateModal
          executors={executors}
          onClose={() => setCreating(false)}
          onCreate={create}
        />
      )}
    </div>
  );
}

function ConvCard({ conv, style }: { conv: ConversationSummary; style?: React.CSSProperties }) {
  const unnamed = !conv.name;
  return (
    <div
      className="conv-item"
      style={style}
      onClick={() => navigate({ page: "conversation", id: conv.id })}
    >
      <div className="conv-item-top">
        <span className={`conv-name ${unnamed ? "unnamed" : ""}`}>
          {unnamed ? "新会话" : conv.name}
        </span>
        {conv.status === "running" && <span className="badge-running">● 运行中</span>}
        <span className="conv-time">{relTime(conv.updatedAt)}</span>
      </div>
      {(conv.envId || conv.cwd) && (
        <div className="conv-env">
          <span className="env-badge" title={conv.cwd ?? undefined}>
            {envLabel(conv.envId)}
          </span>
          {conv.cwd && <span className="env-path">{projectOf(conv.cwd).path}</span>}
        </div>
      )}
      {conv.description && <div className="conv-desc">{conv.description}</div>}
      {conv.keywords.length > 0 && (
        <div className="conv-keywords">
          {conv.keywords.map((k, i) => (
            <span key={i} className="kw-chip">{k}</span>
          ))}
        </div>
      )}
      {!conv.description && conv.lastPreview && (
        <div className="conv-preview">{conv.lastPreview}</div>
      )}
    </div>
  );
}

/** 新建弹窗：选执行机 + 项目文件夹，不命名（0.5-B + M4）。 */
function CreateModal({
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
