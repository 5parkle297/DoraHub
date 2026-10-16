/**
 * 多渠道模型注册（渠道冗余 + 手机切换，2026-10-16 新增）。
 *
 * 渠道（与 ~/.pi/agent/models.json 的"供应商约定"对齐）：
 * - zjl   ：中转站，日常默认（grok-4.7 / k3）
 * - trial ：智谱白嫖 key，经常换 key（glm-5.3 / glm-5.3-flash / glm-5.2 / glm-5-turbo / glm-5.3-highspeed）
 * - plan  ：智谱 coding plan，只用旗舰 glm-5.3
 *
 * 三个渠道都是 OpenAI-completions 协议。渠道挂了 → 会话页切换模型选择器里的
 * 渠道前缀即可（configure 提交新 ModelRef），hub 不需要重启。
 */
import { createProvider, type MutableModels } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

export interface ChannelConfig {
  /** provider id，也是会话配置里的 provider 字段 */
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ChannelModel[];
}

export interface ChannelModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
  samplingParams?: { temperature: number };
  /** OpenAI-completions compat 覆盖 */
  compat?: Record<string, unknown>;
}

const ZAI_COMPAT = {
  supportsDeveloperRole: false,
  supportsStore: false,
  supportsReasoningEffort: true,
  maxTokensField: "max_tokens",
  thinkingFormat: "zai",
  supportsStrictMode: true,
  zaiToolStream: true,
};

const GLM_THINKING_MAP = { off: null, minimal: null, low: "low", medium: null, high: "high", xhigh: null, max: "max" };

/** 渠道 → ChannelConfig（从环境变量读，hub 的 /etc/dorahub/env）。 */
export function channelsFromEnv(): ChannelConfig[] {
  const channels: ChannelConfig[] = [];

  if (process.env.ZJL_BASE_URL && process.env.ZJL_API_KEY) {
    channels.push({
      id: "zjl",
      name: "zjl",
      baseUrl: process.env.ZJL_BASE_URL,
      apiKey: process.env.ZJL_API_KEY,
      models: [
        {
          id: "grok-4.7", name: "grok-4.7", reasoning: true, input: ["text", "image"],
          contextWindow: 500_000, maxTokens: 8192,
          thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
        },
        {
          id: "k3", name: "k3 (kimi-k3)", reasoning: true, input: ["text"],
          contextWindow: 262_144, maxTokens: 32_768,
          samplingParams: { temperature: 1 },
          thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
        },
      ],
    });
  }

  if (process.env.ZHIPU_TRIAL_KEY) {
    channels.push({
      id: "trial",
      name: "Zhipu GLM(trial)",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      apiKey: process.env.ZHIPU_TRIAL_KEY,
      models: [
        { id: "glm-5.3", name: "GLM-5.3", reasoning: true, input: ["text"], contextWindow: 1_000_000, maxTokens: 131_072, thinkingLevelMap: GLM_THINKING_MAP, compat: ZAI_COMPAT },
        { id: "glm-5.3-flash", name: "GLM-5.3-Flash", reasoning: true, input: ["text", "image"], contextWindow: 1_000_000, maxTokens: 131_072, thinkingLevelMap: GLM_THINKING_MAP, compat: ZAI_COMPAT },
        { id: "glm-5.3-highspeed", name: "GLM-5.3-Highspeed", reasoning: true, input: ["text"], contextWindow: 1_000_000, maxTokens: 131_072, thinkingLevelMap: GLM_THINKING_MAP, compat: ZAI_COMPAT },
        { id: "glm-5.2", name: "GLM-5.2", reasoning: true, input: ["text"], contextWindow: 1_000_000, maxTokens: 131_072, thinkingLevelMap: GLM_THINKING_MAP, compat: ZAI_COMPAT },
        { id: "glm-5-turbo", name: "GLM-5-Turbo", reasoning: true, input: ["text"], contextWindow: 200_000, maxTokens: 131_072, thinkingLevelMap: GLM_THINKING_MAP, compat: ZAI_COMPAT },
      ],
    });
  }

  if (process.env.ZHIPU_PLAN_KEY) {
    channels.push({
      id: "plan",
      name: "Zhipu GLM(coding plan)",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      apiKey: process.env.ZHIPU_PLAN_KEY,
      models: [
        { id: "glm-5.3", name: "GLM-5.3", reasoning: true, input: ["text"], contextWindow: 1_000_000, maxTokens: 131_072, thinkingLevelMap: GLM_THINKING_MAP, compat: ZAI_COMPAT },
      ],
    });
  }

  return channels;
}

/** 全渠道注册到 models。 */
export function installChannels(models: MutableModels, channels: ChannelConfig[]): void {
  for (const ch of channels) {
    models.setProvider(
      createProvider({
        id: ch.id,
        name: ch.name,
        baseUrl: ch.baseUrl,
        auth: {
          apiKey: {
            name: `${ch.name} API key`,
            resolve: async () => ({ auth: { apiKey: ch.apiKey }, source: `channel:${ch.id}` }),
          },
        },
        models: ch.models.map((m) => ({
          ...m,
          provider: ch.id,
          api: "openai-completions" as const,
          baseUrl: ch.baseUrl,
          // cost 四字段必填（V-02 教训：缺失 → NaN → chord 严格 JSON 炸）
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: { supportsDeveloperRole: false, supportsStore: false, ...(m.compat ?? {}) },
        })),
        api: { "openai-completions": { stream, streamSimple } },
      }),
    );
  }
}

/** 供 /api/models 列表：渠道与模型清单（不含 key）。 */
export function channelCatalog(channels: ChannelConfig[]) {
  return channels.map((ch) => ({
    id: ch.id,
    name: ch.name,
    models: ch.models.map((m) => ({
      id: m.id,
      name: m.name,
      reasoning: m.reasoning,
      thinkingLevels: Object.entries(m.thinkingLevelMap ?? {})
        .filter(([, v]) => v !== null)
        .map(([k]) => k),
    })),
  }));
}
