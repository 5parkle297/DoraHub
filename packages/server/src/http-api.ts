/**
 * HTTP API（设计 04 §3）。无框架，node:http 手写路由。
 * 命令走 HTTP（幂等 requestId）；流走 WS。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Dorahub } from "./dorahub.ts";
import type { AuditLog } from "./audit.ts";
import type { ExecRegistry } from "./exec/registry.ts";
import type { ChannelConfig } from "./channels.ts";

export interface HttpApiDeps {
  app: Dorahub;
  audit: AuditLog;
  version: string;
  startedAt: number;
  /** funnel 模式的 token；undefined = serve 模式恒通过 */
  token?: string;
  /** M4：执行机注册表 */
  execRegistry?: ExecRegistry;
  /** 渠道目录（/api/models） */
  channels?: ChannelConfig[];
}

const MAX_BODY = 1 << 20; // 1 MiB

function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(data);
}

function err(res: ServerResponse, status: number, code: string, message: string) {
  json(res, status, { error: { code, message } });
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createRouter(deps: HttpApiDeps) {
  const { app, audit, version, startedAt } = deps;

  return async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // token 中间件（funnel 模式必开；serve 模式 token=undefined 恒通过）
    if (deps.token !== undefined) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${deps.token}`) {
        return err(res, 401, "unauthorized", "missing or invalid bearer token");
      }
    }

    // ---------- 基础 ----------
    if (path === "/api/health" && method === "GET") {
      return json(res, 200, { ok: true, uptime: Date.now() - startedAt, version });
    }

    // ---------- 会话 ----------
    if (path === "/api/conversations" && method === "GET") {
      return json(res, 200, app.listConversations());
    }

    if (path === "/api/conversations" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const conv = await app.createConversation(body);
      audit.log("create_conversation", { conv: String(conv.id), name: body.name, envId: body.envId });
      return json(res, 200, { id: String(conv.id) });
    }

    const convMatch = path.match(/^\/api\/conversations\/([^/]+)(?:\/(.*))?$/);
    if (convMatch) {
      const convId = decodeURIComponent(convMatch[1]);
      const sub = convMatch[2] ?? "";

      if (!app.getConv(convId)) {
        return err(res, 404, "not_found", `conversation ${convId} not found`);
      }

      if (sub === "snapshot" && method === "GET") {
        // 全量视图（重连/晚加入）。复用 attach 机制拿一次 snapshot 不订阅。
        const snap = await app.snapshot(convId);
        return json(res, 200, snap);
      }

      if (sub === "messages" && method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        if (typeof body.content !== "string" || !body.content.trim()) {
          return err(res, 400, "bad_request", "content required");
        }
        const mode = body.mode === "steer" ? "steer" : "input";
        try {
          const sub2 = await app.submit(convId, body.content, mode, body.requestId);
          audit.log(mode === "steer" ? "steer" : "submit", {
            conv: convId,
            submission: String(sub2.id),
            client: req.headers["x-client-id"] ?? "?",
          });
          return json(res, 200, { submissionId: String(sub2.id) });
        } catch (e: any) {
          if (e?.name === "ConversationBusy" || String(e?.message).includes("busy")) {
            return err(res, 409, "conversation_busy", e.message);
          }
          throw e;
        }
      }

      if (sub === "abort" && method === "POST") {
        await app.abort(convId);
        audit.log("abort", { conv: convId });
        return json(res, 200, { ok: true });
      }

      if (sub === "transfer" && method === "POST") {
        // 会话工作区跨机迁移（2026-10-17 会话漫游 MVP）
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const targetEnvId = String(body.targetEnvId ?? "hub");
        const targetCwd = String(body.targetCwd ?? "");
        if (!targetCwd) return err(res, 400, "bad_request", "targetCwd required");
        try {
          const { report, notice } = await app.transferWorkspace(convId, targetEnvId, targetCwd, deps.execRegistry!);
          audit.log("transfer", { conv: convId, from: report.sourceEnv, to: report.targetEnv, copied: report.copied, skipped: report.skipped });
          return json(res, 200, { report, notice });
        } catch (e: any) {
          return err(res, 500, "transfer_failed", String(e?.message ?? e));
        }
      }

      if (sub === "configure" && method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        if (typeof body.name === "string" && body.name) {
          await app.setName(convId, body.name);
        }
        if (typeof body.envId === "string" && body.envId) {
          await app.setEnvId(convId, body.envId);
        }
        const { name: _n, envId: _e, ...agentChange } = body;
        if (Object.keys(agentChange).length > 0) {
          await app.configure(convId, agentChange);
          // model/cwd 变了 → 刷新列表页缓存（0.5-B）
          if (agentChange.model !== undefined || agentChange.cwd !== undefined) {
            await app.refreshAgent(convId);
          }
        }
        audit.log("configure", { conv: convId, change: body });
        return json(res, 200, { ok: true });
      }

      if (sub === "fork" && method === "POST") {
        let body: any = {};
        try { body = JSON.parse((await readBody(req)).toString("utf8")); } catch { /* 空 body 合法 */ }
        const forked = await app.fork(convId, body.entryId);
        audit.log("fork", { from: convId, to: String(forked.id) });
        return json(res, 200, { id: String(forked.id) });
      }

      if (sub === "") {
        return err(res, 405, "method_not_allowed", `unsupported ${method}`);
      }
    }

    // ---------- 确认 ----------
    if (path === "/api/confirmations" && method === "GET") {
      return json(res, 200, app.pendingConfirmations());
    }

    const confirmMatch = path.match(/^\/api\/confirmations\/([^/]+)$/);
    if (confirmMatch && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const ok = app.answerConfirmation(decodeURIComponent(confirmMatch[1]), body.approved === true);
      if (!ok) return err(res, 404, "not_found", "confirmation not pending");
      audit.log("confirmation", { id: confirmMatch[1], approved: body.approved === true });
      return json(res, 200, { ok: true });
    }

    // ---------- 模型渠道目录（切换用） ----------
    if (path === "/api/models" && method === "GET") {
      const { channelCatalog } = await import("./channels.ts");
      return json(res, 200, channelCatalog(deps.channels ?? []));
    }

    // ---------- pi CLI 会话（按需单会话搬运，2026-10-17） ----------
    if (path === "/api/pi-sessions" && method === "GET") {
      const url2 = new URL(req.url ?? "/", "http://local");
      const envId = url2.searchParams.get("env") ?? "hub";
      if (!deps.execRegistry) return json(res, 200, []);
      try {
        const { listPiSessions } = await import("./pi-sessions.ts");
        // hub 自身的 pi 会话也扫（本机目录）
        const sessions = await listPiSessions(deps.execRegistry, envId);
        return json(res, 200, sessions);
      } catch (e: any) {
        return err(res, 500, "pi_session_list_failed", String(e?.message ?? e));
      }
    }

    if (path === "/api/pi-sessions/transfer" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const { sourceEnvId, file, dir, targetEnvId, targetCwd } = body;
      if (!sourceEnvId || !file || !dir || !targetEnvId || !targetCwd) {
        return err(res, 400, "bad_request", "sourceEnvId/file/dir/targetEnvId/targetCwd required");
      }
      try {
        const { transferPiSession } = await import("./pi-sessions.ts");
        const r = await transferPiSession(deps.execRegistry!, sourceEnvId, file, dir, targetEnvId, targetCwd);
        audit.log("pi_session_transfer", { from: sourceEnvId, to: targetEnvId, file, ok: r.ok, bytes: r.bytes });
        if (!r.ok) return err(res, 500, "pi_session_transfer_failed", r.error ?? "unknown");
        return json(res, 200, r);
      } catch (e: any) {
        return err(res, 500, "pi_session_transfer_failed", String(e?.message ?? e));
      }
    }

    // ---------- 执行机（M4） ----------
    if (path === "/api/executors" && method === "GET") {
      // 立即返回缓存/配置状态 + 后台刷新（probe 有 SSH 网络开销，离线机器连接
      // 超时很长——同步等待会把接口拖到分钟级，手机上直接拿不到列表，
      // 2026-10-17 实测踩坑）。前端下次拉列表自然拿到新鲜状态。
      deps.execRegistry?.refreshProbes();
      const list = deps.execRegistry?.list() ?? [];
      const probed = list.map((e) => {
        const lastSeen = deps.execRegistry!.lastSeenOf(e.envId);
        const fresh = lastSeen != null && Date.now() - lastSeen < 60_000;
        return { ...e, online: fresh, lastSeen };
      });
      return json(res, 200, [
        { envId: "hub", host: "local", defaultCwd: process.cwd(), online: true, lastSeen: Date.now() },
        ...probed,
      ]);
    }

    return err(res, 404, "not_found", `no route ${method} ${path}`);
  };
}
