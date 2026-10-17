/**
 * pi CLI 会话导入为 DoraHub durable 会话（2026-10-17，"Claude Code Desktop 式管理"）。
 *
 * 用户需求：在 hub UI 里不只能搬运 pi 会话，还要能打开它（继续对话）、fork、
 * 管理——导入成 durable conversation 后它就是普通 DoraHub 会话，享有全部功能。
 *
 * 映射（pi jsonl v3 → pi-durable entries，同构转换）：
 * - message[user]      → pi.user        model=[{role,content}]
 * - message[assistant] → pi.assistant   model=[{role,content,stopReason:"stop"}]
 * - message[toolResult]→ pi.tool-result model=[{role,toolCallId,toolName,content,isError,durationMs}]
 * - model_change(首个) → 会话初始 agent.model
 * - session/system/context_edit/thinking_level_change → 跳过（system 由 hub 重新注入）
 *
 * 去重：ConvMetaDoc.sourcePiKey 存 "envId/file"，重复导入返回已有会话。
 */
import type { ExecRegistry } from "./exec/registry.ts";
import type { Harness } from "@earendil-works/pi-durable";
import { ConvMetaDoc } from "./conv-meta.ts";
import { context } from "./harness.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

/** 单个 pi 会话导入结果。 */
export interface PiImportResult {
  ok: boolean;
  convId?: string;
  /** 已导入过时返回既有会话 */
  existing?: boolean;
  imported?: number;
  error?: string;
}

/** 导入一个 pi 会话文件为 durable 会话。 */
export async function importPiSession(
  harness: Harness,
  execRegistry: ExecRegistry,
  sourceEnvId: string,
  dir: string,
  file: string,
): Promise<PiImportResult> {
  const sourceKey = `pi:${sourceEnvId}/${file}`;

  // 1. 源机读全文
  const env = await execRegistry.buildForEnv(sourceEnvId, null);
  if (!env) return { ok: false, error: "executor not available" };
  const rr = await env.readTextFile(`.pi/agent/sessions/${dir}/${file}`, BACKGROUND_CONTEXT);
  if (!rr.ok) return { ok: false, error: `read failed: ${rr.error.message}` };
  const text = rr.value;
  if (text.length > 60 * 1024 * 1024) return { ok: false, error: "session too large (>60MB)" };

  // 2. 解析行 → 结构化（跳过坏行，容错）
  interface ParsedLine { kind: string; msg: any; ts: number; id: string }
  const lines: ParsedLine[] = [];
  let headerCwd = "";
  let firstModel: { provider: string; modelId: string } | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: any;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type === "session") { headerCwd = String(o.cwd ?? ""); continue; }
    if (o.type === "model_change" && !firstModel && o.provider && o.modelId) {
      firstModel = { provider: String(o.provider), modelId: String(o.modelId) };
    }
    if (o.type !== "message" || !o.message?.role) continue;
    const role = o.message.role;
    if (role !== "user" && role !== "assistant" && role !== "toolResult") continue;
    // 跳过 pi 的 system 包装消息（preamble / hook 注入）
    if (role === "user") {
      const c = o.message.content;
      const t = typeof c === "string" ? c : Array.isArray(c) ? "" : "";
      if (t.startsWith("<")) continue;
    }
    lines.push({ kind: role, msg: o.message, ts: Number(o.message.timestamp ?? Date.parse(o.timestamp ?? "")) || Date.now(), id: String(o.id ?? "") });
  }
  if (lines.length === 0) return { ok: false, error: "no importable messages" };

  // 3. 建 durable 会话：init 里批量 appendEntry（一个 commit 全量写入）
  const cwd = headerCwd || ".";
  const conv = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { ...(firstModel ? { model: firstModel } : {}), cwd },
      init: (tx, conversationId) => {
        for (const l of lines) {
          if (l.kind === "user") {
            tx.appendEntry(conversationId, { kind: "pi.user", model: [l.msg] });
          } else if (l.kind === "assistant") {
            tx.appendEntry(conversationId, {
              kind: "pi.assistant",
              model: [{ ...l.msg, stopReason: l.msg.stopReason ?? "stop" }],
            });
          } else {
            tx.appendEntry(conversationId, {
              kind: "pi.tool-result",
              model: [l.msg],
            });
          }
        }
      },
    },
    context,
  );

  // 4. ConvMetaDoc 写来源标记 + 元数据继承（若 pi 摘要缓存里有就直接用）
  await conv.commit((tx) => {
    return tx.doc(ConvMetaDoc, conv.id).then((draft) => {
      draft.sourcePiKey = sourceKey;
      draft.sourcePiEnvId = sourceEnvId;
    });
  }, context);

  return { ok: true, convId: String(conv.id), imported: lines.length };
}
