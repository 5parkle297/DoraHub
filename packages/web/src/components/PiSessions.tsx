/**
 * pi CLI 会话（P0-2 #1 重构，2026-10-19；#3 渐进扫描）：
 * - 侧栏常驻区（PiSidebarSection）：打开即后台自动扫描，只展示时间窗内的
 *   3 天内 / 3-7 天前，每机每档最多 3 条 + "更多"入口
 * - 渐进扫描（#3）：逐台机器上屏不等最慢者；进度条 = 完成台数/总台数
 * - 全量管理弹窗（PiFullModal）：按机器分组全量列表，含导入/删除/搬运
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { relTime } from "../util/time.ts";
import { navigate } from "../route.ts";
import { Modal } from "./Modal.tsx";
import { envColorClass } from "./Sidebar.tsx";
import type { ExecutorInfo, PiSessionInfo } from "@dorahub/shared";

const DAY_MS = 86_400_000;

/**
 * pi 扫描状态（#3 渐进式）：逐台机器独立请求，谁先回来谁先上屏；
 * 进度 = 已完成机器数 / 总机器数。失败按空处理（静默，不阻塞进度）。
 */
function usePiScan(envIds: string[]) {
  const key = envIds.join(",");
  const [perEnv, setPerEnv] = useState<Record<string, PiSessionInfo[] | null>>({});

  const scan = useCallback(
    (reset: boolean) => {
      if (reset) setPerEnv(Object.fromEntries(envIds.map((e) => [e, null])));
      for (const env of envIds) {
        api.piSessions(env)
          .then((items) => setPerEnv((m) => ({ ...m, [env]: items })))
          .catch(() => setPerEnv((m) => (m[env] == null ? { ...m, [env]: [] } : m)));
      }
    },
    [key],
  );

  useEffect(() => { scan(true); }, [scan]);

  const sessions = useMemo(() => envIds.flatMap((e) => perEnv[e] ?? []), [perEnv, key]);
  const done = envIds.filter((e) => perEnv[e] != null).length;
  const pendingNames = envIds.filter((e) => perEnv[e] == null);
  const removeSession = useCallback((env: string, file: string) => {
    setPerEnv((m) => ({ ...m, [env]: (m[env] ?? []).filter((s) => s.file !== file) }));
  }, []);

  return { sessions, done, total: envIds.length, pendingNames, scanning: done < envIds.length, scan, removeSession };
}

type ScanState = ReturnType<typeof usePiScan>;

/** 扫描进度条（#3）：细条 + mono 文案，进行中语义用结构色（ink-soft），不用状态色。 */
function ScanProgress({ done, total, names }: { done: number; total: number; names: string[] }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="pi-scan">
      <div className="pi-scan-bar"><i style={{ width: `${pct}%` }} /></div>
      <div className="pi-scan-text">
        扫描中 {done}/{total}{names.length > 0 ? ` · ${names.join("、")}…` : ""}
      </div>
    </div>
  );
}

/** 侧栏常驻 pi 会话区：自动扫描 + 时间窗（3 天 / 3-7 天，每机每档最多 3 条）。 */
export function PiSidebarSection({ executors }: { executors: ExecutorInfo[] }) {
  const [fullOpen, setFullOpen] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<PiSessionInfo | null>(null);
  /** 已导入的 pi 会话：sessionId -> durable convId */
  const [importedIds, setImportedIds] = useState<Map<string, string>>(new Map());

  const envIds = useMemo(() => executors.filter((e) => e.envId !== "hub").map((e) => e.envId), [executors]);
  const { sessions, done, total, pendingNames, scanning, scan, removeSession } = usePiScan(envIds);

  // 打开全量弹窗时静默刷新（不重置进度，已有数据不闪空）
  useEffect(() => { if (fullOpen) scan(false); }, [fullOpen, scan]);

  // 有未就绪的 meta（首次扫描后台生成中）→ 8s 轮询拉新，直到全部就绪
  const pendingMeta = sessions.some((s) => !s.metaReady);
  useEffect(() => {
    if (!pendingMeta || scanning || fullOpen) return;
    const t = setInterval(() => { if (!document.hidden) scan(false); }, 8000);
    return () => clearInterval(t);
  }, [pendingMeta, scanning, fullOpen, scan]);

  async function doImport(sess: PiSessionInfo) {
    setConfirmImport(null);
    setImporting(sess.file);
    try {
      const r = await api.piSessionImport({ sourceEnvId: sess.envId, dir: sess.dir, file: sess.file });
      setImportedIds((m) => new Map(m).set(sess.sessionId, r.convId));
      if (!r.existing) navigate({ page: "conversation", id: r.convId });
    } catch {
      setConfirmImport(sess); // 失败退回确认态，用户可重试
    } finally {
      setImporting(null);
    }
  }

  // 时间窗分组：每机每档最多 3 条
  const windows = useMemo(() => {
    const now = Date.now();
    const d3 = sessions.filter((s) => now - s.mtime < 3 * DAY_MS);
    const d7 = sessions.filter((s) => {
      const age = now - s.mtime;
      return age >= 3 * DAY_MS && age < 7 * DAY_MS;
    });
    const cap = (list: PiSessionInfo[]) => {
      const byEnv = new Map<string, PiSessionInfo[]>();
      for (const s of list) {
        const arr = byEnv.get(s.envId) ?? [];
        if (arr.length < 3) { arr.push(s); byEnv.set(s.envId, arr); }
      }
      return [...byEnv.values()].flat();
    };
    return { d3: cap(d3).sort((a, b) => b.mtime - a.mtime), d7: cap(d7).sort((a, b) => b.mtime - a.mtime) };
  }, [sessions]);

  if (envIds.length === 0) return null;

  return (
    <div className="pi-side">
      <div className="pi-side-head">
        <span>电脑上的 pi 会话</span>
        <button className="pi-side-more" onClick={() => setFullOpen(true)}>更多 →</button>
      </div>

      {scanning && <ScanProgress done={done} total={total} names={pendingNames} />}

      {windows.d3.length > 0 && (
        <div className="pi-side-group">
          <div className="pi-side-window">3 天内</div>
          {windows.d3.map((s) => (
            <PiSideItem key={`${s.envId}/${s.file}`} s={s} importing={importing === s.file}
              imported={importedIds.get(s.sessionId)} onImport={() => setConfirmImport(s)} />
          ))}
        </div>
      )}
      {windows.d7.length > 0 && (
        <div className="pi-side-group">
          <div className="pi-side-window">3-7 天前</div>
          {windows.d7.map((s) => (
            <PiSideItem key={`${s.envId}/${s.file}`} s={s} importing={importing === s.file}
              imported={importedIds.get(s.sessionId)} onImport={() => setConfirmImport(s)} />
          ))}
        </div>
      )}
      {!scanning && windows.d3.length === 0 && windows.d7.length === 0 && (
        <div className="pi-side-hint">最近 7 天没有 pi 会话</div>
      )}

      {confirmImport && (
        <Modal onClose={() => setConfirmImport(null)}>
          <h3>导入 pi 会话</h3>
          <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-dim)", lineHeight: 1.7 }}>
            把 <strong>{confirmImport.envId}</strong> 上的会话「{confirmImport.title ?? confirmImport.preview?.slice(0, 40) ?? confirmImport.sessionId.slice(0, 8)}」导入云端？
            导入后在任何设备都能接着聊。
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setConfirmImport(null)}>取消</button>
            <button className="btn primary" disabled={importing !== null} onClick={() => doImport(confirmImport)}>
              {importing ? "导入中…" : "导入"}
            </button>
          </div>
        </Modal>
      )}

      {fullOpen && (
        <PiFullModal
          executors={executors}
          scanState={{ sessions, done, total, pendingNames, scanning, scan, removeSession }}
          importedIds={importedIds}
          onImported={(sid, convId) => setImportedIds((m) => new Map(m).set(sid, convId))}
          onClose={() => setFullOpen(false)}
        />
      )}
    </div>
  );
}

/** 侧栏单条 pi 会话（紧凑行：标题 + 时间 + 快速导入）。 */
function PiSideItem({ s, importing, imported, onImport }: {
  s: PiSessionInfo; importing: boolean; imported: string | undefined; onImport: () => void;
}) {
  const title = s.title ?? s.preview?.slice(0, 30) ?? s.sessionId.slice(0, 8);
  return (
    <div className="pi-side-item">
      <div className="pi-side-item-top">
        <span className={`pi-side-env ${envColorClass(s.envId)}`}>{s.envId}</span>
        <span className={`pi-side-title ${s.metaReady ? "" : "pending"}`} title={s.cwd}>{title}</span>
        <span className="pi-side-time">{relTime(s.mtime)}</span>
      </div>
      <div className="pi-side-sub">
        <span className="pi-side-cwd">{s.cwd}</span>
        {imported ? (
          <button className="pi-side-act" onClick={() => navigate({ page: "conversation", id: imported })}>▶ 打开</button>
        ) : (
          <button className="pi-side-act" disabled={importing} onClick={onImport}>
            {importing ? "导入中…" : "⤵"}
          </button>
        )}
      </div>
    </div>
  );
}

/** 全量管理弹窗："更多 →" 入口。按机器分组全量列表，含导入/删除/搬运。 */
export function PiFullModal({ executors, scanState, importedIds, onImported, onClose }: {
  executors: ExecutorInfo[];
  scanState: ScanState;
  importedIds: Map<string, string>;
  onImported: (sid: string, convId: string) => void;
  onClose: () => void;
}) {
  const { sessions, done, total, pendingNames, scanning, removeSession } = scanState;
  const [importing, setImporting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [moving, setMoving] = useState<PiSessionInfo | null>(null);
  const [error, setError] = useState("");

  async function doImport(sess: PiSessionInfo) {
    setImporting(sess.file);
    setError("");
    try {
      const r = await api.piSessionImport({ sourceEnvId: sess.envId, dir: sess.dir, file: sess.file });
      onImported(sess.sessionId, r.convId);
      if (!r.existing) navigate({ page: "conversation", id: r.convId });
    } catch (e: any) {
      setError("导入失败：" + e.message);
    } finally {
      setImporting(null);
    }
  }

  async function doDelete(sess: PiSessionInfo) {
    if (!confirm("删除 " + (sess.title || sess.preview || sess.file.slice(0, 30)) + "？此操作不可恢复（删除源机上的 .jsonl 文件）。")) return;
    setDeleting(sess.file);
    setError("");
    try {
      await api.piSessionDelete({ envId: sess.envId, dir: sess.dir, file: sess.file });
      removeSession(sess.envId, sess.file);
    } catch (e: any) {
      setError("删除失败：" + e.message);
    } finally {
      setDeleting(null);
    }
  }

  const groups = useMemo(() => {
    const byEnv = new Map<string, PiSessionInfo[]>();
    for (const s of sessions) {
      if (!byEnv.has(s.envId)) byEnv.set(s.envId, []);
      byEnv.get(s.envId)!.push(s);
    }
    for (const list of byEnv.values()) list.sort((a, b) => b.mtime - a.mtime);
    return [...byEnv.entries()].map(([env, items]) => ({ env, items }));
  }, [sessions]);

  return (
    <Modal onClose={onClose}>
      <h3>pi 会话（全部）</h3>
      {scanning && <ScanProgress done={done} total={total} names={pendingNames} />}
      {error && <div className="pi-empty">{error}</div>}
      {!scanning && groups.length === 0 && (
        <div className="pi-empty">各台执行机上都没有 pi 会话（~/.pi/agent/sessions/ 为空）</div>
      )}
      {groups.map((g) => (
        <div key={g.env} className="pi-group">
          <div className="group-label">
            <span className={`group-name ${envColorClass(g.env)} envc-text`}>🖥 {g.env}</span>
            <span className="group-count">{g.items.length} 个 pi 会话</span>
          </div>
          {g.items.map((s) => (
            <div key={`${s.envId}/${s.file}`} className="pi-item">
              <div className="pi-item-top">
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
                <div className="pi-desc pi-pending">摘要生成中…（首次扫描后自动补全）</div>
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
      ))}
      {moving && (
        <PiMoveModal
          session={moving}
          executors={executors}
          onClose={() => setMoving(null)}
          onDone={() => setMoving(null)}
        />
      )}
    </Modal>
  );
}

function PiMoveModal({
  session,
  executors,
  onClose,
  onDone,
}: {
  session: PiSessionInfo;
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
