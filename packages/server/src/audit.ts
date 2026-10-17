/**
 * 审计日志（设计 04 §8）：append-only JSONL。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { statSync, renameSync } from "node:fs";

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
  | "transfer"
  | "pi_session_list"
  | "pi_session_transfer"
  | "pi_session_delete"
  | "pi_session_import"
  | "hide_conversation"
  | "shutdown";

export class AuditLog {
  private path: string;

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  log(event: AuditEvent, detail: Record<string, unknown>): void {
    // 轮转：>5MB 改名 .1（保留一份历史；audit 是 jsonl 追加型，够用不过度设计）
    try {
      const st = statSync(this.path);
      if (st.size > 5 * 1024 * 1024) renameSync(this.path, this.path + ".1");
    } catch { /* 不存在则忽略 */ }

    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...detail });
    try {
      appendFileSync(this.path, line + "\n");
    } catch (e) {
      console.error("[audit] write failed:", e);
    }
  }
}
