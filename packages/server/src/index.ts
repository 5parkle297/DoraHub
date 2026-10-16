/**
 * DoraHub server 入口（设计 04 §6）。
 * 装配：harness → Dorahub 应用层 → HTTP API + WS + 静态托管 web/dist。
 * 永远只听 127.0.0.1（安全基线，03 §2）——唯一入口是 tailscale serve。
 *
 * 环境变量：
 *   DORAHUB_DB            sqlite 路径（默认 /var/lib/dorahub/agent.sqlite；开发 ./dev.sqlite）
 *   DORAHUB_CWD           默认 agent 工作目录
 *   DORAHUB_MODEL         默认模型 id（默认 grok-4.7）
 *   DORAHUB_PORT          监听端口（默认 8787）
 *   ZJL_BASE_URL          zjl 中转 baseURL（V-02）
 *   ZJL_API_KEY           zjl key
 *   DORAHUB_TOKEN         funnel 模式 token；设置则强制校验（fail-closed）
 *   DORAHUB_GUARD_RULES   guard-rules.json 路径（默认 ./guard-rules.json）
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { startHarness } from "./harness.ts";
import { Dorahub } from "./dorahub.ts";
import { createRouter } from "./http-api.ts";
import { attachWs } from "./ws.ts";
import { AuditLog } from "./audit.ts";
import { createGuardExtension, loadGuardRules, type GuardRules } from "./guard.ts";
import { ExecRegistry, loadExecutorsFromEnv } from "./exec/registry.ts";
import { channelsFromEnv, installChannels, type ChannelConfig } from "./channels.ts";
import { createRegistry } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

const __dirname = dirname(fileURLToPath(import.meta.url));

const VERSION = "0.1.0";

async function main() {
  const isDev = process.env.NODE_ENV !== "production";
  const dbPath = process.env.DORAHUB_DB ?? (isDev ? "./dev.sqlite" : "/var/lib/dorahub/agent.sqlite");
  const port = Number(process.env.DORAHUB_PORT ?? 8787);
  const cwd = process.env.DORAHUB_CWD ?? process.cwd();
  const modelId = process.env.DORAHUB_MODEL ?? "grok-4.7";
  const token = process.env.DORAHUB_TOKEN || undefined;
  const guardRulesPath = process.env.DORAHUB_GUARD_RULES ?? join(__dirname, "../../../guard-rules.json");

  // 渠道：zjl 主渠道 + 智谱 trial/plan 备用渠道（均 OpenAI-completions）
  const channels = channelsFromEnv();
  if (channels.length === 0) {
    console.error("FATAL: no channel configured (need ZJL_BASE_URL/ZJL_API_KEY or ZHIPU_*_KEY)");
    process.exit(1);
  }

  const audit = new AuditLog(process.env.DORAHUB_AUDIT ?? join(dirname(dbPath), "audit.jsonl"));

  // guard 规则（可选文件；缺省用内置保守规则）
  let rules: GuardRules;
  try {
    rules = loadGuardRules(guardRulesPath);
  } catch {
    rules = { bashDeny: ["rm\\s+-rf\\s+/"], alwaysAsk: ["git\\s+push"], writeOutsideCwd: true };
    console.warn(`[guard] rules file not found at ${guardRulesPath}, using builtin fallback`);
  }

  // 装配 harness（含 guard 扩展——guard 的确认回调由 WS 层注入，这里先占位再接）
  const models = createModels();
  installChannels(models, channels);

  const registry = createRegistry();
  // CodingTools 在 startHarness 内安装；guard 扩展需要 registry.install
  // 但 startHarness 封装了全部装配——这里改为在 startHarness 之外多装一个扩展。
  // 为保持 harness.ts 纯净，guard 在 startHarness 的 options 扩展注入。

  const { harness, execRegistry } = await (async () => {
    // 重新实现 startHarness 的装配以注入 guard（见 harness.ts 注释）
    const { Harness } = await import("@earendil-works/pi-durable");
    const { CodingTools } = await import("@earendil-works/pi-durable/tools");
    const { NodeExecutionEnv } = await import("@earendil-works/pi-durable/env/node");
    const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");

    const guardCb = {
      ask: (conv: string, item: any) => { wsBus?.onConfirmation(conv, item); },
      wait: (confirmId: string, timeoutMs: number) => app.waitForConfirmation(confirmId, timeoutMs),
      resolved: (conv: string, confirmId: string, approved: boolean) => {
        wsBus?.onConfirmationResolved(conv, confirmId, approved);
      },
    };
    const guard = createGuardExtension(rules, guardCb);

    const reg = createRegistry();
    reg.install(CodingTools);
    reg.install(guard); // ← guard 必须进 registry，hooks 才会被调用

    // M4：执行机注册表（envId → pi-env SSH 连接）
    const execRegistry = new ExecRegistry(loadExecutorsFromEnv(), {
      hubCwd: cwd,
      knownHostsFile: process.env.DORAHUB_SSH_KNOWN_HOSTS,
    });

    const h = await Harness.open(
      await openNodeSqliteStorage(dbPath),
      {
        models,
        registry: reg,
        env: (target, ctx) => execRegistry.build(target, ctx),
        settings: { progress: { partialIntervalMs: 200, outputIntervalMs: 200 } },
        onReport: (e) => console.error("[harness]", e),
      },
      BACKGROUND_CONTEXT,
    );
    h.resume();
    return { harness: h, execRegistry };
  })();

  // Dorahub 应用层 + WS 相互接线
  const app = new Dorahub(harness, {
    onEvents: (conv, events) => wsBus?.onEvents(conv, events),
    onStatus: (conv, status) => wsBus?.onStatus(conv, status),
    onConfirmation: (conv, item) => wsBus?.onConfirmation(conv, item),
    onConfirmationResolved: (conv, id, approved) => wsBus?.onConfirmationResolved(conv, id, approved),
  }, { defaultCwd: cwd, defaultModelId: modelId });

  await app.start();

  // 静态托管 web/dist（M3 起）——放在主 router 前面，非 /api /ws 全部回退到静态
  // 源码运行（src/）与 dist 运行（dist/）相对层级不同，两个候选都探测
  const webDistCandidates = [
    join(__dirname, "../../../web/dist"), // src/index.ts 运行 → packages/web/dist
    join(__dirname, "../../web/dist"),   // dist/index.js 运行 → packages/web/dist
  ];
  const webDist = webDistCandidates.find((p) => existsSync(p)) ?? webDistCandidates[0];
  const serveStatic = existsSync(webDist);
  const mimeTypes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
  };

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const isApi = url.pathname.startsWith("/api/") || url.pathname === "/ws";

    const handle = isApi || !serveStatic
      ? createRouter({ app, audit, version: VERSION, startedAt: Date.now(), token, execRegistry, channels })(req, res)
      : (async () => {
          let filePath = join(webDist, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
          if (!filePath.startsWith(webDist)) { res.writeHead(403).end(); return; }
          if (!existsSync(filePath) || !extname(filePath)) filePath = join(webDist, "index.html");
          try {
            const body = readFileSync(filePath);
            const isHtml = extname(filePath) === ".html";
            const isHashed = /-[A-Za-z0-9_-]{8}\./.test(filePath);
            res.writeHead(200, {
              "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
              // HTML 绝不存储（SW/HTTP 缓存都绕开，保证拿到最新资产名）；带 hash 的资产可永久缓存
              "cache-control": isHtml ? "no-store" : isHashed ? "public, max-age=31536000, immutable" : "no-cache",
            });
            res.end(body);
          } catch {
            res.writeHead(404).end();
          }
        })();

    handle.catch((e) => {
      console.error("[http]", e);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { code: "internal", message: String(e) } }));
      }
    });
  });

  let wsBus: ReturnType<typeof attachWs> | undefined;
  wsBus = attachWs(http, app, audit);

  http.listen(port, "127.0.0.1", () => {
    console.log(`dorahub v${VERSION} on http://127.0.0.1:${port} (behind tailscale serve)`);
    console.log(`  db=${dbPath} model=${modelId} static=${serveStatic} guard=${guardRulesPath} token=${token ? "on" : "off"}`);
    const execs = execRegistry.list();
    console.log(`  executors=${execs.length ? execs.map((e) => `${e.envId}(${e.host})`).join(",") : "(hub local only)"}`);
    audit.log("boot", { version: VERSION, pid: process.pid, db: dbPath });
  });

  let closing = false;
  const shutdown = async (sig: string) => {
    if (closing) return;
    closing = true;
    console.log(`\n${sig} — shutting down…`);
    audit.log("shutdown", { pid: process.pid });
    wsBus?.close();
    await execRegistry.close().catch(() => {});
    await app.close().catch((e) => console.error("close:", e));
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
