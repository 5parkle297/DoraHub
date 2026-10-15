/** 待确认卡片（US-05）：红边置顶 + 允许/拒绝。 */
import type { ConfirmationItem } from "@durahub/shared";

export function ConfirmationCard({
  item,
  onAnswer,
}: {
  item: ConfirmationItem;
  onAnswer: (id: string, approved: boolean) => void;
}) {
  let argPreview = "";
  try {
    const args = item.args as any;
    argPreview = args?.command ?? args?.path ?? JSON.stringify(args);
  } catch {
    argPreview = String(item.args);
  }
  return (
    <div className="confirm-card">
      <div className="confirm-title">⚠ agent 请求执行敏感操作</div>
      <div className="confirm-tool">{item.tool}</div>
      <pre className="confirm-args">{argPreview}</pre>
      <div className="confirm-actions">
        <button className="btn danger" onClick={() => onAnswer(item.id, false)}>拒绝</button>
        <button className="btn primary" onClick={() => onAnswer(item.id, true)}>允许</button>
      </div>
    </div>
  );
}
