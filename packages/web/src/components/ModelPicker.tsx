/**
 * 模型渠道选择器（会话页 ⋯ 菜单里）：渠道 → 模型 → 思考强度。
 * 对应 pi TUI 的 /model 与 shift+tab——手机上同样可操作。
 */
import { useEffect, useState } from "react";
import { api } from "../api.ts";

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
  const [channel, setChannel] = useState(current.provider ?? "zjl");
  const [model, setModel] = useState(current.modelId ?? "");
  const [thinking, setThinking] = useState<string | null>(current.thinkingLevel ?? null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.models().then(setCatalog).catch((e) => setMsg(e.message));
  }, []);

  useEffect(() => {
    setChannel(current.provider ?? "zjl");
    setModel(current.modelId ?? "");
    setThinking(current.thinkingLevel ?? null);
  }, [current.provider, current.modelId, current.thinkingLevel]);

  const channelDef = catalog.find((c) => c.id === channel);
  const modelDef = channelDef?.models.find((m) => m.id === model);

  async function apply() {
    setBusy(true);
    setMsg("");
    try {
      await api.configure(convId, {
        model: { provider: channel, modelId: model },
        ...(thinking ? { thinkingLevel: thinking } : {}),
      });
      setMsg("已切换 ✓");
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
      <button className="btn ghost" title="模型 / 思考强度" onClick={() => setOpen(true)}>
        ⚙
      </button>
    );
  }

  return (
    <div className="modal-mask" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>切换模型</h3>

        <label className="picker-label">渠道</label>
        <div className="picker-row">
          {catalog.map((c) => (
            <button
              key={c.id}
              className={`picker-chip ${c.id === channel ? "on" : ""}`}
              onClick={() => {
                setChannel(c.id);
                setModel(c.models[0]?.id ?? "");
                setThinking(null);
              }}
            >
              {c.name}
            </button>
          ))}
        </div>

        <label className="picker-label">模型</label>
        <div className="picker-row">
          {channelDef?.models.map((m) => (
            <button
              key={m.id}
              className={`picker-chip ${m.id === model ? "on" : ""}`}
              onClick={() => {
                setModel(m.id);
                setThinking(null);
              }}
            >
              {m.name}
            </button>
          ))}
        </div>

        {modelDef?.reasoning && modelDef.thinkingLevels.length > 0 && (
          <>
            <label className="picker-label">思考强度</label>
            <div className="picker-row">
              {modelDef.thinkingLevels.map((lv) => (
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
          <button className="btn primary" disabled={!model || busy} onClick={apply}>
            {busy ? "切换中…" : "应用"}
          </button>
        </div>
      </div>
    </div>
  );
}
