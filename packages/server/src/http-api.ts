/**
 * HTTP API（设计 04 §3）。无框架，node:http 手写路由。
 * 命令走 HTTP（幂等 requestId）；流走 WS。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Durahub } from "./durahub.ts";
import type { AuditLog } from "./audit.ts";

export interface HttpApiDeps {
  app: Durahub;
  audit: AuditLog;
  version: string;
  startedAt: number;
  /** funnel 模式的 token；undefined = serve 模式恒通过 */
  token?: string;
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
      audit.log("create_conversation", { conv: String(conv.id), name: body.name });
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

      if (sub === "configure" && method === "POST") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        if (typeof body.name === "string" && body.name) {
          await app.setName(convId, body.name);
        }
        const { name: _n, ...agentChange } = body;
        if (Object.keys(agentChange).length > 0) {
          await app.configure(convId, agentChange);
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

    return err(res, 404, "not_found", `no route ${method} ${path}`);
  };
}
