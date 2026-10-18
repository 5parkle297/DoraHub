/** 消息 + thinking 折叠 + 工具卡片挂载（框语法：流式=虚线开框，完成=框缘闭合）。 */
import { useEffect, useRef, useState } from "react";
import type { MessageState } from "../state/conv.ts";
import { ToolCard } from "./ToolCard.tsx";
import { Markdown } from "./Markdown.tsx";

/** 签名动作：流式→完成的瞬间，框缘闭合一次（dashed→solid） */
function useFrameClosed(streaming: boolean) {
  const wasStreaming = useRef(false);
  const [justClosed, setJustClosed] = useState(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming) {
      setJustClosed(true);
      const t = setTimeout(() => setJustClosed(false), 260);
      return () => clearTimeout(t);
    }
    wasStreaming.current = streaming;
  }, [streaming]);
  return justClosed;
}

export function MessageBubble({ msg, tools }: { msg: MessageState; tools: Map<string, any> }) {
  const [showThinking, setShowThinking] = useState(false);
  const justClosed = useFrameClosed(!!msg.streaming);

  if (msg.role === "system") return null;

  const isUser = msg.role === "user";
  const frameClass = !isUser && msg.streaming ? " msg-streaming" : justClosed ? " msg-just-closed" : "";
  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-assistant"}${frameClass}`}>
      <div className="msg-label">{isUser ? "你" : "agent"}</div>
      <div className="msg-body">
        {msg.thinking && !msg.streaming && (
          <div className="thinking">
            <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
              {showThinking ? "▾" : "▸"} 思考过程
            </button>
            {showThinking && <pre className="thinking-body">{msg.thinking}</pre>}
          </div>
        )}
        {msg.thinking && msg.streaming && (
          <div className="thinking">
            <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
              {showThinking ? "▾" : "▸"} 思考中…
            </button>
            {showThinking && <pre className="thinking-body">{msg.thinking}</pre>}
          </div>
        )}
        {msg.text && <Markdown text={msg.text} streaming={msg.streaming} />}
        {msg.streaming && !msg.text && !msg.thinking && !msg.toolCalls.length && (
          <span className="cursor">▍</span>
        )}
        {msg.toolCalls.map((tc) => (
          <ToolCard key={tc.toolCallId} card={tools.get(tc.toolCallId) ?? tc} />
        ))}
      </div>
    </div>
  );
}
