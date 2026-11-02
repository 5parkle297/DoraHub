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

/** 目录树浏览器（P1-4，对齐 Sig directory-picker 交互）：
 * - 只列目录（选工作目录时文件是噪声）；默认滤 . 隐藏目录（可开关）
 * - 快捷导航：主目录(~) / 电脑根 / 上一级（parent 由服务端返回，不算分隔符）
 * - 面包屑 home 感知：home 下显示 ~ 开头
 * - 手输跳转：输路径回车直达（浏览/手输随时切换，同一个面板）
 * - 超限 truncated 明示，不默默截断
 * 选中的目录回填到新建弹窗的路径输入框。 */
function DirBrowser({ envId, onPick, onClose }: { envId: string; onPick: (path: string) => void; onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [dirs, setDirs] = useState<BrowseResult["directories"]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [goDraft, setGoDraft] = useState("");

  async function load(p: string | null, hidden = showHidden) {
    setLoading(true);
    setError(null);
    try {
      const r = await api.browse(envId, p ?? undefined, hidden);
      setPath(r.path);
      setHome(r.home);
      setDirs(r.directories);
      setTruncated(r.truncated);
      setGoDraft(r.path);
    } catch (e: any) {
      setError(e?.message ?? "读取失败（机器离线或路径不存在）");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(null, false);
    setShowHidden(false);
  }, [envId]);

  // 面包屑（home 感知：home 下的路径显示 ~ 开头；盘符/根保留）
  const crumbs = useMemo(() => {
    if (path == null) return [];
    const sep = path.includes("\\") ? "\\" : "/";
    const underHome = home != null && (path === home || path.startsWith(home.replace(/[\\/]+$/, "") + sep) || path.startsWith(home.replace(/[\\/]+$/, "").replace(/\\/g, "/") + "/"));
    // start：home 优先（~）；否则盘符（D:\ 或 D:/）；否则 POSIX /
    const drive = path.match(/^[A-Za-z]:[\\/]?/)?.[0];
    const start = underHome ? home! : (drive ?? "/");
    const out: { label: string; path: string }[] = [{ label: underHome ? "~" : (drive ?? "/"), path: start }];
    if (path === start) return out;
    for (const part of path.slice(start.length).split(/[/\\]+/).filter(Boolean)) {
      const prev = out[out.length - 1].path;
      out.push({ label: part, path: prev.endsWith(sep) ? prev + part : prev + sep + part });
    }
    return out;
  }, [path, home]);

  // 电脑根（Windows = 盘符列表；POSIX = /）。首刷时 path 已知盘符才能算根。
  const rootPath = useMemo(() => {
    if (path == null) return null;
    if (path.startsWith("/")) return "/";
    const m = path.match(/^([A-Za-z]:)/);
    return m ? m[1] + "\\" : null;
  }, [path]);

  return (
    <div className="dir-browser">
      <div className="dir-toolbar">
        <button className="btn ghost" disabled={loading || home == null} title="主目录" onClick={() => load(home!)}>⌂ 主目录</button>
        <button className="btn ghost" disabled={loading || rootPath == null} title="电脑根（Windows 盘符列表）" onClick={() => load(rootPath!)}>▣ 电脑</button>
        <button className="btn ghost" disabled={loading || !crumbsAtLeast2(crumbs)} title="上一级" onClick={() => {
          // 上一级 = 面包屑倒数第二项；已到根则不可点
          const prev = crumbs[crumbs.length - 2];
          if (prev) load(prev.path);
        }}>↑ 上一级</button>
        <label className="dir-hidden-toggle" title="显示 . 开头的隐藏目录">
          <input type="checkbox" checked={showHidden} onChange={(e) => {
            setShowHidden(e.target.checked);
            load(path, e.target.checked);
          }} />
          隐藏目录
        </label>
        <button className="btn ghost" title="关闭浏览" onClick={onClose}>✕</button>
      </div>
      <div className="dir-crumbs">
        {path == null ? <span className="crumb">…</span> : crumbs.map((c, i) => (
          <span key={c.path} className="crumb-wrap">
            {i > 0 && <span className="crumb-sep">›</span>}
            <button className="crumb" onClick={() => load(c.path)}>{c.label}</button>
          </span>
        ))}
      </div>
      <form className="dir-go" onSubmit={(e) => { e.preventDefault(); if (goDraft.trim()) load(goDraft.trim()); }}>
        <input
          value={goDraft}
          placeholder="输入路径直接跳转…"
          onChange={(e) => setGoDraft(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        <button className="btn" disabled={loading || !goDraft.trim()}>跳转</button>
      </form>
      <div className="dir-list">
        {loading && <div className="dir-msg">读取中…</div>}
        {error && <div className="dir-msg error">{error}</div>}
        {!loading && !error && dirs.length === 0 && <div className="dir-msg">这个目录下没有子目录</div>}
        {!loading && !error && dirs.map((d) => (
          <button key={d.path} className="dir-item" onClick={() => load(d.path)} title={d.path}>
            <span className="dir-icon">▸</span> {d.name}
          </button>
        ))}
        {truncated && !loading && <div className="dir-msg">目录太多，只显示前 500 个——可以用上面的路径跳转直达</div>}
      </div>
      <div className="dir-actions">
        <span className="dir-selected" title={path ?? undefined}>当前位置：{path ?? "…"}</span>
        <button className="btn primary" disabled={path == null || loading} onClick={() => path && onPick(path)}>
          选这个目录
        </button>
      </div>
    </div>
  );
}

function crumbsAtLeast2(crumbs: { label: string; path: string }[]) {
  return crumbs.length >= 2;
}
