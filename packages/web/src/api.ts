/**
 * HTTP API 封装（06 §3：token 注入 + hubUrl）。
 */
import type {
  ConversationSummary,
  CreateConversationRequest,
  SendMessageRequest,
} from "@dorahub/shared";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("dorahub.token");
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `${res.status} ${res.statusText}`);
  }
  return body as T;
}

export const api = {
  health: () => call<{ ok: true; uptime: number; version: string }>("/api/health"),

  models: () => call<any[]>("/api/models"),

  listConversations: () => call<ConversationSummary[]>("/api/conversations"),

  createConversation: (req: CreateConversationRequest) =>
    call<{ id: string }>("/api/conversations", { method: "POST", body: JSON.stringify(req) }),

  snapshot: (conv: string) => call<any>(`/api/conversations/${encodeURIComponent(conv)}/snapshot`),

  send: (conv: string, req: SendMessageRequest) =>
    call<{ submissionId: string }>(`/api/conversations/${encodeURIComponent(conv)}/messages`, {
      method: "POST",
      body: JSON.stringify(req),
    }),

  abort: (conv: string) =>
    call<{ ok: true }>(`/api/conversations/${encodeURIComponent(conv)}/abort`, { method: "POST" }),

  configure: (conv: string, change: Record<string, unknown>) =>
    call<{ ok: true }>(`/api/conversations/${encodeURIComponent(conv)}/configure`, {
      method: "POST",
      body: JSON.stringify(change),
    }),

  executors: () => call<import("@dorahub/shared").ExecutorInfo[]>("/api/executors"),

  piSessions: (env: string) =>
    call<import("@dorahub/shared").PiSessionInfo[]>(`/api/pi-sessions?env=${encodeURIComponent(env)}`),

  piSessionImport: (req: { sourceEnvId: string; dir: string; file: string }) =>
    call<{ ok: true; convId: string; existing: boolean; imported: number }>("/api/pi-sessions/import", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  piSessionDelete: (req: { envId: string; dir: string; file: string }) =>
    call<{ ok: true }>("/api/pi-sessions/delete", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  piSessionTransfer: (req: { sourceEnvId: string; file: string; dir: string; targetEnvId: string; targetCwd: string }) =>
    call<{ ok: true; targetFile: string; bytes: number }>("/api/pi-sessions/transfer", {
      method: "POST",
      body: JSON.stringify(req),
    }),

  transfer: (conv: string, req: { targetEnvId: string; targetCwd: string }) =>
    call<{ report: { copied: number; skipped: number; oversize: string[]; totalBytes: number; errors: string[] }; notice: string }>(
      `/api/conversations/${encodeURIComponent(conv)}/transfer`,
      { method: "POST", body: JSON.stringify(req) },
    ),

  fork: (conv: string, entryId?: string) =>
    call<{ id: string }>(`/api/conversations/${encodeURIComponent(conv)}/fork`, {
      method: "POST",
      body: JSON.stringify(entryId ? { entryId } : {}),
    }),

  deleteConversation: (conv: string) =>
    call<{ ok: true }>(`/api/conversations/${encodeURIComponent(conv)}`, { method: "DELETE" }),

  pendingConfirmations: () => call<any[]>("/api/confirmations"),

  answerConfirmation: (id: string, approved: boolean) =>
    call<{ ok: true }>(`/api/confirmations/${encodeURIComponent(id)}`, {
      method: "POST",
      body: JSON.stringify({ approved }),
    }),
};
