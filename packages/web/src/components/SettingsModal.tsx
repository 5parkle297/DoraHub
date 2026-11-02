/**
 * 设置弹窗（UI 收敛 2026-10-18，仅桌面两栏模式的左栏入口）：
 * 收纳执行机状态 / 渠道与模型 / 关于。
 * pi 会话已移到左侧栏常驻（P0-2 #1，2026-10-19 用户拍板）。
 * 手机端无管理功能（手机 = 驾驶舱模式）。
 */
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";
import type { ExecutorInfo } from "@dorahub/shared";
import type { UsageToday } from "@dorahub/shared";

type Tab = "executors" | "channels" | "about";

const TABS: { id: Tab; label: string }[] = [
  { id: "executors", label: "执行机" },
  { id: "channels", label: "渠道与模型" },
  { id: "about", label: "关于" },
];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("executors");
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [health, setHealth] = useState<{ uptime: number; version: string } | null>(null);

  // 打开即刷新：执行机探测（秒回缓存+后台刷新）+ 健康
  useEffect(() => {
    api.executors().then(setExecutors).catch(() => {});
    api.health().then(setHealth).catch(() => {});
  }, []);

  function refreshExecutors() {
    api.executors().then(setExecutors).catch(() => {});
  }

  return (
    <Modal onClose={onClose}>
      <h3>设置</h3>
      <div className="settings-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`settings-tab ${tab === t.id ? "on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "executors" && <ExecutorsTab executors={executors} onRefresh={refreshExecutors} />}
      {tab === "channels" && <ChannelsTab />}
      {tab === "about" && <AboutTab health={health} />}
    </Modal>
  );
}

function ExecutorsTab({ executors, onRefresh }: { executors: ExecutorInfo[]; onRefresh: () => void }) {
  return (
    <div className="settings-body">
      <div className="settings-hint">
        执行机 = agent 命令实际跑的机器。离线设备可建会话，工具调用会等它上线。
      </div>
      <div className="exec-table">
        {executors.map((e) => (
          <div key={e.envId} className="exec-row">
            <span className={`exec-dot ${e.online ? "on" : ""}`} />
            <span className="exec-name">
              {e.envId === "hub" ? "☁ 云端 hub" : `🖥 ${e.envId}`}
            </span>
            <span className="exec-host">{e.host}</span>
            <span className={`exec-status ${e.online ? "" : "off"}`}>{e.online ? "在线" : "离线"}</span>
          </div>
        ))}
      </div>
      <button className="btn" onClick={onRefresh}>刷新状态</button>
    </div>
  );
}

function ChannelsTab() {
  const [catalog, setCatalog] = useState<{ id: string; name: string; models: { id: string; name: string; reasoning: boolean }[] }[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.models().then(setCatalog).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="settings-body"><div className="settings-hint">{error}</div></div>;
  if (!catalog) return <div className="settings-body"><div className="settings-hint">加载中…</div></div>;

  return (
    <div className="settings-body">
      <div className="settings-hint">会话内点 header 的模型标签即可切换（/model 式）。</div>
      {catalog.map((ch) => (
        <div key={ch.id} className="channel-block">
          <div className="channel-name">{ch.name} <span className="channel-id">({ch.id})</span></div>
          {ch.models.map((m) => (
            <div key={m.id} className="channel-model">
              <span className="model-row-ref">{ch.id}/{m.id}</span>
              <span className="model-row-name">{m.name}</span>
              {m.reasoning && <span className="model-row-tag">思考</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function AboutTab({ health }: { health: { uptime: number; version: string } | null }) {
  const up = health ? formatUptime(health.uptime) : "…";
  const usage = useUsageToday();
  return (
    <div className="settings-body">
      <div className="about-grid">
        <span className="about-key">版本</span>
        <span>{health?.version ?? "…"}</span>
        <span className="about-key">运行时长</span>
        <span>{up}</span>
        <span className="about-key">接入</span>
        <span>Tailscale 私有网络（tailnet）</span>
        <span className="about-key">今日花费（{usage?.day ?? "…"}）</span>
        <span>
          {usage == null ? "…" : (
            <>
              {usage.totals.calls} 次调用 · {fmtTokens(usage.totals.totalTokens)} tokens
              {usage.totals.costTotal > 0 && <> · ${usage.totals.costTotal.toFixed(4)}</>}
              {usage.totals.activeConvs > 0 && <> · {usage.totals.activeConvs} 个会话</>}
            </>
          )}
        </span>
      </div>
      {usage != null && Object.keys(usage.models).length > 0 && (
        <div className="usage-models">
          {Object.entries(usage.models).map(([key, m]) => (
            <div key={key} className="usage-model-row">
              <span className="usage-model-name">{key}</span>
              <span className="usage-model-meta">{m.calls} 次 · {fmtTokens(m.totalTokens)}{m.costTotal > 0 && <> · ${m.costTotal.toFixed(4)}</>}</span>
            </div>
          ))}
        </div>
      )}
      <div className="settings-hint">
        DoraHub：会话状态住在云端 VM，任何设备用浏览器接入同一个 agent 会话。
        会话数据只增不删；软删除只隐藏列表项。
      </div>
    </div>
  );
}

/** 今日花费（P1-3）：挂载时拉一次（轻量端点，不值得 WS 推） */
function useUsageToday() {
  const [usage, setUsage] = useState<UsageToday | null>(null);
  useEffect(() => {
    api.usageToday().then(setUsage).catch(() => {});
  }, []);
  return usage;
}

function fmtTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : String(n);
}

function formatUptime(ms: number): string {
  const h = Math.floor(ms / 3600_000);
  const m = Math.floor((ms % 3600_000) / 60_000);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}
