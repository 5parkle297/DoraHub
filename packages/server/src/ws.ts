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
  /** convId → 事件闸门（attach 时序控制；bus 分发与 detach 都经过它） */
  attached: Map<string, EventGate>;
  alive: boolean;
}

/** attach 闸门：快照捕获前的事件已在 snapshot 里（丢）；
 * 捕获后、snapshot 帧发出前的缓冲；发出后直投。事件全部经 bus → gate 分发。 */
class EventGate {
  private snapshotCaptured = false;
  private snapshotSent = false;
  private buffer: AgentEvent[][] = [];
  constructor(private sendFrame: (frame: SrvFrame) => void, private convId: string) {}

  /** 快照捕获瞬间（dorahub.attach 回调）——此后的事件才需要补发 */
  markSnapshotCaptured() { this.snapshotCaptured = true; }

  /** snapshot 帧已发出——flush 缓冲，后续直投 */
  markSnapshotSent() {
    this.snapshotSent = true;
    while (this.buffer.length > 0) {
      const events = this.buffer.shift()!;
      this.sendFrame({ t: "events", conv: this.convId, events: events as any });
    }
  }

  /** bus 分发入口（事件帧唯一路径） */
  onEvents(events: AgentEvent[]) {
    if (!this.snapshotCaptured) return; // 已在 snapshot 里
    if (this.snapshotSent) {
      this.sendFrame({ t: "events", conv: this.convId, events: events as any });
      return;
    }
    this.buffer.push(events);
  }
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
            // 先注册闸门再 attach：消除“注册前事件丢失”的空窗。
            // 闸门时序：快照捕获前的事件已包含在 snapshot 里（丢弃，重发会造成
            // 前端重复渲染）；捕获后、snapshot 帧发出前的缓冲；发出后直投。
            const gate = new EventGate((frame2) => send(client.ws, frame2), convId);
            client.attached.set(convId, gate);
            try {
              const snapshot = await app.attach(
                convId,
                (events) => gate.onEvents(events), // 订阅计数身份（bus 是唯一分发路径）
                () => gate.markSnapshotCaptured(),
              );
              send(ws, { t: "snapshot", conv: convId, snapshot: snapshot as any });
              gate.markSnapshotSent(); // ws.send FIFO：snapshot 帧先落，缓冲后发
            } catch (e) {
              client.attached.delete(convId); // attach 失败：撤销注册
              throw e;
            }
            break;
          }
          case "detach": {
            const gate = client.attached.get(frame.conv);
            if (gate) {
              client.attached.delete(frame.conv);
              await app.detach(frame.conv, (events) => gate.onEvents(events));
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
      for (const [convId, gate] of client.attached) {
        await app.detach(convId, (events) => gate.onEvents(events)).catch(() => {});
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

  // 事件扇出（Dorahub 回调）——事件帧唯一分发路径：逐客户端过闸门
  const bus = app["events"]; // Dorahub 构造注入的 events 对象

  return {
    /** 事件回调（DorahubEvents 实现）：发给 attach 该会话的所有客户端 */
    onEvents(conv: string, events: AgentEvent[]) {
      for (const client of clients) {
        const gate = client.attached.get(conv);
        if (gate) gate.onEvents(events);
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
