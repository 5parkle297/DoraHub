import { useEffect, useState } from "react";
import { useRoute, navigate } from "./route.ts";
import { useApp } from "./state/conn.tsx";
import { ConversationsPage } from "./pages/Conversations.tsx";
import { ConversationPage } from "./pages/Conversation.tsx";

const CONN_LABEL: Record<string, { text: string; cls: string }> = {
  connecting: { text: "连接中…", cls: "bar-connecting" },
  live: { text: "", cls: "bar-live" },
  syncing: { text: "同步中…", cls: "bar-syncing" },
  degraded: { text: "降级模式（无实时流）", cls: "bar-degraded" },
  error: { text: "连接断开，重试中…", cls: "bar-error" },
};

export function App() {
  const route = useRoute();
  const { connState } = useApp();

  // degraded 轮询兜底（05 §3）：WS 断但 HTTP 可用时 5s 拉一次列表
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (connState !== "degraded" && connState !== "error") return;
    const t = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [connState]);

  const conn = CONN_LABEL[connState];

  return (
    <div className="app">
      <div className={`connbar ${conn.cls}`}>{conn.text || "●"}</div>
      {route.page === "conversations" && <ConversationsPage />}
      {route.page === "conversation" && <ConversationPage id={route.id} />}
    </div>
  );
}
