/** 工具卡片：bash/read/edit 分型 + 流式输出 + edit 的 diff 视图（0.5/§5）。 */
import { useMemo, useState } from "react";
import type { ToolCardState } from "../state/conv.ts";

const STATUS_ICON: Record<string, string> = {
  preparing: "◌",
  running: "◐",
  done: "✓",
  error: "✗",
  blocked: "⊘",
};

/** edit 工具 → 前后内容 diff（行级 LCS，规模小够用）。 */
function DiffView({ oldText, newText }: { oldText: string; newText: string }) {
  const rows = useMemo(() => diffLines(oldText.split("\n"), newText.split("\n")), [oldText, newText]);
  return (
    <div className="tool-diff">
      <table className="diff-table">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="diff-ln">{r.ln || ""}</td>
              <td className={r.cls}>{r.text || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface DiffRow { ln: number; cls: string; text: string }

/** 行级 diff：LCS 太重就退化为朴素（前缀/后缀裁剪 + 中段全标记）。 */
function diffLines(a: string[], b: string[]): DiffRow[] {
  // 公共前缀
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  // 公共后缀
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const rows: DiffRow[] = [];
  let ln = 1;
  for (let i = 0; i < start; i++) rows.push({ ln: ln++, cls: "", text: a[i] });
  for (let i = start; i < endA; i++) rows.push({ ln: 0, cls: "diff-del", text: a[i] });
  for (let i = start; i < endB; i++) rows.push({ ln: 0, cls: "diff-add", text: b[i] });
  for (let i = endA; i < a.length; i++) rows.push({ ln: ln++, cls: "", text: a[i] });
  return rows;
}

export function ToolCard({ card }: { card: ToolCardState }) {
  const [open, setOpen] = useState(card.status === "running");

  let title = card.toolName;
  let detail = card.args;
  let args: any = {};
  try {
    args = JSON.parse(card.args || "{}");
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

  // edit 工具：有 oldText/newText（或 content 结构）时显示 diff
  const isEdit = card.toolName === "edit";
  const hasDiff = isEdit && (args.oldText != null || args.newText != null);

  return (
    <div className={`tool-card tool-${card.status}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className={`tool-icon tool-icon-${card.status}`}>{STATUS_ICON[card.status] ?? "?"}</span>
        <span className="tool-name">{title}</span>
        <span className="tool-detail">{detail.slice(0, 140)}</span>
        {duration && <span className="tool-duration">{duration}</span>}
        <span className="tool-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && hasDiff && <DiffView oldText={String(args.oldText ?? "")} newText={String(args.newText ?? "")} />}
      {open && !hasDiff && card.output && <pre className="tool-output">{card.output}</pre>}
    </div>
  );
}
