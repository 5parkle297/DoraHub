/** 会话页（06 §2 信息架构）：snapshot → 事件 reducer → 消息流渲染。 */
import { useEffect, useReducer, useRef, useState } from "react";
import { api } from "../api.ts";
import { wsClient } from "../ws.ts";
import { navigate } from "../route.ts";
import { initialConvState, applySnapshot, applyEvents, type ConvState } from "../state/conv.ts";
import { MessageBubble } from "../components/MessageBubble.tsx";
import { Composer } from "../components/Composer.tsx";
import { ConfirmationCard } from "../components/ConfirmationCard.tsx";
import { InboxBar } from "../components/Inbox.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { EnvSwitcher } from "../components/EnvSwitcher.tsx";
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
  const [executors, setExecutors] = useState<ExecutorInfo[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        <button className="btn ghost" onClick={() => navigate({ page: "conversations" })}>←</button>
        <div className="conv-title">
          <span className="conv-title-name">{convName}</span>
          <EnvSwitcher
            convId={id}
            current={envId}
            executors={executors}
            onSwitched={(v) => setEnvId(v)}
            onOpen={refreshExecutors}
          />
          {agentInfo.modelId && (
            <button className="model-tag" title="点击切换模型（/model）">
              {agentInfo.provider}/{agentInfo.modelId}
            </button>
          )}
          {state.status === "running" && <span className="badge-running">▶ 运行中</span>}
        </div>
        <div className="conv-actions">
          <ModelPicker
            convId={id}
            current={agentInfo}
            onConfigured={() => setAgentTick((n) => n + 1)}
          />
          <button className="btn ghost" title="中止当前运行" onClick={() => api.abort(id).catch((e) => setError(e.message))}>
            ⏹
          </button>
          <button
            className="btn ghost"
            title="在最新消息处分叉"
            onClick={async () => {
              try {
                const { id: fid } = await api.fork(id);
                navigate({ page: "conversation", id: fid });
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            ⑂
          </button>
        </div>
      </header>

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
        {!atBottom && (
          <button className="jump-bottom" onClick={() => setAtBottom(true)}>↓ 最新</button>
        )}
      </div>

      <Composer
        disabled={false}
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
