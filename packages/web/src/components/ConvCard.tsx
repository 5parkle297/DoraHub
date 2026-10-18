/** 会话卡片（列表项）：名称/运行徽章/时间/执行机/描述/关键词/软删除。 */
import { useState } from "react";
import { api } from "../api.ts";
import { navigate } from "../route.ts";
import { relTime } from "../util/time.ts";
import { envLabel, projectOf } from "./Sidebar.tsx";
import type { ConversationSummary } from "@dorahub/shared";

export function ConvCard({
  conv,
  style,
  active,
  onDeleted,
}: {
  conv: ConversationSummary;
  style?: React.CSSProperties;
  active?: boolean;
  onDeleted?: () => void;
}) {
  const unnamed = !conv.name;
  const [confirming, setConfirming] = useState(false);

  async function doDelete(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await api.deleteConversation(conv.id);
      setConfirming(false);
      onDeleted?.();
    } catch { /* 下次刷新重试 */ }
  }

  return (
    <div
      className={`conv-item ${active ? "active" : ""} ${conv.status === "running" ? "conv-running" : ""}`}
      style={style}
      onClick={() => navigate({ page: "conversation", id: conv.id })}
    >
      <div className="conv-item-top">
        <span className={`conv-name ${unnamed ? "unnamed" : ""}`}>
          {unnamed ? "新会话" : conv.name}
        </span>
        {conv.status === "running" && <span className="badge-running">● 运行中</span>}
        <span className="conv-time">{relTime(conv.updatedAt)}</span>
        {confirming ? (
          <>
            <button className="conv-del" onClick={doDelete}>确认删</button>
            <button className="conv-del cancel" onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>取消</button>
          </>
        ) : (
          <button
            className="conv-del"
            title="从列表移除（对话数据保留）"
            onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
          >
            ✕
          </button>
        )}
      </div>
      {(conv.envId || conv.cwd) && (
        <div className="conv-env">
          <span className="env-badge" title={conv.cwd ?? undefined}>
            {envLabel(conv.envId)}
          </span>
          {conv.cwd && <span className="env-path">{projectOf(conv.cwd).path}</span>}
        </div>
      )}
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
