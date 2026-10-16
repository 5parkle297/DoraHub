/** 消息 + thinking 折叠 + 工具卡片挂载（06 §2；0.5-A 重排版：claude.ai 式全宽）。 */
import { useState } from "react";
import type { MessageState } from "../state/conv.ts";
import { ToolCard } from "./ToolCard.tsx";
import { Markdown } from "./Markdown.tsx";

export function MessageBubble({ msg, tools }: { msg: MessageState; tools: Map<string, any> }) {
  const [showThinking, setShowThinking] = useState(false);

  if (msg.role === "system") return null;

  const isUser = msg.role === "user";
  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}>
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
