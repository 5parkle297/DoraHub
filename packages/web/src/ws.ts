/**
 * WS 单例 + 重连状态机（设计 05 §3、06 §3）。
 * connect → syncing → live；断开指数退避 1s→30s；degraded 轮询由上层处理。
 */
import type { SrvFrame, CliFrame } from "@durahub/shared";

export type ConnState = "connecting" | "live" | "syncing" | "degraded" | "error";

type Listener = {
  onFrame?: (frame: SrvFrame) => void;
  onState?: (state: ConnState) => void;
};

class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  state: ConnState = "connecting";
  private retries = 0;
  private retryTimer: number | null = null;
  private manualClose = false;

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private setState(s: ConnState) {
    this.state = s;
    for (const l of this.listeners) l.onState?.(s);
  }

  connect() {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    this.manualClose = false;
    this.setState(this.retries === 0 ? "connecting" : "syncing");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.setState("live");
      // 重新 attach 之前 attach 的会话（服务端不重放历史——重拉 snapshot）
      for (const conv of this.attached) {
        this.send({ t: "attach", conv });
      }
    };
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data) as SrvFrame;
        for (const l of this.listeners) l.onFrame?.(frame);
      } catch { /* 忽略坏帧 */ }
    };
    ws.onclose = () => {
      if (this.manualClose) return;
      this.setState("error");
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      this.setState("error");
    };
  }

  private attached = new Set<string>();

  private scheduleReconnect() {
    if (this.retryTimer !== null) return;
    const delay = Math.min(1000 * 2 ** this.retries, 30_000);
    this.retries++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  send(frame: CliFrame) {
    if (frame.t === "attach") this.attached.add(frame.conv);
    if (frame.t === "detach") this.attached.delete(frame.conv);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  close() {
    this.manualClose = true;
    this.ws?.close();
  }
}

export const wsClient = new WsClient();
