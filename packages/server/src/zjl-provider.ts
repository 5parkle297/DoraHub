/**
 * DuraHub — zjl provider 装配（pi-ai createProvider + openai-completions）。
 *
 * V-02 验证结论（2026-10-16，workpc）：
 * - pi-ai 1.2.0 的 `createProvider()` 接受 baseUrl/apiKey/models/api，
 *   model 定义必须带 `baseUrl`（compat 自动检测在 model 层读它）。
 * - zjl 中转走 `openai-completions` API；compat 关掉 developer role 与 store。
 * - provider id 固定 "zjl"，与 ~/.pi/agent/models.json 的命名一致。
 */
import { createProvider, type Models } from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/api/openai-completions";

export const ZJL_PROVIDER_ID = "zjl";

/** zjl 网关上的模型清单（与 ~/.pi/agent/models.json 保持同步）。 */
interface ZjlModelDef {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
  samplingParams?: { temperature: number };
  thinkingLevelMap?: Record<string, string | null>;
}

const ZJL_MODELS: readonly ZjlModelDef[] = [
    {
      id: "grok-4.7",
      name: "grok-4.7",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 500_000,
      maxTokens: 8192,
      thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
    },
    {
      id: "k3",
      name: "k3 (kimi-k3)",
      reasoning: true,
      input: ["text"],
      contextWindow: 262_144,
      maxTokens: 32_768,
      samplingParams: { temperature: 1 },
      thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null },
    },
  ];

export function zjlProvider(baseUrl: string, apiKey: string) {
  return createProvider({
    id: ZJL_PROVIDER_ID,
    name: "zjl",
    baseUrl,
    auth: {
      apiKey: {
        name: "zjl API key",
        resolve: async () => ({ auth: { apiKey }, source: "DURAHUB_ZJL_API_KEY" }),
      },
    },
    models: ZJL_MODELS.map((m) => ({
      ...m,
      provider: ZJL_PROVIDER_ID,
      api: "openai-completions" as const,
      baseUrl,
      // cost 四字段必填（ModelCostRatesSchema）；费率未知填 0，
      // 不能省略——calculateCost 会算出 NaN，chord 严格 JSON 提交时抛错。
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsDeveloperRole: false, supportsStore: false },
    })),
    api: { "openai-completions": { stream, streamSimple } },
  });
}

/** zjl 上可用的模型 id（供 API/前端展示）。 */
export function zjlModelIds(): string[] {
  return ZJL_MODELS.map((m) => m.id);
}

export function installZjl(models: import("@earendil-works/pi-ai").MutableModels, baseUrl: string, apiKey: string): void {
  models.setProvider(zjlProvider(baseUrl, apiKey));
}
