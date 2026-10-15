/** 输入区（06 §2）：普通发送 / steer 开关 / abort。 */
import { useState } from "react";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string, mode: "input" | "steer") => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [steer, setSteer] = useState(false);
  const [sending, setSending] = useState(false);

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t, steer ? "steer" : "input");
      setText("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={`composer ${steer ? "composer-steer" : ""}`}>
      <button
        className={`steer-toggle ${steer ? "on" : ""}`}
        title={steer ? "steer 模式：插入当前工具轮之后" : "普通模式：排队到本轮结束后"}
        onClick={() => setSteer(!steer)}
      >
        ▶ steer
      </button>
      <textarea
        value={text}
        rows={1}
        placeholder={steer ? "插一句话，改变 agent 正在做的事…" : "发消息…"}
        onChange={(e) => setText(e.target.value)}
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
  );
}
