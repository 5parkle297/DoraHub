/**
 * ConvCtx reducer（设计 05 §2 对照表）：事件流就是状态机。
 * snapshot 全量替换；message_start/update 增量；tool_* 卡片状态。
 */
import type { AgentEventLike } from "@dorahub/shared";

export interface ToolCardState {
  toolCallId: string;
  toolName: string;
  status: "preparing" | "running" | "done" | "error" | "blocked";
  args: string; // 格式化后的参数预览
  output: string; // 流式输出
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
}

export interface MessageState {
  id: string;
  role: "user" | "assistant" | "system" | "tool-result";
  text: string;
  thinking: string;
  /** 该消息发出的工具调用（assistant） */
  toolCalls: ToolCardState[];
  streaming: boolean;
}

export interface InboxItemState {
  id: string;
  mode: string;
}

export interface ConvState {
  entries: MessageState[];
  tools: Map<string, ToolCardState>; // toolCallId -> card（跨消息更新）
  inbox: InboxItemState[];
  status: "running" | "idle";
  usage: any;
  /** 渠道故障警告（auto_retry / task_failed / unanswered） */
  alert: { kind: "retry" | "failed" | "unanswered"; text: string; at: number } | null;
}

export function initialConvState(): ConvState {
  return { entries: [], tools: new Map(), inbox: [], status: "idle", usage: null, alert: null };
}

/** watchEvents snapshot 事件 → 状态。 */
export function applySnapshot(state: ConvState, snap: AgentEventLike): ConvState {
  const next: ConvState = {
    entries: [],
    tools: new Map(),
    inbox: (snap.inbox as any[] ?? []).map((i) => ({ id: String(i.id), mode: String(i.mode) })),
    status: state.status,
    usage: snap.usage ?? null,
  };

  // entries：pi.user / pi.system / pi.assistant / pi.tool-result
  for (const raw of snap.entries as any[] ?? []) {
    pushEntry(next, raw);
  }

  // live tools（运行中的工具卡片）
  for (const slot of snap.tools as any[] ?? []) {
    const card: ToolCardState = {
      toolCallId: slot.toolCallId,
      toolName: slot.toolName,
      status: slot.status ?? "running",
      args: JSON.stringify(slot.args ?? {}),
      output: slot.output ?? "",
      startedAt: slot.startedAt,
    };
    next.tools.set(card.toolCallId, card);
  }

  return next;
}

function textOf(entry: any): string {
  const m = entry?.model?.[0];
  if (!m) {
    // 兼容直接传 data 的形态
    const d = entry?.data;
    if (typeof d === "string") return d;
    return "";
  }
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content.filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("");
  }
  return "";
}

function thinkingOf(entry: any): string {
  const m = entry?.model?.[0];
  if (!m || !Array.isArray(m.content)) return "";
  return m.content.filter((b: any) => b.type === "thinking").map((b: any) => b.thinking ?? "").join("");
}

function toolCallsOf(entry: any, state: ConvState): ToolCardState[] {
  const m = entry?.model?.[0];
  if (!m || !Array.isArray(m.content)) return [];
  return m.content
    .filter((b: any) => b.type === "toolCall")
    .map((b: any) => {
      const card: ToolCardState = {
        toolCallId: b.id,
        toolName: b.name,
        status: "preparing",
        args: JSON.stringify(b.arguments ?? {}),
        output: "",
      };
      state.tools.set(card.toolCallId, card);
      return card;
    });
}

function pushEntry(state: ConvState, raw: any) {
  const kind = String(raw.kind ?? "");
  if (kind === "pi.user") {
    state.entries.push({ id: String(raw.id), role: "user", text: textOf(raw), thinking: "", toolCalls: [], streaming: false });
  } else if (kind === "pi.assistant") {
    const m = raw?.model?.[0] ?? {};
    // 渠道错误落地为 stopReason=error 的 assistant entry（401/限流等）
    if (m.stopReason === "error") {
      state.alert = {
        kind: "failed",
        text: `渠道错误：${String(m.errorMessage ?? "unknown").slice(0, 200)}——建议切换渠道后重发`,
        at: Date.now(),
      };
    }
    const msg: MessageState = {
      id: String(raw.id),
      role: "assistant",
      text: textOf(raw),
      thinking: thinkingOf(raw),
      toolCalls: toolCallsOf(raw, state),
      streaming: false,
    };
    state.entries.push(msg);
  } else if (kind === "pi.system") {
    state.entries.push({ id: String(raw.id), role: "system", text: textOf(raw), thinking: "", toolCalls: [], streaming: false });
  } else if (kind === "pi.tool-result") {
    const m = raw?.model?.[0];
    const card = state.tools.get(String(m?.toolCallId ?? ""));
    if (card) {
      card.status = m?.isError ? "error" : "done";
      card.endedAt = Date.now();
      card.durationMs = m?.durationMs;
      if (Array.isArray(m?.content)) {
        card.output = m.content.map((b: any) => b.text ?? "").join("");
      }
    }
    // tool-result 不单独渲染消息（卡片已带输出）
  }
}

/** 增量事件批 → 状态（05 §2 reducer 对照表）。 */
export function applyEvents(state: ConvState, events: AgentEventLike[]): ConvState {
  const next: ConvState = { ...state, tools: new Map(state.tools), entries: [...state.entries], inbox: [...state.inbox], alert: state.alert };

  for (const ev of events) {
    switch (ev.type) {
      case "run_start":
        next.status = "running";
        next.alert = null; // 新一轮运行清除旧警告
        break;
      case "run_end":
        next.status = "idle";
        break;
      case "auto_retry_start": {
        next.alert = {
          kind: "retry",
          text: `渠道出错，第 ${ev.attempt} 次重试：${String(ev.errorMessage).slice(0, 160)}`,
          at: Date.now(),
        };
        break;
      }
      case "auto_retry_end":
        if (next.alert?.kind === "retry") next.alert = null;
        break;
      case "task_failed": {
        next.alert = {
          kind: "failed",
          text: `任务失败（${ev.kind}）：${String(ev.message).slice(0, 200)}`,
          at: Date.now(),
        };
        break;
      }
      case "submission": {
        if (ev.record.status === "unanswered") {
          next.alert = {
            kind: "unanswered",
            text: "模型未应答（渠道可能不可用）——建议在菜单里切换渠道后重发",
            at: Date.now(),
          };
        }
        break;
      }
      case "message_start": {
        const m = ev.message as any;
        if (m?.role === "assistant") {
          next.entries.push({ id: `live-${next.entries.length}`, role: "assistant", text: "", thinking: "", toolCalls: [], streaming: true });
        }
        break;
      }
      case "message_update": {
        const last = next.entries[next.entries.length - 1];
        if (last?.streaming) {
          for (const change of ev.changes as any[] ?? []) {
            if (change.type === "text_delta") last.text += change.delta;
            if (change.type === "thinking_delta") last.thinking += change.delta;
            if (change.type === "toolcall_start") {
              const b = change.block as any;
              const card: ToolCardState = { toolCallId: b.id, toolName: b.name, status: "preparing", args: "", output: "" };
              next.tools.set(card.toolCallId, card);
              last.toolCalls.push(card);
            }
            if (change.type === "toolcall_delta") {
              const b = next.tools.get((change.block as any)?.id ?? "");
              if (b) b.args += change.delta;
            }
          }
        }
        break;
      }
      case "message_end": {
        // live 消息落位：统一走 pushEntry（处理含 toolCall 的完整 entry），
        // 并移除流式占位
        const last = next.entries[next.entries.length - 1];
        if (last?.streaming) {
          next.entries.pop();
        }
        pushEntry(next, ev.entry);
        break;
      }
      case "tool_execution_start": {
        const card = next.tools.get(String(ev.toolCallId));
        if (card) {
          card.status = "running";
          card.startedAt = Date.now();
          if (ev.args) card.args = JSON.stringify(ev.args);
        } else {
          const newCard: ToolCardState = {
            toolCallId: String(ev.toolCallId),
            toolName: String(ev.toolName),
            status: "running",
            args: JSON.stringify(ev.args ?? {}),
            output: "",
            startedAt: Date.now(),
          };
          next.tools.set(newCard.toolCallId, newCard);
          // 挂到最后一条流式 assistant 消息上（snapshot 恢复场景没有挂载点）
          const lastMsg = next.entries[next.entries.length - 1];
          if (lastMsg?.streaming) lastMsg.toolCalls.push(newCard);
        }
        break;
      }
      case "tool_execution_update": {
        const card = next.tools.get(String(ev.toolCallId));
        if (card && ev.output) {
          const o = ev.output as any;
          if ("set" in o && typeof o.set === "string") card.output = o.set;
          else if (o.append) card.output += o.append;
          if (typeof o.trimStart === "number") card.output = card.output.slice(Math.max(0, card.output.length - 65536));
        }
        break;
      }
      case "tool_execution_end": {
        const card = next.tools.get(String(ev.toolCallId));
        if (card) {
          card.status = (ev.entry as any)?.data?.isError ? "error" : "done";
          card.endedAt = Date.now();
          if (card.status === "done" && !card.output && typeof (ev.entry as any)?.data?.output === "string") {
            card.output = (ev.entry as any).data.output;
          }
        }
        break;
      }
      case "inbox_update": {
        next.inbox = (ev.items as any[] ?? []).map((i) => ({ id: String(i.id), mode: String(i.mode) }));
        break;
      }
      case "entry_appended": {
        // user 消息落位（steer/ask 提交后）
        const kind = (ev.entry as any).kind;
        if (kind === "pi.user" || kind === "pi.system") {
          pushEntry(next, ev.entry);
        }
        break;
      }
      case "usage_changed":
        next.usage = ev.usage;
        break;
      default:
        break; // compaction_* / agent_changed 等暂不处理
    }
  }
  return next;
}
