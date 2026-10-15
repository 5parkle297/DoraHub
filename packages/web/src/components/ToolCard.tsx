/** 工具卡片（06 §2 自定义渲染重点）：bash/read/edit 分型 + 流式输出。 */
import { useState } from "react";
import type { ToolCardState } from "../state/conv.ts";

const STATUS_ICON: Record<string, string> = {
  preparing: "◌",
  running: "◐",
  done: "✓",
  error: "✗",
  blocked: "⊘",
};

export function ToolCard({ card }: { card: ToolCardState }) {
  const [open, setOpen] = useState(card.status === "running");

  let title = card.toolName;
  let detail = card.args;
  try {
    const args = JSON.parse(card.args || "{}");
    if (card.toolName === "bash" && args.command) {
      title = "bash";
      detail = `$ ${args.command}`;
    } else if (card.toolName === "read" && args.path) {
      title = "read";
      detail = args.path;
    } else if (card.toolName === "write" && args.path) {
      title = "write";
      detail = args.path;
    } else if (card.toolName === "edit" && args.path) {
      title = "edit";
      detail = args.path;
    }
  } catch { /* 保持原样 */ }

  const duration =
    card.durationMs != null
      ? `${(card.durationMs / 1000).toFixed(1)}s`
      : card.startedAt && card.endedAt
        ? `${((card.endedAt - card.startedAt) / 1000).toFixed(1)}s`
        : "";

  return (
    <div className={`tool-card tool-${card.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className={`tool-icon tool-icon-${card.status}`}>{STATUS_ICON[card.status] ?? "?"}</span>
        <span className="tool-name">{title}</span>
        <span className="tool-detail">{detail.slice(0, 120)}</span>
        {duration && <span className="tool-duration">{duration}</span>}
        <span className="tool-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && card.output && (
        <pre className="tool-output">{card.output}</pre>
      )}
    </div>
  );
}
