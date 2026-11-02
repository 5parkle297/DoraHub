/** inbox 排队区（steer/follow-up 消息排队时显示）。
 * 文案用自然语言（对齐 Sig：用户不需要 submission id 这种黑话）。 */
import type { InboxItemState } from "../state/conv.ts";

export function InboxBar({ items }: { items: InboxItemState[] }) {
  if (items.length === 0) return null;
  const steers = items.filter((i) => i.mode === "steer").length;
  const follows = items.length - steers;
  const parts: string[] = [];
  if (follows > 0) parts.push(`${follows > 1 ? `${follows} 条新消息` : "新消息"}会在本轮结束后处理`);
  if (steers > 0) parts.push(`${steers > 1 ? `${steers} 条插话` : "插话"}会在当前工具后生效`);
  return (
    <div className="inbox-bar" title={items.map((i) => `${i.mode === "steer" ? "steer" : "follow-up"} · ${i.id.slice(0, 8)}`).join("\n")}>
      <span className="inbox-item">{parts.join("；")}</span>
    </div>
  );
}
