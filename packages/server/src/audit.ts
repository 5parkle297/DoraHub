/**
 * 审计日志（设计 04 §8）：append-only JSONL。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AuditEvent =
  | "boot"
  | "connect"
  | "disconnect"
  | "submit"
  | "steer"
  | "abort"
  | "confirmation"
  | "tool_blocked"
  | "create_conversation"
  | "fork"
  | "configure"
  | "shutdown";

export class AuditLog {
  private path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  log(event: AuditEvent, detail: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...detail });
    try {
      appendFileSync(this.path, line + "\n");
    } catch (e) {
      console.error("[audit] write failed:", e);
    }
  }
}
