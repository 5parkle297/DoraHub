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
  /** 未读清除（某设备 markRead 后广播，所有设备同步，P0-1） */
  onRead(conv: string): void;
  /** 会话等你处理数变化（确认队列增减，P0-2——不 attach 该会话的设备也要收到） */
  onAttention(conv: string, pending: number): void;
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
  meta: { description: string | null; keywords: string[]; autoNamed: boolean; namedAtUserCount: number; envId: string | null; hidden: boolean };
  /** agent 配置快照（列表页 model/cwd） */
  model: string | null;
  cwd: string | null;
  /** 来源 pi 会话 key（导入去重；null = 原生） */
  sourcePiKey: string | null;
  /** 未读：有新动静（assistant 事件）但没人 markRead（P0-1） */
  unread: boolean;
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

  /** pi 会话来源索引（sourcePiKey -> convId，导入去重） */
  piSourceIndex = new Map<string, string>();

  findByPiSource(key: string): string | null {
    for (const [id, rec] of this.convs) {
      if (rec.sourcePiKey === key) return id;
    }
    return null;
  }

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
        rec.meta = { description, keywords, autoNamed: true, namedAtUserCount: rec.meta.namedAtUserCount, envId: rec.meta.envId, hidden: rec.meta.hidden };
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
    const meta: ConvRecord["meta"] = { description: null, keywords: [], autoNamed: false, namedAtUserCount: 0, envId: null, hidden: false };
    let model: string | null = null;
    let cwd: string | null = null;
    let sourcePiKey: string | null = null;
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
        meta.hidden = m.hidden === true;
        sourcePiKey = typeof m.sourcePiKey === "string" ? m.sourcePiKey : null;
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
      sourcePiKey,
      unread: false,
    });
  }

  listConversations(): ConversationSummary[] {
    // 等你处理数：确认等待者按 conv 聚合（服务端是真相，坑 #30）
    const pendingByConv = new Map<string, number>();
    for (const w of this.confirmWaiters.values()) {
      if (!w.conv) continue;
      pendingByConv.set(w.conv, (pendingByConv.get(w.conv) ?? 0) + 1);
    }
    return [...this.convs.values()]
      .filter((r) => String(r.conv.id) !== this.rootId && !r.meta.hidden)
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
        unread: r.unread,
        pendingConfirms: pendingByConv.get(String(r.conv.id)) ?? 0,
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
    // 无人 attach 时也要跟踪运行（P0-1）：否则无人看的会话跑完了，
    // status 卡在旧值、unread 也不标——列表完全不知道动静。并 Here 开幽灵流，
    // run_end 后自动停（避免空转）。
    if (!rec.stream) await this.startGhostStream(id);
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

  /** 幽灵流：无订阅者时并的事件跟踪（只更新状态/unread/updatedAt，不扇出）。
   * run_end 到来且仍无订阅者 → 自动停流。
   * 交棒：幽灵流存续期间有人 attach → rec.stream 被替换成普通流的 stop；
   * 幽灵流自身的 stop 变 no-op（避免双重停）。 */
  private async startGhostStream(id: string) {
    return this.serialize(id, async () => {
      const rec = this.convs.get(id);
      if (!rec || rec.stream) return; // 已有流（attach 中或幽灵流已开）
      const es = await watchEvents(this.harness, rec.conv.id, context);
      let stopped = false;
      const stop = async () => {
        if (stopped) return;
        stopped = true;
        // 仍无订阅者才真停（等待期间有人 attach 上了就交棒：doAttach 会换掉 rec.stream）
        if (rec.pending.size === 0) {
          if (rec.stream?.stop === stop) rec.stream = undefined;
          await es.stop().catch(() => {});
        }
      };
      rec.stream = { stop };
      await es.start(async (events) => {
        await this.handleStreamEvents(id, events);
        // run 结束且无人看 → 停幽灵流
        if (events.some((ev) => ev.type === "run_end") && rec.pending.size === 0) {
          await stop();
        }
      });
    });
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

  /** 导入 pi 会话为 durable 会话（去重后转发给 pi-import）。 */
  async importPiSession(execRegistry: import("./exec/registry.ts").ExecRegistry, sourceEnvId: string, dir: string, file: string, channels: import("./channels.ts").ChannelConfig[] = []) {
    const { importPiSession } = await import("./pi-import.ts");
    const key = `pi:${sourceEnvId}/${file}`;
    const existing = this.findByPiSource(key);
    if (existing) {
      return { ok: true, convId: existing, existing: true } as import("./pi-import.ts").PiImportResult;
    }
    const result = await importPiSession(this.harness, execRegistry, sourceEnvId, dir, file, channels);
    if (result.ok && result.convId) {
      this.piSourceIndex.set(key, result.convId);
      const conv = await this.harness.conversation(result.convId as any, context);
      if (conv) await this.track(conv, "");
    }
    return result;
  }

  /** 软删除会话（列表隐藏，数据保留——durable 哲学，fork 历史不断）。 */
  async hideConversation(id: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    await conv.commit((tx) => {
      return tx.doc(ConvMetaDoc, conv.id).then((draft) => {
        draft.hidden = true;
      });
    }, context);
    const rec = this.convs.get(id);
    if (rec) rec.meta.hidden = true;
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

  /**
   * 会话工作区跨机迁移（会话漫游 MVP，2026-10-17）。
   * harvest → 中转搬运 → 返回给 agent 的校准提示（前端预填到 composer，
   * 用户发送后进上下文——比服务端硬塞 entry 透明）。
   */
  async transferWorkspace(
    id: string,
    targetEnvId: string,
    targetCwd: string,
    execRegistry: import("./exec/registry.ts").ExecRegistry,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ report: import("./transfer.ts").TransferReport; notice: string }> {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const rec = this.convs.get(id)!;
    const sourceEnv = rec.meta.envId ?? "hub";
    const sourceCwd = rec.cwd ?? "";
    if (sourceEnv === targetEnvId) throw new Error("source and target are the same machine");

    // 1. 挖文件清单
    const { harvestWorkspace } = await import("./workspace-harvest.ts");
    const harvest = await harvestWorkspace(conv, sourceCwd);

    // 2. 两端的 env
    const sourceEnvObj = await execRegistry.buildForEnv(sourceEnv, sourceCwd);
    const targetEnvObj = await execRegistry.buildForEnv(targetEnvId, targetCwd);
    if (!sourceEnvObj || !targetEnvObj) throw new Error("executor not available");

    // 3. 搬运
    const { transferFiles, migrationNotice } = await import("./transfer.ts");
    const report = harvest.files.length
      ? await transferFiles(harvest.files, sourceEnvObj, targetEnvObj, targetCwd, onProgress)
      : { ok: true, copied: 0, skipped: 0, oversize: [], totalBytes: 0, errors: [], sourceEnv: sourceEnvObj.id, targetEnv: targetEnvObj.id, targetCwd };

    // 4. 切目标机 + cwd
    await this.setEnvId(id, targetEnvId);
    await conv.configure({ cwd: targetCwd || undefined }, context);
    await this.refreshAgent(id);

    // 5. 校准提示（返回给前端预填）
    const notice = migrationNotice(report, sourceCwd);
    return { report, notice };
  }

  /** 拿一次性 snapshot（HTTP GET /snapshot 用，不订阅）。 */
  async snapshot(id: string) {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const es = await watchEvents(this.harness, conv.id, context);
    await es.stop();
    return es.snapshot;
  }

  /** attach：为订阅者打开事件流（首个订阅者时 start）。
   * onSnapshotCaptured：快照捕获瞬间回调（ws 层用它翻闸门：此后的事件才需要
   * 补发给客户端——之前的事件已包含在快照里，重发会造成重复渲染）。 */
  async attach(id: string, listener: (events: AgentEvent[]) => void, onSnapshotCaptured?: () => void): Promise<AgentEvent> {
    // 同会话的 attach/detach 串行化：ws 层的帧处理是并发的，StrictMode 的
    // attach→detach→attach 快速序列会交错——两个 attach 同时通过
    // `if (!rec.stream)` 检查 → 建出两个 watchEvents 流，一个泄漏且永不停，
    // 每批事件双份扇出（2026-10-19 手机双份消息的第二根源，间歇 2/5 复现）。
    return this.serialize(id, () => this.doAttach(id, listener, onSnapshotCaptured));
  }

  /** per-conv 操作链（attach/detach 互斥） */
  private opChains = new Map<string, Promise<unknown>>();

  private serialize<T>(id: string, op: () => Promise<T>): Promise<T> {
    const prev = this.opChains.get(id) ?? Promise.resolve();
    const run = prev.then(op, op); // 前序失败不阻塞后续
    // 链尾白满后清理；期间有新操作挂链则保留
    const settled = run.then(() => {}, () => {});
    this.opChains.set(id, settled);
    settled.then(() => {
      if (this.opChains.get(id) === settled) this.opChains.delete(id);
    });
    return run;
  }

  private async doAttach(id: string, listener: (events: AgentEvent[]) => void, onSnapshotCaptured?: () => void): Promise<AgentEvent> {
    const conv = this.getConv(id);
    if (!conv) throw new Error(`conversation ${id} not found`);
    const rec = this.convs.get(id)!;
    rec.pending.add(listener);

    if (!rec.stream) {
      const es = await watchEvents(this.harness, conv.id, context);
      await es.start(async (events) => {
        // 状态跟踪 + 扇出（handleStreamEvents 内含 conv_status/unread/自动命名）
        await this.handleStreamEvents(id, events);
      });
      rec.stream = { stop: () => es.stop() };
    }

    // 重新打开流拿当前 snapshot
    const es = await watchEvents(this.harness, conv.id, context);
    const snapshot = es.snapshot;
    onSnapshotCaptured?.(); // 此刻起的事件不在 snapshot 里，需要补发
    await es.stop();
    return snapshot;
  }

  /** 事件流共享处理（attach 流与幽灵流共用）：状态跟踪 + unread + 扇出。
   * 事件只走 this.events.onEvents 总线广播一条路（ws 层按 attached 分发）。
   * 历史 bug（2026-10-19 手机双份消息）：这里曾同时直调 rec.pending 的
   * listener——ws 层的 listener 会 send 一帧，onEvents 广播又 send 一帧，
   * 同一客户端每批 events 收到两份，前端 reducer 跑两遍 → 消息成双。
   * pending 集合保留，仅作订阅计数（detach 判断何时停流）。 */
  private async handleStreamEvents(id: string, events: readonly AgentEvent[]) {
    const rec = this.convs.get(id);
    if (rec) {
      let running = rec.status;
      let userAppended = false;
      for (const ev of events) {
        if (ev.type === "run_start") running = "running";
        if (ev.type === "run_end") running = "idle";
        if (ev.type === "submission" && ev.record.status === "done") {
          rec.updatedAt = Date.now();
        }
        if (ev.type === "entry_appended" && (ev.entry as any)?.kind === "pi.user") {
          userAppended = true;
        }
      }
      if (running !== rec.status) {
        rec.status = running;
        this.events.onStatus(id, running);
      }
      // 未读（P0-1）：assistant 侧动静（assistant 消息/工具结果）且当前无人 attach。
      // 有人 attach = 有人正看着这个会话（桌面开着或手机正在看）——不算未读。
      const hasAssistantActivity = events.some((ev) =>
        ev.type === "message_end" && (ev.entry as any)?.kind === "pi.assistant"
        || ev.type === "entry_appended" && (ev.entry as any)?.kind === "pi.assistant"
        || ev.type === "tool_execution_end",
      );
      if (hasAssistantActivity && rec.pending.size === 0 && !rec.unread) {
        rec.unread = true;
      }
      if (userAppended) this.namer.maybeName(rec.conv);
    }
    this.events.onEvents(id, [...events]);
  }

  /** detach：最后一个订阅者离开时停流（与 attach 串行化，见 attach 注释）。 */
  async detach(id: string, listener: (events: AgentEvent[]) => void) {
    return this.serialize(id, () => this.doDetach(id, listener));
  }

  private async doDetach(id: string, listener: (events: AgentEvent[]) => void) {
    const rec = this.convs.get(id);
    if (!rec) return;
    rec.pending.delete(listener);
    if (rec.pending.size === 0 && rec.stream) {
      await rec.stream.stop();
      rec.stream = undefined;
    }
  }

  // ===== 确认队列（guard 回调实现） =====

  /** 标记已读（P0-1）：清除 unread 并广播给所有设备。
   * 恒广播（不只 unread=true 时）：客户端用它确认 read 帧送达（清补发队列），
   * 幂等且无回环（客户端不会四 conv_read 再发 read）。 */
  markRead(id: string) {
    const rec = this.convs.get(id);
    if (rec) rec.unread = false;
    this.events.onRead(id);
  }

  askConfirmation(conv: string, item: any) {
    // 记录 conv 供 answer 时广播（waiter 的 conv 字段）
    this.pendingConv.set(String(item.id), conv);
    this.events.onConfirmation(conv, item);
    // attention 帧在 waitForConfirmation 入队后推（那时计数才准确）
  }

  private pendingConv = new Map<string, string>();

  /** 某会话当前等你处理的确认数。 */
  attentionOf(conv: string): number {
    let n = 0;
    for (const w of this.confirmWaiters.values()) {
      if (w.conv === conv) n++;
    }
    return n;
  }

  async waitForConfirmation(confirmId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const conv = this.pendingConv.get(confirmId) ?? "";
      const timer = setTimeout(() => {
        this.confirmWaiters.delete(confirmId);
        // 超时 fail-closed 也是一次 attention 变化（卡片从列表消失）
        this.events.onAttention(conv, this.attentionOf(conv));
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
      // 入队后推送（P0-2）：此刻 attentionOf 已含本项
      this.events.onAttention(conv, this.attentionOf(conv));
    });
  }

  answerConfirmation(confirmId: string, approved: boolean): boolean {
    const w = this.confirmWaiters.get(confirmId);
    if (!w) return false;
    // resolve 内部触发 guardCb.resolved 的广播；这里不再重复发
    this.pendingConv.delete(confirmId);
    w.resolve(approved);
    this.events.onAttention(w.conv, this.attentionOf(w.conv));
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
