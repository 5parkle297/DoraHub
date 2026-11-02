/** 新建会话弹窗：选执行机 + 项目文件夹，不命名（0.5-B + M4）。
 * P1-4：路径可选 browsing——面包屑 + 目录列表点选（手机上手辑 Windows 路径不现实）。 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { envLabel, projectOf } from "./Sidebar.tsx";
import { Modal } from "./Modal.tsx";
import type { ExecutorInfo, BrowseResult } from "@dorahub/shared";

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
  const [browsing, setBrowsing] = useState(false);

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

  // 两步确认（P0-1 问题 A）：点"最近项目"只选中填入，统一走底部"创建"，
  // 防触屏误点直接连建空会话。
  function pick(cwd: string) {
    setCustom(cwd);
  }

  function create() {
    const cwd = custom.trim();
    if (cwd) rememberCwd(cwd, envId);
    onCreate(cwd ? { cwd, envId } : { envId });
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
          <button key={cwd} className={`cwd-option ${custom === cwd ? "on" : ""}`} onClick={() => pick(cwd)}>
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
            if (e.key === "Enter") create();
          }}
        />
        <button
          className={`btn ${browsing ? "menu-open" : ""}`}
          title="浏览这台机器的文件夹"
          onClick={() => setBrowsing((v) => !v)}
        >
          浏览
        </button>
      </div>
      {browsing && (
        <DirBrowser
          envId={envId}
          onPick={(p) => {
            setCustom(p);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
      <div className="modal-actions">
        <button className="btn" onClick={() => setCustom("")}>清空所选</button>
        <button className="btn primary" onClick={create}>
          {custom.trim() ? `在 ${projectOf(custom.trim()).name} 创建` : "创建会话"}
        </button>
      </div>
      <div className="offline-hint">点选或输入路径后点"创建"；不选路径直接创建也行——发消息前它不会出现在列表里。</div>
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

/** 目录浏览器（P1-4）：面包屑 + 列表点选，选中的目录回填到路径输入框。 */
function DirBrowser({ envId, onPick, onClose }: { envId: string; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null); // null = 还没加载（首次拉默认 cwd）
  const [items, setItems] = useState<BrowseResult["items"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(p: string | null) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.browse(envId, p);
      setPath(r.path);
      setItems(r.items);
    } catch (e: any) {
      setError(e?.message ?? "读取失败（机器离线或路径不存在）");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(null);
  }, [envId]); // 切机器重新从默认 cwd 开始

  // 面包屑：把路径拆成可点段（Windows D:\hobby\x 与 POSIX /var/lib 都适用）
  const crumbs = useMemo(() => {
    if (path == null) return [];
    const sep = path.includes("\\") ? "\\" : "/"; // 源码里 "\\" = 一个反斜杠
    const parts = path.split(/[/\\]+/).filter(Boolean);
    const out: { label: string; path: string }[] = [];
    let acc = "";
    for (const part of parts) {
      acc = acc ? acc + sep + part : (sep === "/" ? "/" + part : part);
      out.push({ label: part, path: acc });
    }
    return out;
  }, [path]);

  function goUp() {
    if (path == null) return;
    const sep = path.includes("\\") ? "\\" : "/";
    const parts = path.split(/[/\\]+/).filter(Boolean);
    if (parts.length <= 1) {
      load(sep === "/" ? "/" : parts[0] + ":\\");
      return;
    }
    parts.pop();
    let up = parts.join(sep);
    if (sep === "/") up = "/" + up;
    else if (parts.length === 1 && parts[0].endsWith(":")) up = parts[0] + ":\\";
    load(up);
  }

  return (
    <div className="dir-browser">
      <div className="dir-crumbs">
        <button className="btn ghost" title="上一级" onClick={goUp} disabled={loading}>↑</button>
        <div className="crumb-path">
          {path == null ? <span className="crumb">…</span> : (
            <>
              {crumbs.map((c, i) => (
                <span key={c.path} className="crumb-wrap">
                  {i > 0 && <span className="crumb-sep">/</span>}
                  <button className="crumb" onClick={() => load(c.path)}>{c.label}</button>
                </span>
              ))}
            </>
          )}
        </div>
        <button className="btn ghost" title="关闭浏览" onClick={onClose}>✕</button>
      </div>
      <div className="dir-list">
        {loading && <div className="dir-msg">读取中…</div>}
        {error && <div className="dir-msg error">{error}</div>}
        {!loading && !error && items.length === 0 && <div className="dir-msg">这个文件夹是空的</div>}
        {!loading && !error && items.map((f) => (
          f.kind === "directory" ? (
            <button key={f.name} className="dir-item" onClick={() => load(path == null ? f.name : joinPath(path, f.name))}>
              <span className="dir-icon">▸</span> {f.name}
            </button>
          ) : (
            <div key={f.name} className="dir-item file" title={f.size != null ? `${f.size} 字节` : undefined}>
              <span className="dir-icon">·</span> {f.name}
            </div>
          )
        ))}
      </div>
      <div className="dir-actions">
        <button className="btn primary" disabled={path == null} onClick={() => path && onPick(path)}>
          选这个文件夹
        </button>
      </div>
    </div>
  );
}

function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return base.endsWith(sep) ? base + name : base + sep + name;
}
