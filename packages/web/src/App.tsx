import { useEffect, useState } from "react";
import { useRoute, navigate, useIsWide } from "./route.ts";
import { useApp } from "./state/conn.tsx";
import { api } from "./api.ts";
import { ConversationsPage, Sidebar, envLabel, projectOf } from "./components/Sidebar.tsx";
import { ConversationPage } from "./pages/Conversation.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { LogoLockup, LogoMark } from "./components/Logo.tsx";

const CONN_LABEL: Record<string, { text: string; cls: string }> = {
  connecting: { text: "连接中…", cls: "bar-connecting" },
  live: { text: "", cls: "bar-live" },
  syncing: { text: "同步中…", cls: "bar-syncing" },
  degraded: { text: "降级模式（无实时流）", cls: "bar-degraded" },
  error: { text: "连接断开，重试中…", cls: "bar-error" },
};

export function App() {
  const route = useRoute();
  const wide = useIsWide();
  const { connState } = useApp();

  // degraded 轮询兜底（05 §3）：WS 断但 HTTP 可用时 5s 拉一次列表
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (connState !== "degraded" && connState !== "error") return;
    const t = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [connState]);

  const conn = CONN_LABEL[connState];

  // 桌面两栏：左栏常驻列表 + 右侧会话页/空态
  if (wide) {
    return (
      <div className="app">
        <div className={`connbar ${conn.cls}`}>{conn.text || "●"}</div>
        <div className="app-row">
          <aside className="sidebar">
            <SidebarHeader />
            <Sidebar />
          </aside>
          <main className="main-col">
            {route.page === "conversation" ? (
              <ConversationPage id={route.id} />
            ) : (
              <WelcomePane />
            )}
          </main>
        </div>
      </div>
    );
  }

  // 手机单栏（驾驶舱模式：无管理功能）
  return (
    <div className="app">
      <div className={`connbar ${conn.cls}`}>{conn.text || "●"}</div>
      {route.page === "conversations" && (
        <div className="page-list">
          <header className="list-header">
            <h1>
              <LogoLockup size={26} fontSize="22px" />
            </h1>
            <NewConvButton />
          </header>
          <ConversationsPage />
        </div>
      )}
      {route.page === "conversation" && <ConversationPage id={route.id} />}
    </div>
  );
}

/** 新建按钮（手机列表页）：点击前刷新执行机状态。 */
function NewConvButton() {
  return (
    <button
      className="btn primary"
      onClick={() => window.dispatchEvent(new CustomEvent("dorahub:new-conv"))}
    >
      ＋ 新会话
    </button>
  );
}

/** 左栏头部：品牌 + 设置 + 新建（桌面）。 */
function SidebarHeader() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <header className="list-header">
      <button
        className="brand-btn"
        title="回到会话列表"
        onClick={() => navigate({ page: "conversations" })}
      >
        <LogoLockup size={22} />
      </button>
      <div className="header-btns">
        <button className="btn ghost icon-btn" title="设置" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
        <button
          className="btn primary"
          onClick={() => window.dispatchEvent(new CustomEvent("dorahub:new-conv"))}
        >
          ＋ 新会话
        </button>
      </div>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}

/** 桌面右侧空态：无选中会话时的引导。 */
function WelcomePane() {
  const [convs, setConvs] = useState<{ id: string; name: string | null; cwd: string | null; envId: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const cs = await api.listConversations();
        // 最近活动的 6 个（列表已按 updatedAt 语义服务端排序不可依赖，这里自己排）
        setConvs([...cs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6));
      } catch { /* 空态不展示错误 */ } finally {
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <div className="welcome-pane">
      <div className="welcome-logo">
        <LogoMark size={52} />
        <span className="logo-word">
          Dora<span className="logo-hub">Hub</span>
        </span>
      </div>
      <div className="welcome-sub">跨设备持久化 Agent 平台</div>
      <div className="welcome-hint">从左侧选择一个会话，或点左上「＋ 新会话」</div>
      {loaded && convs.length > 0 && (
        <div className="welcome-recent">
          <div className="welcome-recent-label">最近活动</div>
          {convs.map((c) => (
            <button
              key={c.id}
              className="welcome-conv"
              onClick={() => navigate({ page: "conversation", id: c.id })}
            >
              <span className="welcome-conv-name">{c.name ?? "新会话"}</span>
              <span className="welcome-conv-env">{envLabel(c.envId)} · {projectOf(c.cwd).name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
