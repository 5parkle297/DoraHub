/**
 * 模型选择器（pi /model 式，用户反馈 2026-10-16）：
 * 一个平铺的「供应商:模型」单列表，当前模型高亮，点选即切；
 * 思考强度只在所选模型支持时显示为第二行附加项。
 * 不再是"渠道→模型→强度"三级 chips。
 */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api.ts";
import { Modal } from "./Modal.tsx";

interface CatalogModel {
  id: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: string[];
}

interface CatalogChannel {
  id: string;
  name: string;
  models: CatalogModel[];
}

const THINKING_LABEL: Record<string, string> = {
  off: "关",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};

/** pi 风格的显示名：provider/model（pi /model 列表的行格式） */
function modelRef(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

export function ModelPicker({
  convId,
  current,
  onConfigured,
}: {
  convId: string;
  /** 当前 "provider:modelId" + thinkingLevel（从会话 agent 快照来） */
  current: { provider?: string; modelId?: string; thinkingLevel?: string | null };
  onConfigured?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogChannel[]>([]);
  const [sel, setSel] = useState<string>(""); // "provider:modelId"
  const [thinking, setThinking] = useState<string | null>(current.thinkingLevel ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.models().then(setCatalog).catch((e) => setMsg(e.message));
  }, []);

  useEffect(() => {
    if (current.provider && current.modelId) {
      setSel(`${current.provider}:${current.modelId}`);
    }
    setThinking(current.thinkingLevel ?? null);
  }, [current.provider, current.modelId, current.thinkingLevel]);

  // 平铺列表：pi /model 风格一行一个 provider/model
  const rows = useMemo(() => {
    const list: { provider: string; providerName: string; model: CatalogModel }[] = [];
    for (const ch of catalog) {
      for (const m of ch.models) {
        list.push({ provider: ch.id, providerName: ch.name, model: m });
      }
    }
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter((r) => modelRef(r.provider, r.model.id).toLowerCase().includes(q))
      : list;
    // 当前选中置顶，其余保持目录顺序
    return filtered.sort((a, b) => {
      const aSel = `${a.provider}:${a.model.id}` === sel ? -1 : 0;
      const bSel = `${b.provider}:${b.model.id}` === sel ? -1 : 0;
      return aSel - bSel;
    });
  }, [catalog, query, sel]);

  const selRow = rows.find((r) => `${r.provider}:${r.model.id}` === sel) ??
    rows.find((r) => `${r.provider}:${r.model.id}` === `${current.provider}:${current.modelId}`);

  async function apply() {
    if (!sel) return;
    setBusy(true);
    setMsg("");
    try {
      const [provider, modelId] = sel.split(":");
      await api.configure(convId, {
        model: { provider, modelId },
        ...(thinking ? { thinkingLevel: thinking } : {}),
      });
      setOpen(false);
      onConfigured?.();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn ghost" title="模型（/model）" onClick={() => setOpen(true)}>
        ⚙
      </button>
    );
  }

  return (
    <Modal onClose={() => setOpen(false)}>
      <h3>模型</h3>

      <input
        className="model-search"
        autoFocus
        value={query}
        placeholder="搜索 provider/model…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            // Enter = 选第一个可见项
            if (rows[0]) setSel(`${rows[0].provider}:${rows[0].model.id}`);
          }
        }}
      />

      <div className="model-list">
        {rows.map((r) => {
          const ref = `${r.provider}:${r.model.id}`;
          const isSel = ref === sel;
          return (
            <button
              key={ref}
              className={`model-row ${isSel ? "on" : ""}`}
              onClick={() => {
                setSel(ref);
                setThinking(null);
              }}
            >
              <span className="model-row-ref">{modelRef(r.provider, r.model.id)}</span>
              <span className="model-row-name">{r.model.name}</span>
              {r.model.reasoning && <span className="model-row-tag">思考</span>}
              {isSel && <span className="model-row-check">✓</span>}
            </button>
          );
        })}
        {rows.length === 0 && (
          <div style={{ color: "var(--text-faint)", fontSize: "var(--fs-sm)", padding: 12 }}>
            没有匹配的模型
          </div>
        )}
      </div>

      {selRow?.model.reasoning && selRow.model.thinkingLevels.length > 0 && (
        <>
          <label className="picker-label">思考强度 · {modelRef(selRow.provider, selRow.model.id)}</label>
          <div className="picker-row">
            {selRow.model.thinkingLevels.map((lv) => (
              <button
                key={lv}
                className={`picker-chip ${lv === (thinking ?? "medium") ? "on" : ""}`}
                onClick={() => setThinking(lv)}
              >
                {THINKING_LABEL[lv] ?? lv}
              </button>
            ))}
          </div>
        </>
      )}

      {msg && <div className="picker-msg">{msg}</div>}

      <div className="modal-actions">
        <button className="btn" onClick={() => setOpen(false)}>取消</button>
        <button className="btn primary" disabled={!sel || busy} onClick={apply}>
          {busy ? "切换中…" : "应用"}
        </button>
      </div>
    </Modal>
  );
}
