/**
 * HTTP API（设计 04 §3）。无框架，node:http 手写路由。
 * 命令走 HTTP（幂等 requestId）；流走 WS。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Dorahub } from "./dorahub.ts";
import type { AuditLog } from "./audit.ts";
import type { ExecRegistry } from "./exec/registry.ts";
import type { ChannelConfig } from "./channels.ts";
import { usageToday } from "./usage-day.ts";
import { context } from "./harness.ts";

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
  /** models 实例（pi 会话摘要生成用） */
  models?: import("@earendil-works/pi-ai").Models;
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

      if (sub === "" && method === "DELETE") {
        // 软删除（列表隐藏，数据保留）
        await app.hideConversation(convId);
        audit.log("hide_conversation", { conv: convId });
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

      if (sub === "read" && method === "POST") {
        // 标记已读（P0-1）：清除 unread + 广播 conv_read（HTTP 兜底路径，WS 也有 read 帧）
        app.markRead(convId);
        return json(res, 200, { ok: true });
      }

      if (sub === "") {
        return err(res, 405, "method_not_allowed", `unsupported ${method}`);
      }
    }

    // ---------- 确认 ----------
    if (path === "/api/confirmations" && method === "GET") {
      return json(res, 200, app.pendingConfirmations());
    }

    // ---------- 今日花费（P1-3）----------
    if (path === "/api/usage/today" && method === "GET") {
      return json(res, 200, usageToday());
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
        const sessions = await listPiSessions(deps.execRegistry, envId, deps.models);
        return json(res, 200, sessions);
      } catch (e: any) {
        return err(res, 500, "pi_session_list_failed", String(e?.message ?? e));
      }
    }

    if (path === "/api/pi-sessions/import" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const { sourceEnvId, dir, file } = body;
      if (!sourceEnvId || !dir || !file) return err(res, 400, "bad_request", "sourceEnvId/dir/file required");
      try {
        const r = await app.importPiSession(deps.execRegistry!, sourceEnvId, dir, file, deps.channels ?? []);
        audit.log("pi_session_import", { from: sourceEnvId, file, ok: r.ok, existing: r.existing ?? false });
        if (!r.ok) return err(res, 500, "pi_import_failed", r.error ?? "unknown");
        return json(res, 200, r);
      } catch (e: any) {
        return err(res, 500, "pi_import_failed", String(e?.message ?? e));
      }
    }

    if (path === "/api/pi-sessions/delete" && method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const { envId, dir, file } = body;
      if (!envId || !dir || !file) return err(res, 400, "bad_request", "envId/dir/file required");
      try {
        const { deletePiSession } = await import("./pi-sessions.ts");
        const r = await deletePiSession(deps.execRegistry!, envId, dir, file);
        audit.log("pi_session_delete", { env: envId, file, ok: r.ok });
        if (!r.ok) return err(res, 500, "pi_delete_failed", r.error ?? "unknown");
        return json(res, 200, r);
      } catch (e: any) {
        return err(res, 500, "pi_delete_failed", String(e?.message ?? e));
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

    // ---------- 目录浏览（P1-4：新建会话选 cwd 时浏览执行机文件系统）----------
    const browseMatch = path.match(/^\/api\/executors\/([^/]+)\/browse$/);
    if (browseMatch && method === "GET") {
      const envId = decodeURIComponent(browseMatch[1]);
      const url = new URL(req.url ?? "/", "http://x");
      const dirPath = url.searchParams.get("path");
      if (!deps.execRegistry) return err(res, 500, "no_executors", "executor registry unavailable");
      // 秒拒已知离线的机器（探测缓存 60s 新鲜窗口）：离线机 SSH 建连要分钟级，
      // 交互式浏览等不了（P1-4，10-29 实测 laptop 离线要 27s 才失败）。
      // 注：探测缓存只看 lastSeen 新鲜度，机器可能实际已上线——用户刷新重试即可。
      const lastSeen = deps.execRegistry.lastSeenOf(envId);
      if (envId !== "hub" && (lastSeen == null || Date.now() - lastSeen > 60_000)) {
        // 后台触发一次探测刷新缓存（下次就秒回）
        deps.execRegistry.probe(envId).catch(() => {});
        return json(res, 502, { error: { code: "offline", message: `${envId} 当前离线或状态未知——开机并连上 Tailscale 后重试` } });
      }
      const env = await deps.execRegistry.buildForEnv(envId, dirPath ?? null).catch(() => null);
      if (!env) return err(res, 502, "offline", `executor ${envId} 不可用（可能离线）`);
      // 无 path → 列默认 cwd（远程机 = home，hub = 服务 cwd）
      const target = dirPath ?? (env as any).cwd ?? "/";
      const showHidden = url.searchParams.get("hidden") === "1";
      // 目录树语义（对齐 Sig directory-browser）：选工作目录只列目录不列文件、
      // 默认滤 . 开头（可开）、服务端返回 home/parent（前端不用算分隔符）、超限明示 truncated。
      let dirs: { name: string; path: string }[];
      let home: string | null = null;
      let truncated = false;
      const MAX_ENTRIES = 500;
      const sep = target.includes("\\") ? "\\" : "/";
      const joinP = (base: string, name: string) => base.endsWith(sep) ? base + name : base + sep + name;
      // parent：Windows 盘根（D:\ 或 D:/）和 POSIX / 无父；其余去最后一段（两种分隔符都处理）
      // D:/hobby -> D:/；D:/ -> null；/var/lib -> /var；/ -> null；C:\ -> null
      const isRoot = /^([A-Za-z]:[\\/]?|\/)$/.test(target) || target === "/";
      const stripped = target.replace(/[\\/]+$/, "");
      const lastSep = Math.max(stripped.lastIndexOf("\\"), stripped.lastIndexOf("/"));
      const parent = isRoot || lastSep <= 0 ? null : stripped.slice(0, lastSep) || null;
      // 离线机器的 SSH 调用会挂到分钟级——浏览是交互式操作，12s 封顶友好失败。
      // 注意：race 输后悬空定时器的 reject 必须吞掉，否则 unhandledRejection 杀进程（10-29 实踩）。
      const withTimeout = (p: Promise<any>, ms: number, label: string) => new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => { if (!done) reject(new Error(label)); }, ms);
        p.then(
          (v) => { done = true; clearTimeout(t); resolve(v); },
          (e) => { done = true; clearTimeout(t); reject(e); },
        );
      });
      let r: any = null;
      try {
        r = await withTimeout(env.listDir(target, context), 12_000, "读取超时（机器可能离线）");
        home = envId === "hub"
          ? (await import("node:os")).homedir()
          : await withTimeout((env as any).connection.info(), 5_000, "").then((i: any) => i?.home ?? null).catch(() => null);
      } catch (e: any) {
        return json(res, 502, { error: { code: "list_failed", message: e?.message ?? "读取失败（机器可能离线）" } });
      }
      if (r && r.ok) {
        const all = (r.value as any[])
          .filter((f) => f.kind === "directory")
          .map((f) => ({ name: String(f.name), path: joinP(target, String(f.name)) }))
          .filter((d) => showHidden || !d.name.startsWith("."));
        all.sort((a, b) => a.name.localeCompare(b.name));
        truncated = all.length > MAX_ENTRIES;
        dirs = all.slice(0, MAX_ENTRIES);
      } else {
        // 兜底：Windows 保留名文件（nul 等）会让 lstat 炸掉整个 listDir（10-29 实踩）；
        // 改用 shell ls 逐条列（对 nul 免疫）。只取目录（尾部 /）。同样 12s 封顶。
        try {
          let out = "";
          const quoted = JSON.stringify(target).slice(1, -1);
          const er = await withTimeout(env.exec(
            `ls -A -F --quoting-style=literal "${quoted}" 2>/dev/null | head -2000`,
            { onOutput: (t2) => { out += t2; } }, context as any,
          ), 12_000, "timeout") as any;
          if (!er || !er.ok) throw new Error("exec failed");
          const all = out.split("\n").filter((l) => l.endsWith("/"))
            .map((l) => l.slice(0, -1).replace(/[@=|*]$/, ""))
            .filter((name) => name && (showHidden || !name.startsWith(".")))
            .map((name) => ({ name, path: joinP(target, name) }));
          all.sort((a, b) => a.name.localeCompare(b.name));
          truncated = all.length > MAX_ENTRIES;
          dirs = all.slice(0, MAX_ENTRIES);
        } catch {
          return json(res, 502, { error: { code: "list_failed", message: (r && r.error?.message) ? String(r.error.message) : "读取失败（机器可能离线）" } });
        }
      }
      return json(res, 200, { path: target, home, parent, directories: dirs, truncated });
    }

    return err(res, 404, "not_found", `no route ${method} ${path}`);
  };
}
