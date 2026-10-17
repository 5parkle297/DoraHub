/**
 * 执行机切换器 / 会话漫游向导（M4 + 2026-10-17 会话漫游 MVP）：
 * - 单纯切换：只改 envId（老行为）
 * - 同步工作区迁移：harvest 旧机文件 → hub 中转 → 写到新机 → 切 envId+cwd
 *   → 返回校准提示（父组件预填 composer，用户发送后 agent 自己 read 对齐）
 */
import { useState } from "react";
import { api } from "../api.ts";
import { envLabel } from "../pages/Conversations.tsx";
import { Modal } from "./Modal.tsx";
import type { ExecutorInfo } from "@dorahub/shared";

type Phase = "pick" | "transferring" | "done" | "error";

export function EnvSwitcher({
  convId,
  current,
  currentCwd,
  executors,
  onSwitched,
  onOpen,
  onMigrationNotice,
}: {
  convId: string;
  current: string | null;
  /** 会话当前 cwd（迁移的源路径基准） */
  currentCwd: string | null;
  executors: ExecutorInfo[];
  onSwitched?: (envId: string | null) => void;
  /** 弹窗打开时触发（父组件刷新执行机状态） */
  onOpen?: () => void;
  /** 迁移完成后收到校准提示（父组件预填 composer） */
  onMigrationNotice?: (notice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("pick");
  const [target, setTarget] = useState<string>("hub");
  const [targetCwd, setTargetCwd] = useState("");
  const [migrate, setMigrate] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ copied: number; skipped: number; oversize: string[]; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const currentLabel = envLabel(current, executors.find((e) => e.envId === current)?.host);
  const switching = current && current !== "hub";

  function reset() {
    setPhase("pick");
    setTarget("hub");
    setTargetCwd("");
    setMigrate(true);
    setError("");
    setResult(null);
  }

  async function go() {
    setBusy(true);
    setError("");
    try {
      if (!migrate) {
        // 单纯切换（不搬文件）
        await api.configure(convId, { envId: target });
        onSwitched?.(target === "hub" ? null : target);
        setOpen(false);
        reset();
        return;
      }
      if (!targetCwd.trim()) {
        setError("迁移需要目标路径（新机器上的工作目录）");
        return;
      }
      setPhase("transferring");
      const { report, notice } = await api.transfer(convId, { targetEnvId: target, targetCwd: targetCwd.trim() });
      setResult({ copied: report.copied, skipped: report.skipped, oversize: report.oversize ?? [], bytes: report.totalBytes });
      onSwitched?.(target === "hub" ? null : target);
      onMigrationNotice?.(notice);
      setPhase("done");
    } catch (e: any) {
      setError(e.message);
      setPhase("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="model-tag env-tag"
        title="会话在这台机器上执行，点击切换 / 迁移"
        onClick={() => {
          onOpen?.();
          reset();
          setOpen(true);
        }}
      >
        {currentLabel}
      </button>

      {open && (
        <Modal onClose={phase === "transferring" ? () => {} : () => { setOpen(false); reset(); }}>
          {phase === "pick" && (
            <>
              <h3>切换执行机</h3>
              <div style={{ fontSize: "var(--fs-sm)", color: "var(--text-dim)", marginBottom: 12 }}>
                当前：<strong>{currentLabel}</strong>{currentCwd ? ` · ${currentCwd}` : ""}
              </div>

              <label className="picker-label">目标机器</label>
              <div className="picker-row">
                <button
                  className={`picker-chip ${target === "hub" ? "on" : ""}`}
                  onClick={() => setTarget("hub")}
                  title="hub 云端主机（常开）"
                >
                  ☁ 云端 hub
                </button>
                {executors.filter((e) => e.envId !== "hub").map((e) => (
                  <button
                    key={e.envId}
                    className={`picker-chip ${target === e.envId ? "on" : ""} ${e.online ? "" : "chip-offline"}`}
                    onClick={() => setTarget(e.envId)}
                    title={e.online ? `${e.host} · 在线` : `${e.host} · 离线（迁移会失败，先开机）`}
                  >
                    🖥 {e.envId}<span className="chip-status">{e.online ? "" : " · 离线"}</span>
                  </button>
                ))}
              </div>

              <label className="picker-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={migrate}
                  onChange={(e) => setMigrate(e.target.checked)}
                  style={{ width: "auto" }}
                />
                同步工作区（把会话用过的文件搬到新机器，实现无缝继续）
              </label>

              {migrate && (
                <>
                  <input
                    value={targetCwd}
                    placeholder={`新机器上的工作目录（如 ${target === "hub" ? "/var/lib/dorahub/workspace/xxx" : target === "workpc" ? "D:/hobby/xxx" : "F:/group/xxx"}）`}
                    onChange={(e) => setTargetCwd(e.target.value)}
                  />
                  <div className="offline-hint">
                    迁移 = 挖出会话里 read/write/edit 过的文件 → 搬到新机（单文件 ≤50MB、总量 ≤200MB，
                    node_modules/.git 不搬）。完成后自动插入一段校准提示，发送后 agent 会先核对关键文件再继续。
                  </div>
                </>
              )}

              {!migrate && switching && (
                <div className="env-warning">
                  ⚠ 只切换不迁移：agent 记得旧机器的文件，新机器上文件可能不存在或版本不同。
                </div>
              )}

              {error && <div className="picker-msg">{error}</div>}

              <div className="modal-actions">
                <button className="btn" onClick={() => { setOpen(false); reset(); }}>取消</button>
                <button className="btn primary" disabled={busy} onClick={go}>
                  {busy ? "处理中…" : migrate ? "开始迁移" : "切换"}
                </button>
              </div>
            </>
          )}

          {phase === "transferring" && (
            <div style={{ textAlign: "center", padding: "32px 8px" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📦</div>
              <h3 style={{ margin: "0 0 8px" }}>正在同步状态…</h3>
              <div style={{ color: "var(--text-dim)", fontSize: "var(--fs-sm)" }}>
                从 {envLabel(current)} 搬运工作区文件到 {envLabel(target)}
                <br />文件多时需要一点时间（走 tailnet）
              </div>
              <div className="transfer-spin" style={{ margin: "16px auto 0" }} />
            </div>
          )}

          {phase === "done" && (
            <>
              <h3>✓ 迁移完成</h3>
              <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.7, color: "var(--text-dim)" }}>
                已同步 <strong style={{ color: "var(--green)" }}>{result?.copied} 个文件</strong>
                （{((result?.bytes ?? 0) / 1024).toFixed(0)}KB）
                {result?.skipped ? `，${result.skipped} 个读写失败` : ""}
                <br />会话现在在 {envLabel(target)} 上执行。
              </div>
              {result && result.oversize.length > 0 && (
                <div className="env-warning" style={{ marginTop: 8 }}>
                  ⚠ {result.oversize.length} 个文件超出大小上限未同步：
                  <div style={{ marginTop: 4, fontSize: "var(--fs-xs)", wordBreak: "break-all" }}>
                    {result.oversize.slice(0, 8).join("、")}{result.oversize.length > 8 ? " 等" : ""}
                  </div>
                  需要的话请手动搬运（scp/网盘/git），校准提示里已告知 agent。
                </div>
              )}
              <div className="offline-hint">
                校准提示已填入输入框——发送它，agent 会先核对关键文件再继续任务。
              </div>
              <div className="modal-actions">
                <button className="btn primary" onClick={() => { setOpen(false); reset(); }}>完成</button>
              </div>
            </>
          )}

          {phase === "error" && (
            <>
              <h3>迁移失败</h3>
              <div className="picker-msg">{error}</div>
              <div className="offline-hint">会话未受影响，仍留在 {currentLabel}。</div>
              <div className="modal-actions">
                <button className="btn" onClick={() => setPhase("pick")}>返回重试</button>
                <button className="btn" onClick={() => { setOpen(false); reset(); }}>关闭</button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
