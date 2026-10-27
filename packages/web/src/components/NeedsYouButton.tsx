/**
 * 「等你处理」聚合入口（P0-2，对齐参考项目 Sig 的 Needs you）：
 * 所有会话的未处理确认卡一个入口——不用逐会话翻。
 *
 * - 徽章：amber 数字，实时更新（attention WS 帧，不依赖 attach）
 * - 点击：弹出聚合列表（每条 = 会话名 + 待处理数 + 跳转）
 * - portal 到 body（坑清单 #1：conv-header 有 backdrop-filter）
 */
import { createPortal } from "react-dom";
import { useState } from "react";
import { useAttention } from "../state/attention.ts";
import { navigate } from "../route.ts";
import type { ConversationSummary } from "@dorahub/shared";

export function NeedsYouButton({ convs }: { convs: ConversationSummary[] }) {
  const attention = useAttention();
  const [open, setOpen] = useState(false);

  if (attention.total === 0 && !open) return null;

  // 聚合列表：attention 里有数的会话 + 列表元数据（名字/执行机）
  const items = [...attention.byConv.entries()]
    .map(([id, n]) => ({ conv: convs.find((c) => c.id === id) ?? null, id, n }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  return (
    <>
      <button
        className={`needs-you-btn ${attention.total > 0 ? "has-items" : ""}`}
        title="等你处理的确认请求"
        aria-label={`等你处理 ${attention.total} 项`}
        onClick={() => setOpen((v) => !v)}
      >
        ◆ 等你
        {attention.total > 0 && <span className="needs-you-count">{attention.total}</span>}
      </button>
      {open && createPortal(
        <>
          <div className="menu-mask" onClick={() => setOpen(false)} />
          <div className="needs-you-pop">
            <div className="needs-you-head">等你处理{attention.total > 0 ? `（${attention.total}）` : ""}</div>
            {items.length === 0 && <div className="needs-you-empty">现在没有等你决定的事。</div>}
            {items.map(({ conv, id, n }) => (
              <button
                key={id}
                className="needs-you-item"
                onClick={() => {
                  setOpen(false);
                  navigate({ page: "conversation", id });
                }}
              >
                <span className="needs-you-item-name">{conv?.name || "新会话"}</span>
                <span className="needs-you-item-meta">
                  {conv?.envId ? `${conv.envId} · ` : ""}等你 ×{n}
                </span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
