/**
 * pi CLI 会话区（列表页底部，2026-10-17）：
 * 列出各执行机上 ~/.pi/agent/sessions/ 的本地 pi 会话，
 * 可按需搬运到另一台机器（落盘即 /resume 可见，无需 pi 插件——
 * pi 的会话就是 jsonl 文件，同构搬运）。
 */
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { relTime } from "../util/time.ts";
import { navigate } from "../route.ts";
import { Modal } from "./Modal.tsx";
import type { ExecutorInfo } from "@dorahub/shared";

interface PiSession {
  envId: string;
  file: string;
  dir: string;
  sessionId: string;
  cwd: string;
  mtime: number;
  preview: string;
  size: number;
  title: string | null;
  description: string | null;
  keywords: string[];
  metaReady: boolean;
}

export function PiSessionsSection({ executors }: { executors: ExecutorInfo[] }) {
  const [sessions, setSessions] = useState<PiSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState<PiSession | null>(null);

  // 导入 / 删除状态
  const [importing, setImporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** 已导入的 pi 会话：sessionId -> durable convId */
  const [importedIds, setImportedIds] = useState<Map<string, string>>(new Map());

  async function doImport(sess: PiSession) {
    setImporting(sess.file);
    setError("");
    try {
      const r = await api.piSessionImport({ sourceEnvId: sess.envId, dir: sess.dir, file: sess.file });
      setImportedIds((m) => new Map(m).set(sess.sessionId, r.convId));
      if (!r.existing) {
        navigate({ page: "conversation", id: r.convId });
      }
    } catch (e: any) {
      setError("导入失败：" + e.message);
    } finally {
      setImporting(null);
    }
  }

  async function doDelete(sess: PiSession) {
    if (!confirm("删除 " + (sess.title || sess.preview || sess.file.slice(0, 30)) + "？此操作不可恢复（删除源机上的 .jsonl 文件）。")) return;
    setDeleting(sess.file);
    setError("");
    try {
      await api.piSessionDelete({ envId: sess.envId, dir: sess.dir, file: sess.file });
      await load();
    } catch (e: any) {
      setError("删除失败：" + e.message);
    } finally {
      setDeleting(null);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const results = await Promise.all(
        executors.filter((e) => e.envId !== "hub").map((e) => api.piSessions(e.envId).catch(() => [])),
      );
      setSessions(results.flat());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  // 有未就绪的 meta（首次扫描后台生成中）→ 8s 轮询拉新，直到全部就绪
  useEffect(() => {
    if (!open || loading) return;
    const pendingMeta = sessions.some((s) => !s.metaReady);
    if (!pendingMeta) return;
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 8000);
    return () => clearInterval(t);
  }, [open, loading, sessions]);

  return (
    <div className="pi-sessions">
      <button className="pi-toggle" onClick={() => setOpen(!open)}>
        <span>⌨ 本机 pi 会话</span>
        <span className="pi-count">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="pi-list">
          {loading && <div className="pi-empty">扫描中…</div>}
          {error && <div className="pi-empty">{error}</div>}
          {!loading && !error && sessions.length === 0 && (
            <div className="pi-empty">两台电脑上都没有 pi 会话（~/.pi/agent/sessions/ 为空）</div>
          )}
          {sessions.map((s) => (
            <div key={`${s.envId}/${s.file}`} className="pi-item">
              <div className="pi-item-top">
                <span className="pi-env">{s.envId}</span>
                <span className={`pi-title ${s.metaReady ? "" : "pi-pending"}`}>
                  {s.title ?? s.preview?.slice(0, 40) ?? s.sessionId.slice(0, 8)}
                </span>
                <span className="pi-time">{relTime(s.mtime)}</span>
              </div>
              {s.metaReady ? (
                <>
                  {s.description && <div className="pi-desc">{s.description}</div>}
                  {s.keywords.length > 0 && (
                    <div className="conv-keywords">
                      {s.keywords.map((k, i) => (
                        <span key={i} className="kw-chip">{k}</span>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="pi-desc pi-pending">摘要生成中…（首次扫描后自动补全，稍后自动刷新）</div>
              )}
              <div className="pi-meta">
                {s.cwd} · {(s.size / 1024).toFixed(0)}KB
                <span className="pi-actions">
                  {importedIds.has(s.sessionId) ? (
                    <button className="pi-move" onClick={() => navigate({ page: "conversation", id: importedIds.get(s.sessionId)! })}>▶ 打开</button>
                  ) : (
                    <button className="pi-move" disabled={importing === s.file} onClick={() => doImport(s)}>
                      {importing === s.file ? "导入中…" : "⤵ 导入对话"}
                    </button>
                  )}
                  <button className="pi-move danger" disabled={deleting === s.file} onClick={() => doDelete(s)}>
                    {deleting === s.file ? "删除中" : "✕ 删除"}
                  </button>
                  <button className="pi-move" onClick={() => setMoving(s)}>→ 搬运</button>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {moving && (
        <PiMoveModal
          session={moving}
          executors={executors}
          onClose={() => setMoving(null)}
          onDone={() => { setMoving(null); load(); }}
        />
      )}
    </div>
  );
}

function PiMoveModal({
  session,
  executors,
  onClose,
  onDone,
}: {
  session: PiSession;
  executors: ExecutorInfo[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<string>("");
  const [targetCwd, setTargetCwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ targetFile: string; bytes: number } | null>(null);

  const others = executors.filter((e) => e.envId !== session.envId && e.envId !== "hub");

  async function go() {
    setBusy(true);
    setError("");
    try {
      const r = await api.piSessionTransfer({
        sourceEnvId: session.envId,
        file: session.file,
        dir: session.dir,
        targetEnvId: target,
        targetCwd: targetCwd.trim(),
      });
      setDone(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={busy ? () => {} : done ? onDone : onClose}>
      {done ? (
        <>
          <h3>✓ 搬运完成</h3>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-dim)", lineHeight: 1.7, wordBreak: "break-all" }}>
            会话已落到 <strong>{target}</strong>：
            <code>{done.targetFile}</code>（{(done.bytes / 1024).toFixed(0)}KB）
          </div>
          <div className="offline-hint">
            在那台电脑的项目目录下运行 <code>pi</code> → <code>/resume</code> 就能看到它。
            注意：会话记忆会完整可用，但它引用的项目文件不会跟过去（和 DoraHub 跨机迁移同一个道理）。
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={onDone}>完成</button>
          </div>
        </>
      ) : (
        <>
          <h3>搬运 pi 会话</h3>
          <div className="pi-meta" style={{ marginBottom: 12 }}>
            来自 {session.envId} · {session.cwd}
          </div>

          <label className="picker-label">搬到哪台机器</label>
          <div className="picker-row">
            {others.length === 0 && (
              <div className="offline-hint">没有其他已注册的执行机</div>
            )}
            {others.map((e) => (
              <button
                key={e.envId}
                className={`picker-chip ${target === e.envId ? "on" : ""} ${e.online ? "" : "chip-offline"}`}
                onClick={() => setTarget(e.envId)}
                title={e.online ? `${e.host} · 在线` : `${e.host} · 离线（先开机）`}
              >
                🖥 {e.envId}<span className="chip-status">{e.online ? "" : " · 离线"}</span>
              </button>
            ))}
          </div>

          {target && (
            <>
              <label className="picker-label">目标项目路径（决定它出现在哪个目录的 /resume 里）</label>
              <input
                value={targetCwd}
                placeholder={target === "workpc" ? "如 D:/hobby/xxx" : `如 ${target} 上的路径`}
                onChange={(e) => setTargetCwd(e.target.value)}
              />
              <div className="offline-hint">
                源路径 {session.cwd} 不会被自动映射——填目标机器上实际存在的项目路径。
              </div>
            </>
          )}

          {error && <div className="picker-msg">{error}</div>}

          <div className="modal-actions">
            <button className="btn" onClick={onClose}>取消</button>
            <button className="btn primary" disabled={!target || !targetCwd.trim() || busy} onClick={go}>
              {busy ? "搬运中…" : "搬运"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
