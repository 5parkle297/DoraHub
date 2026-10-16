/**
 * 会话自动命名服务（handoff §0.5-B，2026-10-16 前端改造会话）。
 *
 * 对标 Claude Code / Codex 的会话命名：首条用户消息后自动生成 ≤12 字短标题，
 * 随对话演进节流刷新；同时产出 description + keywords 供列表页卡片展示。
 *
 * 触发点（Dorahub 调用）：
 * - submit 后（用户发消息）
 * - 事件流里 pi.user entry_appended（排队消息真正落位时——submit 时可能还没进 viewState）
 * - 启动时补偿（旧会话 retroactive 命名，让既有列表立刻可用）
 *
 * 规则：
 * - 手动命名（autoNamed=false 且 name 非空）→ 标题不动，但仍生成 description/keywords
 * - 节流：userCount<=2 必做；之后每 +5 条用户消息刷新
 * - 同会话并发锁；失败静默（下个触发点再试）
 * - 模型渠道回退：trial:glm-5.3-flash（免费）→ zjl:grok-4.7 → plan:glm-5.3
 */
import type { Models } from "@earendil-works/pi-ai";
import type { Conversation, Harness } from "@earendil-works/pi-durable";
import { ConvMetaDoc } from "./conv-meta.ts";
import { context } from "./harness.ts";

/** 命名模型优先级（免费优先）。 */
const NAMING_MODEL_CANDIDATES = ["trial:glm-5.3-flash", "zjl:grok-4.7", "plan:glm-5.3"];

/** 节流间隔：每新增多少条用户消息刷新一次 */
const REFRESH_INTERVAL = 5;

/** 输入消息条数上限 */
const MAX_INPUT_MESSAGES = 12;

/** 单条消息截断长度 */
const PER_MESSAGE_TRUNC = 400;

export interface NamingResult {
  title: string;
  description: string;
  keywords: string[];
}

/** 从 viewState entries 提取用户消息文本（entry 内容在 model[0]，handoff §3 大坑）。 */
export function extractUserMessages(entries: readonly any[]): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if (e.kind !== "pi.user") continue;
    const m = e?.model?.[0];
    if (!m) continue;
    const text = typeof m.content === "string" ? m.content
      : Array.isArray(m.content)
        ? m.content.filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("")
        : "";
    const t = text.trim();
    if (t) out.push(t);
  }
  return out;
}

/** 提示词（纯函数）。 */
export function namingPrompt(userMessages: string[]): { systemPrompt: string; userPrompt: string } {
  const transcript = userMessages
    .slice(-MAX_INPUT_MESSAGES)
    .map((t, i) => `${i + 1}. ${t.length > PER_MESSAGE_TRUNC ? t.slice(0, PER_MESSAGE_TRUNC) + "…" : t}`)
    .join("\n");
  return {
    systemPrompt:
      "你是会话命名助手。根据用户对 AI 编程助手提出的请求，生成会话元数据。" +
      "title 用用户的语言（中文请求给中文），不超过 12 个字，名词短语，概括任务本身，不要标点结尾，不要「会话/任务」这类填充词。" +
      "description 一句话（不超过 40 字）概括用户在做什么、想达成什么。" +
      "keywords 3-5 个关键词，每个不超过 6 个字，用于快速识别任务主题。" +
      '只输出一个 JSON 对象：{"title":"...","description":"...","keywords":["..."]}，不要任何其他内容。',
    userPrompt: `用户的请求记录（按时间顺序）：\n${transcript}`,
  };
}

/** 解析模型输出（容忍 ```json 包裹 / 前后杂文）。 */
export function parseNamingResult(raw: string): NamingResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    const title = typeof obj.title === "string" ? obj.title.trim().slice(0, 24) : "";
    const description = typeof obj.description === "string" ? obj.description.trim().slice(0, 60) : "";
    const keywords = Array.isArray(obj.keywords)
      ? obj.keywords.filter((k: any) => typeof k === "string" && k.trim()).map((k: string) => k.trim().slice(0, 12)).slice(0, 5)
      : [];
    if (!title) return null;
    return { title, description, keywords };
  } catch {
    return null;
  }
}

/** 一次性模型调用（渠道回退）。返回 null = 全部渠道失败。 */
async function callNamingModel(models: Models, userMessages: string[]): Promise<NamingResult | null> {
  const { systemPrompt, userPrompt } = namingPrompt(userMessages);
  for (const ref of NAMING_MODEL_CANDIDATES) {
    const [provider, modelId] = ref.split(":");
    const model = models.getModel(provider, modelId);
    if (!model) continue;
    try {
      const msg = await models.completeSimple(model, {
        systemPrompt,
        messages: [{ role: "user", content: userPrompt, timestamp: Date.now() }],
      }, { maxTokens: 300 });
      if (msg.stopReason === "error") continue;
      const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text ?? "").join("");
      const parsed = parseNamingResult(text);
      if (parsed) return parsed;
    } catch {
      // 该渠道挂了，试下一个
    }
  }
  return null;
}

/** 会话自动命名器（hub 进程内单例）。 */
export class AutoNamer {
  private busy = new Set<string>();

  constructor(private models: Models, private harness: Harness) {}

  /** 触发一次命名检查（fire-and-forget，调用方不 await）。 */
  maybeName(conv: Conversation): void {
    const convId = String(conv.id);
    if (this.busy.has(convId)) return;
    this.fire(conv);
  }

  private fire(conv: Conversation) {
    const convId = String(conv.id);
    this.busy.add(convId);
    (async () => {
      try {
        const view = await conv.viewState(context);
        const userMessages = extractUserMessages(view.value.entries ?? []);
        if (userMessages.length === 0) return;
        const userCount = userMessages.length;

        // 节流判断：自定义 doc 用 documentState 读（viewState.docs 只有 pi.* builtin）
        const st = await this.harness.documentState(ConvMetaDoc, conv.id, context);
        const meta = st?.value as any;
        const namedAt = typeof meta?.namedAtUserCount === "number" ? meta.namedAtUserCount : 0;
        const due = userCount <= 2 || userCount - namedAt >= REFRESH_INTERVAL;
        if (!due) return;

        const result = await callNamingModel(this.models, userMessages);
        if (!result) return; // 渠道全挂，静默放弃（下个触发点再试）

        let finalName = result.title;
        await conv.commit((tx) => {
          return tx.doc(ConvMetaDoc, conv.id).then((draft) => {
            // 手动命名的会话：标题保持手动值，只补 description/keywords
            if (draft.name && !draft.autoNamed) {
              finalName = draft.name;
            } else {
              draft.name = result.title;
              draft.autoNamed = true;
            }
            draft.description = result.description;
            draft.keywords = result.keywords;
            draft.namedAtUserCount = userCount;
          });
        }, context);
        this.onNamed?.(convId, finalName, result.description, result.keywords);
      } catch (e) {
        console.error(`[auto-namer] conv ${convId} failed:`, e);
      } finally {
        this.busy.delete(convId);
      }
    })();
  }

  /** 命名完成后回调（Dorahub 注入：更新注册表 + 推 conv_meta 帧）。 */
  onNamed?: (convId: string, name: string, description: string, keywords: string[]) => void;
}
