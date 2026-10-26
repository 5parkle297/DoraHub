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
import type { ChannelConfig } from "./channels.ts";

/** 单个 pi 会话导入结果。 */
export interface PiImportResult {
  ok: boolean;
  convId?: string;
  /** 已导入过时返回既有会话 */
  existing?: boolean;
  imported?: number;
  error?: string;
}

/** pi 本地渠道名 → hub 渠道名映射。
 * pi 会话的 agent 快照里 provider 是源机 ~/.pi/agent/models.json 的渠道名
 * （如 zhipu-glm-coding-plan），hub 云端注册的是自己的渠道（zjl/trial/plan）。
 * 名字对不上 → 会话 no_model → 消息全部 unanswered（2026-10-26 手机实踩：
 * 发送后红色警告“模型未应答”）。导入时把模型归一到 hub 真实存在的渠道。 */
const PI_PROVIDER_MAP: Record<string, string> = {
  "zhipu-glm-coding-plan": "plan",
  "zhipu-glm-trial": "trial",
  // zjl 两边同名，无需映射
};

/** 导入时的模型归一：provider 不在 hub 渠道里时按映射表换；
 * 换完仍不存在（模型 id 也没有）→ 退回 null（用 hub 默认模型）。 */
function normalizeModel(
  model: { provider: string; modelId: string } | null,
  channels: ChannelConfig[],
): { provider: string; modelId: string } | null {
  if (!model) return null;
  const channelIds = new Set(channels.map((c) => c.id));
  const mapped = { ...model };
  if (!channelIds.has(mapped.provider)) {
    const target = PI_PROVIDER_MAP[mapped.provider];
    if (target && channelIds.has(target)) {
      mapped.provider = target;
    } else {
      return null; // 无法映射：退回默认，绝不带入 hub 不认识的 provider
    }
  }
  // provider 在了，确认 modelId 也存在于该渠道
  const ch = channels.find((c) => c.id === mapped.provider);
  if (!ch?.models.some((m) => m.id === mapped.modelId)) return null;
  return mapped;
}

/** 导入一个 pi 会话文件为 durable 会话。 */
export async function importPiSession(
  harness: Harness,
  execRegistry: ExecRegistry,
  sourceEnvId: string,
  dir: string,
  file: string,
  channels: ChannelConfig[] = [],
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
  // 模型归一（no_model 防护）：pi 本地渠道名 → hub 渠道名，归不进去就退默认
  const cwd = headerCwd || ".";
  const agentModel = normalizeModel(firstModel, channels);
  const conv = await harness.createConversation(
    {
      ownership: { kind: "ownerless" },
      agent: { ...(agentModel ? { model: agentModel } : {}), cwd },
      init: async (tx, conversationId) => {
        // 必须逐个 await：commit 回调要等所有 Tx 操作落定（settled before pending = 没等）
        for (const l of lines) {
          if (l.kind === "user") {
            await tx.appendEntry(conversationId, { kind: "pi.user", model: [l.msg] });
          } else if (l.kind === "assistant") {
            await tx.appendEntry(conversationId, {
              kind: "pi.assistant",
              model: [{ ...l.msg, stopReason: l.msg.stopReason ?? "stop" }],
            });
          } else {
            await tx.appendEntry(conversationId, {
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
      // 导入会话的执行机 = 源机：cwd 是源机上的真实路径，必须在源机上跑。
      // 历史bug（2026-10-19 手机导入会话工具全炸）：漏写 envId → 会话跑在 hub
      // 本地，cwd 却是源机的 Windows 路径 → hub 上不存在 → “Working directory
      // does not exist: /opt/dorahub/D:/...”双重拼接鬼路径。Pi 会话从哪台机
      // 扫来的就落哪台机。
      draft.envId = sourceEnvId;
    });
  }, context);

  return { ok: true, convId: String(conv.id), imported: lines.length };
}
