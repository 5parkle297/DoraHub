/** 会话页（06 §2 信息架构 + 2026-10-18 header 收敛）：snapshot → 事件 reducer → 消息流渲染。
 * header：桌面`标题 [🖥env] [model] ●运行 [⏹] [⋯]`；手机`[←] 标题 ●运行 [⋯]`。 */
import { useEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";
import { navigate, useIsWide } from "../route.ts";
import { initialConvState, applySnapshot, applyEvents, type ConvState } from "../state/conv.ts";
import { MessageBubble } from "../components/MessageBubble.tsx";
import { Composer } from "../components/Composer.tsx";
import { ConfirmationCard } from "../components/ConfirmationCard.tsx";
import { InboxBar } from "../components/Inbox.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { EnvSwitcher } from "../components/EnvSwitcher.tsx";
import { RunReportCard } from "../components/RunReportCard.tsx";
import type { ConfirmationItem, ExecutorInfo } from "@dorahub/shared";

export function ConversationPage({ id }: { id: string }) {
  const [state, dispatch] = useReducer(
    (s: ConvState, action: { type: "snapshot"; snap: any } | { type: "events"; events: any[] }) => {
      if (action.type === "snapshot") return applySnapshot(initialConvState(), action.snap);
      return applyEvents(s, action.events);
    },
    initialConvState(),
  );
  const [confirmations, setConfirmations] = useState<ConfirmationItem[]>([]);
  const [convName, setConvName] = useState("");
  const [error, setError] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [agentInfo, setAgentInfo] = useState<{ provider?: string; modelId?: string; thinkingLevel?: string | null }>({});
  const [agentTick, setAgentTick] = useState(0);
  const [envId, setEnvId] = useState<string | null>(null);
  const [convCwd, setConvCwd] = useState<string | null>(null);
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const [migrationDraft, setMigrationDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const wide = useIsWide();
  const [modelOpen, setModelOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const refreshExecutors = () => api.executors().then(setExecutors).catch(() => {});
  // 首次：HTTP snapshot；随后 WS attach
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await api.snapshot(id);
        if (!cancelled) dispatch({ type: "snapshot", snap });
        setError("");
      } catch (e: any) {
        setError(e.message);
      }
    })();
    wsClient.connect();
    wsClient.send({ t: "attach", conv: id });
    // 打开会话 = 已读（P0-1）：清 unread 点，广播到其他设备
    wsClient.send({ t: "read", conv: id });
    api.markRead(id).catch(() => {}); // HTTP 兜底（WS 未连时也能标）

    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "snapshot" && f.conv === id) {
          dispatch({ type: "snapshot", snap: f.snapshot });
        } else if (f.t === "events" && f.conv === id) {
          dispatch({ type: "events", events: f.events });
        } else if (f.t === "confirmation" && f.conv === id) {
          setConfirmations((cs) => [...cs.filter((c) => c.id !== f.confirm.id), f.confirm]);
          navigator.vibrate?.(200);
        } else if (f.t === "confirm_resolved" && f.conv === id) {
          setConfirmations((cs) => cs.filter((c) => c.id !== f.id));
        } else if (f.t === "conv_meta" && f.conv === id) {
          // 自动命名完成 → 无刷新换标题（S5）
          setConvName(f.name);
          if (f.envId !== undefined) setEnvId(f.envId);
        }
      },
    });
    return () => {
      cancelled = true;
      unsub();
      wsClient.send({ t: "detach", conv: id });
    };
  }, [id]);

  // 确认卡补拉（存量缺口修复）：刷新/晚进入会话页时，已弹出的确认卡不会
  // 通过 WS 重放——mount 时拉一次 /api/confirmations 过滤本会话。
  // 否则确认卡只在「弹卡瞬间页面开着」才可见，刷新即丢（10 分钟超时后静默拒绝）。
  useEffect(() => {
    api.pendingConfirmations().then((items) => {
      const mine = items.filter((c: any) => c.conv === id);
      if (mine.length > 0) setConfirmations(mine);
    }).catch(() => {});
  }, [id]);

  // 重连后重拉 snapshot（服务端不重放历史）
  useEffect(() => {
    const unsub = wsClient.subscribe({
      onState: async (s) => {
        if (s === "live") {
          try {
            const snap = await api.snapshot(id);
            dispatch({ type: "snapshot", snap });
          } catch { /* 下次重连再试 */ }
        }
      },
    });
    return unsub;
  }, [id]);

  // 会话名 + 当前 agent（模型/思考强度）+ 执行机
  useEffect(() => {
    api.listConversations().then((cs) => {
      const c = cs.find((c) => c.id === id);
      if (c) {
        if (c.name) setConvName(c.name);
        setEnvId(c.envId);
        setConvCwd(c.cwd);
      }
    }).catch(() => {});
    api.executors().then(setExecutors).catch(() => {});
    api.snapshot(id).then((snap) => {
      const a = snap?.agent ?? {};
      setAgentInfo({
        provider: a.model?.provider,
        modelId: a.model?.modelId,
        thinkingLevel: a.thinkingLevel ?? null,
      });
    }).catch(() => {});
  }, [id, agentTick]);

  // agent_changed 事件同步选择器显示
  useEffect(() => {
    const unsub = wsClient.subscribe({
      onFrame: (f) => {
        if (f.t === "events" && f.conv === id) {
          for (const ev of f.events as any[]) {
            if (ev.type === "agent_changed") {
              setAgentInfo({
                provider: ev.agent?.model?.provider,
                modelId: ev.agent?.model?.modelId,
                thinkingLevel: ev.agent?.thinkingLevel ?? null,
              });
            }
          }
        }
      },
    });
    return unsub;
  }, [id]);

  // 滚动跟随
  useEffect(() => {
    if (atBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state, atBottom]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 200);
  }

  async function answer(confirmId: string, approved: boolean) {
    try {
      await api.answerConfirmation(confirmId, approved);
      setConfirmations((cs) => cs.filter((c) => c.id !== confirmId));
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="page-conv">
      <header className="conv-header">
        {!wide && (
          <button className="btn ghost" onClick={() => navigate({ page: "conversations" })}>←</button>
        )}
        <div className="conv-title">
          <span className="conv-title-name">{convName}</span>
          {wide && (
            <>
              <EnvSwitcher
                convId={id}
                current={envId}
                currentCwd={convCwd}
                executors={executors}
                onSwitched={(v) => setEnvId(v)}
                onOpen={refreshExecutors}
                onMigrationNotice={(notice) => setMigrationDraft(notice)}
              />
              {agentInfo.modelId && (
                <button
                  className="model-tag"
                  title="切换模型（/model）"
                  onClick={() => setModelOpen(true)}
                >
                  {agentInfo.provider}/{agentInfo.modelId}
                </button>
              )}
            </>
          )}
          {state.status === "running" && <span className="badge-running">▶ 运行中</span>}
        </div>
        <div className="conv-actions">
          {wide && state.status === "running" && (
            <button
              className="btn ghost"
              title="中止当前运行"
              onClick={() => api.abort(id).catch((e) => setError(e.message))}
            >
              ⏹
            </button>
          )}
          <button
            className={`btn ghost ${menuOpen ? "menu-open" : ""}`}
            title="更多操作"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
        </div>
        {menuOpen && (
          <ConvMenu
            wide={wide}
            running={state.status === "running"}
            modelId={agentInfo.modelId ?? ""}
            onClose={() => setMenuOpen(false)}
            onSwitchModel={() => { setMenuOpen(false); setModelOpen(true); }}
            onAbort={() => { setMenuOpen(false); api.abort(id).catch((e) => setError(e.message)); }}
            onFork={async () => {
              setMenuOpen(false);
              try {
                const { id: fid } = await api.fork(id);
                navigate({ page: "conversation", id: fid });
              } catch (e: any) {
                setError(e.message);
              }
            }}
          />
        )}
      </header>

      {modelOpen && (
        <ModelPicker
          convId={id}
          current={agentInfo}
          forceOpen
          onConfigured={() => setAgentTick((n) => n + 1)}
          onClose={() => setModelOpen(false)}
        />
      )}

      {error && <div className="error-banner" onClick={() => setError("")}>{error} ✕</div>}

      {state.alert && (
        <div className={`alert-banner alert-${state.alert.kind}`}>
          <span className="alert-icon">{state.alert.kind === "retry" ? "⚠" : state.alert.kind === "failed" ? "✗" : "⛔"}</span>
          {state.alert.text}
        </div>
      )}

      {confirmations.length > 0 && (
        <div className="confirm-zone">
          {confirmations.map((c) => (
            <ConfirmationCard key={c.id} item={c} onAnswer={answer} />
          ))}
        </div>
      )}

      <InboxBar items={state.inbox} />

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {state.entries.map((m) => (
          <MessageBubble key={m.id} msg={m} tools={state.tools} />
        ))}
        {state.entries.length === 0 && (
          <div className="empty">向 agent 提问吧。换台设备打开同一个页面，会话还在这里。</div>
        )}
        {/* 收尾汇报卡（P0-3）：跑完一轮且不在跑时显示在消息流末尾 */}
        {state.status === "idle" && state.lastRunReport && (
          <RunReportCard report={state.lastRunReport} hasPending={confirmations.length > 0} />
        )}
        {!atBottom && (
          <button className="jump-bottom" onClick={() => setAtBottom(true)}>↓ 最新</button>
        )}
      </div>

      <Composer
        disabled={false}
        draft={migrationDraft}
        onDraftConsumed={() => setMigrationDraft("")}
        onSend={async (text, mode) => {
          try {
            await api.send(id, { content: text, mode });
            setError("");
          } catch (e: any) {
            setError(e.message);
          }
        }}
      />
    </div>
  );
}

/** header ⋯ 下拉菜单（portal 到 body——conv-header 有 backdrop-filter，
 * 不 portal 会被钉在 header 高度里，坑清单 #1）。 */
function ConvMenu({
  wide,
  running,
  modelId,
  onClose,
  onSwitchModel,
  onAbort,
  onFork,
}: {
  wide: boolean;
  running: boolean;
  modelId: string;
  onClose: () => void;
  onSwitchModel: () => void;
  onAbort: () => void;
  onFork: () => void;
}) {
  return createPortal(
    <>
      <div className="menu-mask" onClick={onClose} />
      <div className="conv-menu">
        {!wide && (
          <>
            {modelId && (
              <button className="menu-item" onClick={onSwitchModel}>
                ⚙ 切换模型{modelId ? `（当前 ${modelId}）` : ""}
              </button>
            )}
            {running && (
              <button className="menu-item danger" onClick={onAbort}>⏹ 中止运行</button>
            )}
          </>
        )}
        <button className="menu-item" onClick={onFork}>⑂ 在最新消息处分叉</button>
        {!wide && (
          <button className="menu-item" onClick={onClose}>返回列表</button>
        )}
      </div>
    </>,
    document.body,
  );
}
