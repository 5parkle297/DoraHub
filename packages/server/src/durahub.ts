/**
 * DuraHub 应用层：把 pi-durable 的 Harness 语义包装成 hub 服务需要的形状。
 *
 * 职责（设计 04 §2-5）：
 * - 会话注册表：枚举 + 元数据（durahub.meta doc）+ running/idle 状态
 * - 事件流中心：每会话至多一个 watchEvents，扇出到 N 个订阅者
 * - 确认队列：guard 回调 → WS confirmation 帧 → 用户决定
 * - 会话状态推送：run_start/run_end → conv_status 帧
 */
import { watchEvents } from "@earendil-works/pi-durable";
import type {
  AgentEvent,
  Conversation,
  ConversationId,
  Harness,
  Submission,
} from "@earendil-works/pi-durable";
import { context, defaultAgent } from "./harness.ts";
import { ConvMetaDoc } from "./conv-meta.ts";
import type { ConversationSummary } from "@durahub/shared";

export interface DurahubEvents {
  /** 会话事件批（watchEvents 透传） */
  onEvents(conv: string, events: AgentEvent[]): void;
  /** 会话 running/idle 变化 */
  onStatus(conv: string, status: "running" | "idle"): void;
  /** 确认请求（guard） */
  onConfirmation(conv: string, item: any): void;
  onConfirmationResolved(conv: string, id: string, approved: boolean): void;
}

interface ConvRecord {
  conv: Conversation;
  name: string;
  status: "running" | "idle";
  /** 事件订阅者数量 >0 时保持 watchEvents 流 */
  stream?: { stop(): Promise<unknown> };
  pending: Set<(events: AgentEvent[]) => void>;
  lastPreview: string;
  updatedAt: number;
}

/** 确认等待者 */
interface ConfirmWaiter {
  resolve: (approved: boolean) => void;
  conv: string;
  askedAt: number;
}

export class Durahub {
  private convs = new Map<string, ConvRecord>();
  private confirmWaiters = new Map<string, ConfirmWaiter>();

  public harness: Harness;
  private events: DurahubEvents;
  private opts: { defaultCwd: string; defaultModelId: string };

  constructor(
    harness: Harness,
    events: DurahubEvents,
    opts: { defaultCwd: string; defaultModelId: string },
  ) {
    this.harness = harness;
    this.events = events;
    this.opts = opts;
  }

  /** 启动：注册 root + 扫描已有会话（重启用）。 */
  async start() {
    const root = await this.harness.root(context, {
      agent: defaultAgent(this.opts.defaultCwd, this.opts.defaultModelId),
    });
    await this.track(root, "root");

    // 枚举 storage 里所有会话（Harness 1.2.0 没有同步 listConversations；
    // 通过 session 的 conversation 表查询——用 harness 的查询接口，见 .d.ts）
    await this.rescan();
  }

  /** 扫描 storage 重建会话注册表（启动/崩溃恢复后调用）。 */
  async rescan() {
    // 事实源：Tx.scanConversations（types.d.ts）。在 harness 的 session 上通过
    // conversation() 逐个恢复 handle；用 commit 里的 scan 拿全量 id。
    const ids = new Set<string>([...this.convs.keys()]);
    await this.harness.commit(async (tx) => {
      const page = await tx.scanConversations({}, 200);
      for (const record of page.items) {
        ids.add(String(record.id));
      }
    }, context);
    for (const id of ids) {
      if (this.convs.has(id)) continue;
      const conv = await this.harness.conversation(id as unknown as ConversationId, context);
      if (conv) await this.track(conv, "");
    }
  }

  private async track(conv: Conversation, fallbackName: string) {
    const id = String(conv.id);
    if (this.convs.has(id)) return;
    let name = fallbackName;
    let lastPreview = "";
    try {
      const view = await conv.viewState(context);
      const docs = view.value.docs as any;
      if (docs?.["durahub.meta"]?.name) name = docs["durahub.meta"].name;
      // 最后一条 user/assistant entry 做预览
      const entries = view.value.entries ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.kind === "pi.user" || e.kind === "pi.assistant") {
          const data = typeof e.data === "string" ? e.data : JSON.stringify(e.data);
          lastPreview = data.slice(0, 80);
          break;
        }
      }
    } catch { /* 视图失败不阻塞 */ }
    this.convs.set(id, {
      conv,
      name,
      status: "idle",
      pending: new Set(),
      lastPreview,
      updatedAt: Date.now(),
    });
  }

  listConversations(): ConversationSummary[] {
    return [...this.convs.values()].map((r) => ({
      id: String(r.conv.id),
      name: r.name,
      status: r.status,
      model: null,
      cwd: null,
      updatedAt: r.updatedAt,
      lastPreview: r.lastPreview,
    }));
  }

  getConv(id: string): Conversation | undefined {
    return this.convs.get(id)?.conv;
  }

  /** 创建会话（HTTP POST /api/conversations）。 */
  async createConversation(input: { name?: string; cwd?: string; model?: string }) {
    const conv = await this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: defaultAgent(input.cwd ?? this.opts.defaultCwd, input.model ?? this.opts.defaultModelId),
        init: (tx, conversationId) => {
          // durahub.meta 初始化（tx.doc 拿 Draft，改后提交）
          return tx.doc(ConvMetaDoc, conversationId).then((draft) => {
            draft.name = input.name ?? "";
          });
        },
      },
      context,
    );
    await this.track(conv, input.name ?? "");
    return conv;
  }

  async setName(id: string, name: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    await conv.commit((tx) => {
      return tx.doc(ConvMetaDoc, conv.id).then((draft) => {
        draft.name = name;
      });
    }, context);
    const rec = this.convs.get(id);
    if (rec) rec.name = name;
  }

  /** 提交消息（ask/steer）。 */
  async submit(id: string, content: string, mode: "input" | "steer", requestId?: string): Promise<Submission> {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const rec = this.convs.get(id)!;
    rec.lastPreview = content.slice(0, 80);
    rec.updatedAt = Date.now();
    return conv.submit(
      {
        type: "input",
        content,
        whenBusy: mode === "steer" ? "steer" : "followUp",
        requestId,
      },
      context,
    );
  }

  async abort(id: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    await conv.abort(context);
  }

  async configure(id: string, change: Record<string, unknown>) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    await conv.configure(change as any, context);
  }

  /** fork：缺省在最新 entry。 */
  async fork(id: string, entryId?: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    let at: any = entryId;
    if (!at) {
      const page = await conv.entries({ order: "descending" }, 1, undefined, context);
      if (!page.items[0]) throw new Error("conversation has no entries to fork at");
      at = page.items[0].id;
    }
    const forked = await conv.fork(at as any, { ownership: { kind: "ownerless" } }, context);
    const src = this.convs.get(id);
    await this.track(forked, src ? `${src.name} (fork)` : "fork");
    return forked;
  }

  /** 拿一次性 snapshot（HTTP GET /snapshot 用，不订阅）。 */
  async snapshot(id: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const es = await watchEvents(this.harness, conv.id, context);
    await es.stop();
    return es.snapshot;
  }

  /** attach：为订阅者打开事件流（首个订阅者时 start）。 */
  async attach(id: string, listener: (events: AgentEvent[]) => void): Promise<AgentEvent> {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const rec = this.convs.get(id)!;
    rec.pending.add(listener);

    if (!rec.stream) {
      const es = await watchEvents(this.harness, conv.id, context);
      // 状态跟踪：run_start/run_end → conv_status
      await es.start(async (events) => {
        for (const rec2 of this.convs.values()) {
          if (String(rec2.conv.id) === id) {
            let running = rec2.status;
            for (const ev of events) {
              if (ev.type === "run_start") running = "running";
              if (ev.type === "run_end") running = "idle";
              if (ev.type === "submission" && ev.record.status === "done") {
                rec2.updatedAt = Date.now();
              }
            }
            if (running !== rec2.status) {
              rec2.status = running;
              this.events.onStatus(id, running);
            }
            break;
          }
        }
        for (const l of rec.pending) {
          try { l([...events]); } catch { /* 订阅者自己炸不管 */ }
        }
        this.events.onEvents(id, [...events]);
      });
      rec.stream = { stop: () => es.stop() };
    }

    // 重新打开流拿当前 snapshot
    const es = await watchEvents(this.harness, conv.id, context);
    const snapshot = es.snapshot;
    await es.stop();
    return snapshot;
  }

  /** detach：最后一个订阅者离开时停流。 */
  async detach(id: string, listener: (events: AgentEvent[]) => void) {
    const rec = this.convs.get(id);
    if (!rec) return;
    rec.pending.delete(listener);
    if (rec.pending.size === 0 && rec.stream) {
      await rec.stream.stop();
      rec.stream = undefined;
    }
  }

  // ===== 确认队列（guard 回调实现） =====

  askConfirmation(conv: string, item: any) {
    // 记录 conv 供 answer 时广播（waiter 的 conv 字段）
    this.pendingConv.set(String(item.id), conv);
    this.events.onConfirmation(conv, item);
  }

  private pendingConv = new Map<string, string>();

  async waitForConfirmation(confirmId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const conv = this.pendingConv.get(confirmId) ?? "";
      const timer = setTimeout(() => {
        this.confirmWaiters.delete(confirmId);
        resolve(false);
      }, timeoutMs);
      this.confirmWaiters.set(confirmId, {
        resolve: (approved) => {
          clearTimeout(timer);
          this.confirmWaiters.delete(confirmId);
          resolve(approved);
        },
        conv,
        askedAt: Date.now(),
      });
    });
  }

  answerConfirmation(confirmId: string, approved: boolean): boolean {
    const w = this.confirmWaiters.get(confirmId);
    if (!w) return false;
    // resolve 内部触发 guardCb.resolved 的广播；这里不再重复发
    this.pendingConv.delete(confirmId);
    w.resolve(approved);
    return true;
  }

  pendingConfirmations(): any[] {
    return [...this.confirmWaiters.entries()].map(([id, w]) => ({
      id,
      conv: w.conv,
      tool: "?",
      args: {},
      askedAt: w.askedAt,
    }));
  }

  async close() {
    for (const rec of this.convs.values()) {
      await rec.stream?.stop();
    }
    await this.harness.close(context);
  }
}
