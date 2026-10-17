/** 输入区（06 §2）：普通发送 / steer 开关 / 自动增高。
 * draft：外部预填（工作区迁移后的校准提示）——用户可改可发，发送后 onDraftConsumed 清空。 */
import { useEffect, useRef, useState } from "react";

export function Composer({
  disabled,
  draft,
  onDraftConsumed,
  onSend,
}: {
  disabled: boolean;
  draft?: string;
  onDraftConsumed?: () => void;
  onSend: (text: string, mode: "input" | "steer") => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [steer, setSteer] = useState(false);
  const [sending, setSending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 外部 draft 到达 → 预填并聚焦（迁移完成后引导用户发送校准提示）
  useEffect(() => {
    if (draft) {
      setText(draft);
      taRef.current?.focus();
      requestAnimationFrame(() => {
        const el = taRef.current;
        if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }
      });
    }
  }, [draft]);

  // 移动端虚拟键盘适配：viewport meta 的 interactive-widget=resizes-content
  // （index.html，Android Chrome 108+ 原生把键盘算进视口高度）；iOS Safari 自行处理 fixed 底栏

  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  function autoGrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t, steer ? "steer" : "input");
      setText("");
      onDraftConsumed?.();
      requestAnimationFrame(autoGrow);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer-wrap">
      <div className={`composer ${steer ? "composer-steer" : ""}`}>
        <button
          className={`steer-toggle ${steer ? "on" : ""}`}
          title={steer ? "steer 模式：插入当前工具轮之后" : "普通模式：排队到本轮结束后"}
          onClick={() => setSteer(!steer)}
        >
          {steer ? "⤴ steer 开" : "steer"}
        </button>
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder={steer ? "插一句话，改变 agent 正在做的事…" : "发消息…"}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary send-btn" disabled={disabled || !text.trim() || sending} onClick={send}>
          {sending ? "…" : "发送"}
        </button>
      </div>
    </div>
  );
}
