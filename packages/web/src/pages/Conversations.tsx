/** 会话列表页（06 §2 + handoff §0.5-B）：免命名新建 + 按项目分组 + 自动元数据卡片。 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";
import { navigate } from "../route.ts";
import { relTime } from "../util/time.ts";
import type { ConversationSummary } from "@dorahub/shared";

/** cwd → 项目显示名（basename） */
function projectOf(cwd: string | null): { name: string; path: string } {
  if (!cwd) return { name: "未指定项目", path: "" };
  const norm = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const base = norm.split("/").filter(Boolean).pop() ?? norm;
  return { name: base || norm, path: cwd };
}

export function ConversationsPage() {
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

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
    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "conv_status") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, status: f.status } : c)));
        } else if (f.t === "conv_meta") {
          // 自动命名完成 → 无刷新换标题/描述（handoff S5）
          setConvs((cs) =>
            cs.map((c) =>
              c.id === f.conv
                ? { ...c, name: f.name, description: f.description, keywords: f.keywords }
                : c,
            ),
          );
        }
      },
    });
    return unsub;
  }, []);

  async function create(cwd?: string) {
    try {
      const { id } = await api.createConversation(cwd ? { cwd } : {});
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
        <button className="btn primary" onClick={() => setCreating(true)}>＋ 新会话</button>
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

      {creating && <CreateModal onClose={() => setCreating(false)} onCreate={create} />}
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

/** 新建弹窗：只选项目文件夹，不命名（0.5-B）。 */
function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (cwd?: string) => void }) {
  const [custom, setCustom] = useState("");

  // 最近用过的 cwd（从现有会话收集）
  const recent = useMemo(() => {
    // 从 api 拿不到别的来源，直接用父组件数据不方便——从 localStorage 缓存 + 现有列表
    const seen = new Map<string, number>();
    try {
      const cached = JSON.parse(localStorage.getItem("dorahub.recentCwds") ?? "[]") as { cwd: string; at: number }[];
      for (const r of cached) seen.set(r.cwd, r.at);
    } catch { /* ignore */ }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([cwd]) => cwd).slice(0, 8);
  }, []);

  useEffect(() => {
    // 列表数据到达后补全 recent（通过 fetch 一次，简单可靠）
    api.listConversations().then((cs) => {
      const seen = new Map<string, number>();
      for (const c of cs) if (c.cwd) seen.set(c.cwd, Math.max(seen.get(c.cwd) ?? 0, c.updatedAt));
      for (const [cwd, at] of seen) {
        const cached = JSON.parse(localStorage.getItem("dorahub.recentCwds") ?? "[]") as { cwd: string; at: number }[];
        if (!cached.some((r) => r.cwd === cwd)) {
          cached.push({ cwd, at });
          localStorage.setItem("durahub.recentCwds", JSON.stringify(cached.slice(-30)));
        }
      }
    }).catch(() => {});
  }, []);

  function pick(cwd: string) {
    rememberCwd(cwd);
    onCreate(cwd);
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>新建会话</h3>
        <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)", marginBottom: 12 }}>
          不用起名——发出第一条消息后会自动生成标题和摘要。
        </div>
        <div className="cwd-options">
          {recent.map((cwd) => (
            <button key={cwd} className="cwd-option" onClick={() => pick(cwd)}>
              <span className="opt-name">{projectOf(cwd).name}</span>
              <span className="opt-path" title={cwd}>{cwd}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={custom}
            placeholder="或输入项目路径（如 D:/hobby/xxx）"
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
          <button className="btn" onClick={() => onCreate()}>不选，直接建</button>
        </div>
      </div>
    </div>
  );
}

function rememberCwd(cwd: string) {
  try {
    const cached = JSON.parse(localStorage.getItem("dorahub.recentCwds") ?? "[]") as { cwd: string; at: number }[];
    const next = [...cached.filter((r) => r.cwd !== cwd), { cwd, at: Date.now() }];
    localStorage.setItem("durahub.recentCwds", JSON.stringify(next.slice(-30)));
  } catch { /* ignore */ }
}
