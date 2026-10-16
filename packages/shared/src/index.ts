/**
 * DoraHub 协议类型（设计 05 + 04 §3）。
 * server 与 web 共用的单一定义源。
 */

// ============ HTTP API 类型 ============

export interface HealthResponse {
  ok: true;
  uptime: number;
  version: string;
}

export interface ConversationSummary {
  id: string;
  name: string;
  status: "running" | "idle";
  model: string | null;
  cwd: string | null;
  updatedAt: number;
  lastPreview: string | null;
}

export interface CreateConversationRequest {
  name?: string;
  cwd?: string;
  model?: string;
}

export interface CreateConversationResponse {
  id: string;
}

export interface SnapshotResponse {
  conv: string;
  entries: unknown[];
  live: unknown;
  inbox: unknown[];
  agent: unknown;
  usage: unknown;
}

export interface SendMessageRequest {
  content: string;
  mode: "input" | "steer";
  requestId?: string;
}

export interface SendMessageResponse {
  submissionId: string;
}

export interface ConfigureRequest {
  model?: string | null;
  cwd?: string | null;
  instructions?: string | null;
  name?: string;
}

export interface ForkRequest {
  entryId?: string; // 缺省 = 最新 entry
}

export interface ForkResponse {
  id: string;
}

export interface ConfirmationItem {
  id: string;
  conv: string;
  tool: string;
  args: unknown;
  askedAt: number;
}

export interface ApiError {
  error: { code: string; message: string };
}

// ============ WebSocket 帧（05 §2） ============

/** watchEvents 的 AgentEvent 透传（server 不重新定义，裁剪层只做体积控制）。 */
export type AgentEventLike = { type: string } & Record<string, unknown>;

export type SrvFrame =
  | { t: "hello"; serverId: string; proto: 1 }
  | { t: "snapshot"; conv: string; snapshot: AgentEventLike } // watchEvents 的 snapshot 事件原样
  | { t: "events"; conv: string; events: AgentEventLike[] }
  | { t: "conv_status"; conv: string; status: "running" | "idle" }
  | { t: "confirmation"; conv: string; confirm: ConfirmationItem }
  | { t: "confirm_resolved"; conv: string; id: string; approved: boolean }
  | { t: "pong" }
  | { t: "bye"; reason: string }
  | { t: "error"; message: string };

export type CliFrame =
  | { t: "attach"; conv: string }
  | { t: "detach"; conv: string }
  | { t: "ping" };

// ============ exec-agent 帧（M4，07 §3） ============

export type ExecCliFrame =
  | { t: "hello"; envId: string; proto: 1; token: string; platform: string }
  | { t: "exec_output"; callId: string; stream: "stdout" | "stderr"; data: string }
  | { t: "exec_exit"; callId: string; code: number }
  | { t: "read_chunk"; callId: string; offset: number; data: string; eof: boolean }
  | { t: "dir_page"; callId: string; entries: unknown[]; done: boolean }
  | { t: "write_ack"; callId: string; bytes: number }
  | { t: "result"; callId: string; ok: true; value: unknown }
  | { t: "result"; callId: string; ok: false; error: string }
  | { t: "ping" };

export type ExecSrvFrame =
  | { t: "welcome"; envId: string }
  | { t: "exec"; callId: string; argv: string[]; cwd?: string; timeoutSec?: number }
  | { t: "exec_abort"; callId: string }
  | { t: "fs"; callId: string; op: string; path: string; offset?: number; length?: number; data?: string; opts?: unknown }
  | { t: "pong" };
