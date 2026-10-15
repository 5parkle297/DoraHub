/** inbox 排队区（steer/follow-up 消息排队时显示）。 */
import type { InboxItemState } from "../state/conv.ts";

export function InboxBar({ items }: { items: InboxItemState[] }) {
  if (items.length === 0) return null;
  return (
    <div className="inbox-bar">
      {items.map((i) => (
        <span key={i.id} className={`inbox-item ${i.mode === "steer" ? "inbox-steer" : ""}`}>
          {i.mode === "steer" ? "⤴ 转向排队中" : "⏳ 排队中"} · {i.id.slice(0, 6)}
        </span>
      ))}
    </div>
  );
}
