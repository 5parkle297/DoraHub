/** 会话列表页（06 §2）。 */
import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";
import { navigate } from "../route.ts";
import type { ConversationSummary } from "@dorahub/shared";

export function ConversationsPage() {
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
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
        }
      },
    });
    return unsub;
  }, []);

  async function create() {
    if (!name.trim()) return;
    try {
      const { id } = await api.createConversation({ name: name.trim() });
      setName("");
      setCreating(false);
      navigate({ page: "conversation", id });
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="page-list">
      <header className="list-header">
        <h1>DoraHub</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>＋ 新会话</button>
      </header>
      {error && <div className="error-banner">{error}</div>}
      {creating && (
        <div className="modal-mask" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>新建会话</h3>
            <input
              autoFocus
              value={name}
              placeholder="会话名称（如：重构调研）"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setCreating(false)}>取消</button>
              <button className="btn primary" onClick={create} disabled={!name.trim()}>创建</button>
            </div>
          </div>
        </div>
      )}
      <div className="conv-list">
        {convs.length === 0 && <div className="empty">还没有会话。创建一个，任何设备都能接着聊。</div>}
        {[...convs].reverse().map((c) => (
          <div key={c.id} className="conv-item" onClick={() => navigate({ page: "conversation", id: c.id })}>
            <div className="conv-item-top">
              <span className="conv-name">{c.name || `会话 ${c.id}`}</span>
              {c.status === "running" && <span className="badge-running" title="运行中">▶</span>}
            </div>
            <div className="conv-preview">{c.lastPreview || "（空）"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
