/** 消息气泡 + thinking 折叠 + 工具卡片挂载（06 §2）。 */
import { useState } from "react";
import type { MessageState } from "../state/conv.ts";
import { ToolCard } from "./ToolCard.tsx";

export function MessageBubble({ msg, tools }: { msg: MessageState; tools: Map<string, any> }) {
  const [showThinking, setShowThinking] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  if (msg.role === "system") return null;

  const isUser = msg.role === "user";
  return (
    <div className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}>
      <div className="msg-label">{isUser ? "你" : "agent"}</div>
      <div className="msg-body">
        {msg.thinking && (
          <div className="thinking">
            <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
              {showThinking ? "▾" : "▸"} 思考过程
            </button>
            {showThinking && <pre className="thinking-body">{msg.thinking}</pre>}
          </div>
        )}
        {msg.text && <div className="msg-text">{msg.text}</div>}
        {msg.text.startsWith("```") && msg.text.endsWith("```") && (
          <button className="linklike" onClick={() => setShowRaw(!showRaw)}>{showRaw ? "收起" : "原文"}</button>
        )}
        {msg.streaming && <span className="cursor">▍</span>}
        {msg.toolCalls.map((tc) => (
          <ToolCard key={tc.toolCallId} card={tools.get(tc.toolCallId) ?? tc} />
        ))}
      </div>
    </div>
  );
}
