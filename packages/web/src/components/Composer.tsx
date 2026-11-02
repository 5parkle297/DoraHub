/** 输入区（06 §2）：普通发送 / steer 开关 / 自动增高。
 * draft：外部预填（工作区迁移后的校准提示）——用户可改可发，发送后 onDraftConsumed 清空。
 * P1-5 发送失败重试：失败时文本保留 + 行内错误条（重试/放弃），不再只靠顶部一闪而过的 error。 */
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
  const [failed, setFailed] = useState<string | null>(null); // 失败保留的原文（重试用）
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

  async function send() {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t, steer ? "steer" : "input");
      setText("");
      setFailed(null);
      onDraftConsumed?.();
      requestAnimationFrame(autoGrow);
    } catch {
      // P1-5：失败不丢文本——保留在输入框，错误条给重试入口。
      // （具体错误信息顶部 error 条已有，这里只留动作。）
      setFailed(t);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="composer-wrap">
      {failed != null && (
        <div className="send-failed-bar" role="alert">
          <span>没发出去（网络或服务端问题）</span>
          <span className="send-failed-actions">
            <button className="btn ghost sm" onClick={send} disabled={sending}>重试</button>
            <button className="btn ghost sm" onClick={() => setFailed(null)} disabled={sending}>知道了</button>
          </span>
        </div>
      )}
      <div className={`composer ${steer ? "composer-steer" : ""} ${failed != null ? "composer-failed" : ""}`}>
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
          {sending ? "发送中…" : failed != null ? "再试" : "发送"}
        </button>
      </div>
    </div>
  );
}
