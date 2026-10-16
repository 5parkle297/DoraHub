/**
 * DoraHub 应用层：把 pi-durable 的 Harness 语义包装成 hub 服务需要的形状。
 *
 * 职责（设计 04 §2-5）：
 * - 会话注册表：枚举 + 元数据（dorahub.meta doc）+ running/idle 状态
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
import { ConvMetaDoc, type ConvMetaState } from "./conv-meta.ts";
import { AutoNamer, extractUserMessages } from "./auto-namer.ts";
import type { Models } from "@earendil-works/pi-ai";
import type { ConversationSummary } from "@dorahub/shared";

export interface DorahubEvents {
  /** 会话事件批（watchEvents 透传） */
  onEvents(conv: string, events: AgentEvent[]): void;
  /** 会话 running/idle 变化 */
  onStatus(conv: string, status: "running" | "idle"): void;
  /** 会话元数据变化（自动命名 / 手动改名，handoff §0.5-B） */
  onMeta(conv: string, meta: { name: string; description: string | null; keywords: string[]; envId: string | null }): void;
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
  /** 元数据（v2 自动命名字段，handoff §0.5-B） */
  meta: { description: string | null; keywords: string[]; autoNamed: boolean; namedAtUserCount: number; envId: string | null };
  /** agent 配置快照（列表页 model/cwd） */
  model: string | null;
  cwd: string | null;
}

/** 确认等待者 */
interface ConfirmWaiter {
  resolve: (approved: boolean) => void;
  conv: string;
  askedAt: number;
}

export class Dorahub {
  private convs = new Map<string, ConvRecord>();
  private confirmWaiters = new Map<string, ConfirmWaiter>();
  /** harness root 会话 id（列表隐藏用） */
  private rootId = "";

  public harness: Harness;
  private events: DorahubEvents;
  private opts: { defaultCwd: string; defaultModelId: string };
  /** 自动命名服务（0.5-B） */
  public namer: AutoNamer;

  constructor(
    harness: Harness,
    events: DorahubEvents,
    opts: { defaultCwd: string; defaultModelId: string; models?: Models },
  ) {
    this.harness = harness;
    this.events = events;
    this.opts = opts;
    this.namer = new AutoNamer(opts.models ?? (harness as any).models, harness);
    // 自动命名完成 → 更新注册表 + 推帧
    this.namer.onNamed = (convId, title, description, keywords) => {
      const rec = this.convs.get(convId);
      if (rec) {
        rec.name = title;
        rec.meta = { description, keywords, autoNamed: true, namedAtUserCount: rec.meta.namedAtUserCount, envId: rec.meta.envId };
      }
      this.events.onMeta(convId, { name: title, description, keywords, envId: rec?.meta.envId ?? null });
    };
  }

  /** 启动：注册 root + 扫描已有会话（重启用）。 */
  async start() {
    const root = await this.harness.root(context, {
      agent: defaultAgent(this.opts.defaultCwd, this.opts.defaultModelId),
    });
    this.rootId = String(root.id); // 内部会话：不出现在列表（0.5-B）

    // 枚举 storage 里所有会话（Harness 1.2.0 没有同步 listConversations；
    // 通过 session 的 conversation 表查询——用 harness 的查询接口，见 .d.ts）
    await this.rescan();

    // 补偿：旧会话 retroactive 命名（0.5-B）——有用户消息但缺 description 的会话
    // 后台异步跑，不阻塞启动
    setTimeout(() => {
      for (const rec of this.convs.values()) {
        if (rec.lastPreview && !rec.meta.description) {
          this.namer.maybeName(rec.conv);
        }
      }
    }, 5_000).unref?.();
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
      if (this.convs.has(id) || id === this.rootId) continue;
      const conv = await this.harness.conversation(id as unknown as ConversationId, context);
      if (conv) await this.track(conv, "");
    }
  }

  private async track(conv: Conversation, fallbackName: string) {
    const id = String(conv.id);
    if (this.convs.has(id)) return;
    let name = fallbackName;
    let lastPreview = "";
    const meta: ConvRecord["meta"] = { description: null, keywords: [], autoNamed: false, namedAtUserCount: 0, envId: null };
    let model: string | null = null;
    let cwd: string | null = null;
    try {
      // 自定义 doc 不在 viewState.docs（只有 pi.* builtin）——用 documentState 读（0.5-B 踩坑）
      const st = await this.harness.documentState(ConvMetaDoc, conv.id, context);
      const m = st?.value as ConvMetaState | null | undefined;
      if (m?.name) name = m.name;
      if (m) {
        meta.description = m.description ?? null;
        meta.keywords = m.keywords ?? [];
        meta.autoNamed = m.autoNamed === true;
        meta.namedAtUserCount = typeof m.namedAtUserCount === "number" ? m.namedAtUserCount : 0;
        meta.envId = m.envId ?? null;
      }
      // agent 配置（pi.agent doc）
      const view = await conv.viewState(context);
      const agent = (view.value.docs as any)?.["pi.agent"];
      if (agent?.model) {
        model = `${agent.model.provider ?? "zjl"}:${agent.model.modelId}`;
      }
      if (typeof agent?.cwd === "string" && agent.cwd) cwd = agent.cwd;
      // 最后一条 user/assistant entry 做预览
      const entries = view.value.entries ?? [];
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.kind === "pi.user" || e.kind === "pi.assistant") {
          const mm = e?.model?.[0];
          const txt = typeof mm?.content === "string" ? mm.content
            : Array.isArray(mm?.content)
              ? mm.content.filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("")
              : typeof e.data === "string" ? e.data : JSON.stringify(e.data ?? "");
          lastPreview = txt.slice(0, 80);
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
      meta,
      model,
      cwd,
    });
  }

  listConversations(): ConversationSummary[] {
    return [...this.convs.values()]
      .filter((r) => String(r.conv.id) !== this.rootId)
      .map((r) => ({
        id: String(r.conv.id),
        name: r.name,
        status: r.status,
        model: r.model,
        cwd: r.cwd,
        updatedAt: r.updatedAt,
        lastPreview: r.lastPreview,
        description: r.meta.description,
        keywords: r.meta.keywords,
        envId: r.meta.envId && r.meta.envId !== "hub" ? r.meta.envId : null,
      }));
  }

  getConv(id: string): Conversation | undefined {
    return this.convs.get(id)?.conv;
  }

  /** 创建会话（HTTP POST /api/conversations）。 */
  async createConversation(input: { name?: string; cwd?: string; model?: string; envId?: string }) {
    const conv = await this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: defaultAgent(input.cwd ?? this.opts.defaultCwd, input.model ?? this.opts.defaultModelId),
        init: (tx, conversationId) => {
          // dorahub.meta 初始化（tx.doc 拿 Draft，改后提交）
          return tx.doc(ConvMetaDoc, conversationId).then((draft) => {
            draft.name = input.name ?? "";
            if (input.envId) draft.envId = input.envId;
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
        draft.autoNamed = false; // 手动命名后停用自动命名
        draft.description = draft.description ?? null;
        draft.keywords = draft.keywords ?? [];
      });
    }, context);
    const rec = this.convs.get(id);
    if (rec) {
      rec.name = name;
      rec.meta.autoNamed = false;
      this.events.onMeta(id, { name, description: rec.meta.description, keywords: rec.meta.keywords, envId: rec.meta.envId });
    }
  }

  /** 改会话目标机（M4）。 */
  async setEnvId(id: string, envId: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    await conv.commit((tx) => {
      return tx.doc(ConvMetaDoc, conv.id).then((draft) => {
        draft.envId = envId;
      });
    }, context);
    const rec = this.convs.get(id);
    if (rec) {
      rec.meta.envId = envId;
      this.events.onMeta(id, { name: rec.name, description: rec.meta.description, keywords: rec.meta.keywords, envId });
    }
  }

  /** 提交消息（ask/steer）。 */
  async submit(id: string, content: string, mode: "input" | "steer", requestId?: string): Promise<Submission> {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const rec = this.convs.get(id)!;
    rec.lastPreview = content.slice(0, 80);
    rec.updatedAt = Date.now();
    const submission = await conv.submit(
      {
        type: "input",
        content,
        whenBusy: mode === "steer" ? "steer" : "followUp",
        requestId,
      },
      context,
    );
    // 自动命名检查（fire-and-forget，0.5-B）
    this.namer.maybeName(conv);
    return submission;
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

  /** 重读某会话的 agent 配置（configure 后调用刷新列表页 model/cwd）。 */
  async refreshAgent(id: string) {
    const conv = this.getConv(id);
    if (!conv) return;
    const rec = this.convs.get(id)!;
    try {
      const agent = await conv.agent(context);
      rec.model = agent.model ? `${agent.model.provider}:${agent.model.modelId}` : null;
      rec.cwd = agent.cwd ?? null;
    } catch { /* 忽略 */ }
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
      // 状态跟踪：run_start/run_end → conv_status；pi.user 落位 → 自动命名检查
      await es.start(async (events) => {
        for (const rec2 of this.convs.values()) {
          if (String(rec2.conv.id) === id) {
            let running = rec2.status;
            let userAppended = false;
            for (const ev of events) {
              if (ev.type === "run_start") running = "running";
              if (ev.type === "run_end") running = "idle";
              if (ev.type === "submission" && ev.record.status === "done") {
                rec2.updatedAt = Date.now();
              }
              if (ev.type === "entry_appended" && (ev.entry as any)?.kind === "pi.user") {
                userAppended = true;
              }
            }
            if (running !== rec2.status) {
              rec2.status = running;
              this.events.onStatus(id, running);
            }
            if (userAppended) this.namer.maybeName(rec2.conv);
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
