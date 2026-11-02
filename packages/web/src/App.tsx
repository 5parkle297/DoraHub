import { useEffect, useState } from "react";
import { useRoute, navigate, useIsWide } from "./route.ts";
import { useApp } from "./state/conn.tsx";
import { api } from "./api.ts";
import { wsClient } from "./ws.ts";
import { ConversationsPage, Sidebar, envLabel, envColorClass, projectOf } from "./components/Sidebar.tsx";
import { ConversationPage } from "./pages/Conversation.tsx";
import { SettingsModal } from "./components/SettingsModal.tsx";
import { NeedsYouButton } from "./components/NeedsYouButton.tsx";
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

  // 手机单栏（驾驶舱模式：管理功能收敛，但「等你处理」聚合是只读+跳转，属例外——
  // 手机上确认卡埋在会话里要挨个翻，聚合入口是刚需（P0-2/P0-4））
  return (
    <div className="app">
      <div className={`connbar ${conn.cls}`}>{conn.text || "●"}</div>
      {route.page === "conversations" && (
        <div className="page-list">
          <header className="list-header">
            <h1>
              <LogoLockup size={26} fontSize="22px" />
            </h1>
            <MobileHeaderExtras />
          </header>
          <ConversationsPage />
        </div>
      )}
      {route.page === "conversation" && <ConversationPage id={route.id} />}
    </div>
  );
}

/** 手机列表页 header 右侧：等你处理入口 + 执行机状态（P0-4 手机等价第一刀）。 */
function MobileHeaderExtras() {
  const [convs, setConvs] = useState<import("@dorahub/shared").ConversationSummary[]>([]);
  const [machines, setMachines] = useState<{ online: number; total: number } | null>(null);
  useEffect(() => {
    api.listConversations().then(setConvs).catch(() => {});
    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "attention") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, pendingConfirms: f.pending } : c)));
        } else if (f.t === "conv_meta") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, name: f.name } : c)));
        }
      },
    });
    return unsub;
  }, []);
  useEffect(() => {
    const tick = () => api.executors().then((es) => {
      setMachines({ online: es.filter((e) => e.online).length, total: es.length });
    }).catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <NeedsYouButton convs={convs} />
      {machines && machines.online < machines.total && (
        <span className="machines-badge warn" title={`${machines.online}/${machines.total} 台执行机在线`}>
          ▷ {machines.online}/{machines.total}
        </span>
      )}
      {/* 新建是驾驶动作不是管理动作——手机等价（IA 补口，用户 11-02 拍板「一并精进」） */}
      <button
        className="btn primary mobile-new-btn"
        title="新建会话"
        onClick={() => window.dispatchEvent(new CustomEvent("dorahub:new-conv"))}
      >
        ＋
      </button>
    </>
  );
}

/** 左栏头部：品牌 + 等你处理 + 执行机状态 + 设置 + 新建（桌面）。 */
function SidebarHeader() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [convs, setConvs] = useState<import("@dorahub/shared").ConversationSummary[]>([]);
  const [machines, setMachines] = useState<{ online: number; total: number } | null>(null);
  useEffect(() => {
    api.listConversations().then(setConvs).catch(() => {});
    // 执行机全局可见（对齐 Sig 顶栏 Machines N/N）：不进设置也能看到几台在线。
    // 30s 轮询（探测缓存 60s 窗口，别打太频）
    const tick = () => api.executors().then((es) => {
      setMachines({ online: es.filter((e) => e.online).length, total: es.length });
    }).catch(() => {});
    tick();
    const t = setInterval(tick, 30_000);
    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "attention") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, pendingConfirms: f.pending } : c)));
        } else if (f.t === "conv_meta") {
          setConvs((cs) => cs.map((c) => (c.id === f.conv ? { ...c, name: f.name } : c)));
        }
      },
    });
    return () => { clearInterval(t); unsub(); };
  }, []);
  return (
    <header className="list-header">
      <button
        className="brand-btn"
        title="回到会话列表"
        onClick={() => navigate({ page: "conversations" })}
      >
        <LogoLockup size={22} />
      </button>
      <NeedsYouButton convs={convs} />
      {machines && machines.online < machines.total && (
        <span className="machines-badge warn" title={`${machines.online}/${machines.total} 台执行机在线——离线机器上的工具调用会等它上线`}>
          ▷ {machines.online}/{machines.total}
        </span>
      )}
      {machines && machines.online === machines.total && (
        <span className="machines-badge" title={`${machines.total} 台执行机全部在线`}>
          ▷ {machines.online}/{machines.total}
        </span>
      )}
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
        // 最近活动的 6 个（列表已按 updatedAt 语义服务端排序不可依赖，这里自己排）。
        // 空会话（P0-1）：无名字且无预览 = 从没发过消息，不展示，与侧栏过滤一致。
        const visible = cs.filter((c) => c.name || c.lastPreview);
        setConvs([...visible].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6));
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
      {loaded && convs.length === 0 ? (
        /* 零会话空态（P0-6）：行动指引——第一步干什么说清楚，不留白屏 */
        <div className="welcome-first-steps">
          <div className="welcome-steps-title">从这两步开始</div>
          <button
            className="welcome-step"
            onClick={() => window.dispatchEvent(new CustomEvent("dorahub:new-conv"))}
          >
            <span className="welcome-step-num">1</span>
            <span className="welcome-step-body">
              <strong>新建一个会话</strong>
              <span>选一台执行机，告诉 agent 要做什么</span>
            </span>
          </button>
          <div className="welcome-step-hint">
            或者：左下「电脑上的 pi 会话」里可以直接导入你已有的会话，在任何设备接着聊。
          </div>
        </div>
      ) : (
        <div className="welcome-hint">从左侧选择一个会话，或点左上「＋ 新会话」</div>
      )}
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
              <span className={`welcome-conv-env ${envColorClass(c.envId)} envc-text`}>{envLabel(c.envId)} · {projectOf(c.cwd).name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
