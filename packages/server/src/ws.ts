/**
 * WebSocket 层（设计 04 §4、05）。
 * 一个客户端一条 WS；hello → attach N 会话 → 事件扇出。
 * watchEvents 每会话只开一个（Dorahub 内部管理），WS 层只是订阅者。
 */
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { AgentEvent } from "@earendil-works/pi-durable";
import type { CliFrame, SrvFrame } from "@dorahub/shared";
import type { Dorahub } from "./dorahub.ts";
import type { AuditLog } from "./audit.ts";

const MAX_FRAME = 1 << 20; // 1 MiB
const HEARTBEAT_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 40_000;

interface Client {
  ws: WebSocket;
  id: string;
  /** convId -> listener（detach 用） */
  attached: Map<string, (events: AgentEvent[]) => void>;
  alive: boolean;
}

export function attachWs(server: HttpServer, app: Dorahub, audit: AuditLog) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
  const clients = new Set<Client>();
  const serverId = `srv-${Date.now().toString(36)}`;

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://local");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const send = (ws: WebSocket, frame: SrvFrame) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(frame));
    }
  };

  wss.on("connection", (ws: WebSocket) => {
    const client: Client = { ws, id: `c-${Math.random().toString(36).slice(2, 8)}`, attached: new Map(), alive: true };
    clients.add(client);
    audit.log("connect", { client: client.id });
    send(ws, { t: "hello", serverId, proto: 1 });

    ws.on("message", async (data) => {
      let frame: CliFrame;
      try {
        frame = JSON.parse(data.toString("utf8"));
      } catch {
        send(ws, { t: "error", message: "bad json" });
        return;
      }
      try {
        switch (frame.t) {
          case "ping":
            send(ws, { t: "pong" });
            break;
          case "attach": {
            const convId = frame.conv;
            if (client.attached.has(convId)) return; // 幂等
            const listener = (events: AgentEvent[]) => {
              send(client.ws, { t: "events", conv: convId, events: events as any });
            };
            const snapshot = await app.attach(convId, listener);
            client.attached.set(convId, listener);
            send(ws, { t: "snapshot", conv: convId, snapshot: snapshot as any });
            break;
          }
          case "detach": {
            const listener = client.attached.get(frame.conv);
            if (listener) {
              client.attached.delete(frame.conv);
              await app.detach(frame.conv, listener);
            }
            break;
          }
          default:
            send(ws, { t: "error", message: `unknown frame ${frame}` });
        }
      } catch (e: any) {
        send(ws, { t: "error", message: e?.message ?? String(e) });
      }
    });

    ws.on("pong", () => { client.alive = true; });

    ws.on("close", async () => {
      clients.delete(client);
      audit.log("disconnect", { client: client.id });
      for (const [convId, listener] of client.attached) {
        await app.detach(convId, listener).catch(() => {});
      }
      client.attached.clear();
    });
  });

  // 心跳：20s ping，40s 无 pong 踢
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  // 事件扇出（Dorahub 回调）
  const bus = app["events"]; // Dorahub 构造注入的 events 对象

  return {
    /** 事件回调（DorahubEvents 实现）：发给 attach 该会话的所有客户端 */
    onEvents(conv: string, events: AgentEvent[]) {
      for (const client of clients) {
        if (client.attached.has(conv)) send(client.ws, { t: "events", conv, events: events as any });
      }
    },
    onStatus(conv: string, status: "running" | "idle") {
      const frame: SrvFrame = { t: "conv_status", conv, status };
      for (const client of clients) send(client.ws, frame);
    },
    onMeta(conv: string, meta: { name: string; description: string | null; keywords: string[]; envId: string | null }) {
      const frame: SrvFrame = { t: "conv_meta", conv, name: meta.name, description: meta.description, keywords: meta.keywords, envId: meta.envId };
      for (const client of clients) send(client.ws, frame);
    },
    onConfirmation(conv: string, item: any) {
      const frame: SrvFrame = { t: "confirmation", conv, confirm: item };
      for (const client of clients) send(client.ws, frame);
    },
    onConfirmationResolved(conv: string, id: string, approved: boolean) {
      const frame: SrvFrame = { t: "confirm_resolved", conv, id, approved };
      for (const client of clients) send(client.ws, frame);
    },
    close() {
      clearInterval(heartbeat);
      for (const client of clients) {
        send(client.ws, { t: "bye", reason: "server shutdown" });
        client.ws.terminate();
      }
      wss.close();
    },
  };
}
